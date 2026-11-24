import { describe, expect, it } from "vitest";
import {
  computeWeeklyReport,
  leadTemperature,
  nextOpening,
  nextWeeklyReportAt,
  parseLeadFields,
  parseLeadgenWebhook,
  planResponseEscalation,
  type BusinessHours,
  type ReportLead,
} from "../src";

const hours: BusinessHours = {
  timezone: "America/Sao_Paulo",
  days: { mon: ["08:00", "18:00"], tue: ["08:00", "18:00"], wed: ["08:00", "18:00"], thu: ["08:00", "18:00"], fri: ["08:00", "18:00"] },
};

describe("parseLeadgenWebhook", () => {
  it("reads leadgen changes from a page payload", () => {
    const events = parseLeadgenWebhook({
      object: "page",
      entry: [{ id: "page1", changes: [{ field: "leadgen", value: { leadgen_id: "L1", page_id: "page1", form_id: "F1", ad_id: "A1", created_time: 1700000000 } }] }],
    });
    expect(events).toEqual([
      { leadgenId: "L1", pageId: "page1", formId: "F1", adId: "A1", createdAt: new Date(1700000000 * 1000) },
    ]);
  });

  it("ignores other objects and fields", () => {
    expect(parseLeadgenWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parseLeadgenWebhook({ object: "page", entry: [{ id: "p", changes: [{ field: "feed", value: {} }] }] })).toEqual([]);
  });
});

describe("parseLeadFields", () => {
  it("maps standard Lead Ads fields", () => {
    expect(
      parseLeadFields([
        { name: "full_name", values: ["Ana Souza"] },
        { name: "phone_number", values: ["+5577999998888"] },
        { name: "email", values: ["ana@example.com"] },
      ]),
    ).toEqual({ name: "Ana Souza", phone: "+5577999998888", email: "ana@example.com", whatsappConsent: null });
  });

  it("joins first and last name and reads the consent question", () => {
    const parsed = parseLeadFields([
      { name: "first_name", values: ["Ana"] },
      { name: "last_name", values: ["Souza"] },
      { name: "whatsapp_consent", values: ["Sim"] },
    ]);
    expect(parsed.name).toBe("Ana Souza");
    expect(parsed.whatsappConsent).toBe(true);
    expect(parseLeadFields([{ name: "whatsapp_consent", values: ["Não"] }]).whatsappConsent).toBe(false);
  });
});

describe("business hours", () => {
  it("returns the same instant when open", () => {
    const open = new Date("2026-11-19T12:00:00Z"); // Thu 09:00 in São Paulo
    expect(nextOpening(open, hours)).toEqual(open);
  });

  it("moves a Friday night message to Monday 08:00", () => {
    const fridayNight = new Date("2026-11-21T01:30:00Z"); // Fri 22:30 in São Paulo
    expect(nextOpening(fridayNight, hours)?.toISOString()).toBe("2026-11-23T11:00:00.000Z");
  });

  it("starts the response clock at the next opening", () => {
    const night = new Date("2026-11-20T02:00:00Z"); // Thu 23:00
    const [reminder] = planResponseEscalation(night, { firstContactTemplate: "", followUps: [], firstResponseMinutes: 5, staleDays: 3 }, hours);
    expect(reminder?.runAt.toISOString()).toBe("2026-11-20T11:05:00.000Z"); // Fri 08:05
  });

  it("schedules the weekly report for the next Monday 08:00", () => {
    expect(nextWeeklyReportAt(new Date("2026-11-19T12:00:00Z"), "America/Sao_Paulo").toISOString()).toBe("2026-11-23T11:00:00.000Z");
    // Right after a run, the next one is a week later.
    expect(nextWeeklyReportAt(new Date("2026-11-23T11:00:00Z"), "America/Sao_Paulo").toISOString()).toBe("2026-11-30T11:00:00.000Z");
  });
});

describe("computeWeeklyReport", () => {
  const t = (minutes: number) => new Date(Date.UTC(2026, 10, 16, 12, minutes));
  const lead = (over: Partial<ReportLead>): ReportLead => ({
    source: "form",
    campaign: null,
    stage: "new",
    receivedAt: t(0),
    firstContactAt: null,
    firstLeadReplyAt: null,
    firstBusinessReplyAt: null,
    ...over,
  });

  it("summarizes contact speed, replies, response time and outcomes", () => {
    const report = computeWeeklyReport([
      lead({ campaign: "bf", firstContactAt: new Date(t(0).getTime() + 5000), firstLeadReplyAt: t(10), firstBusinessReplyAt: t(14), stage: "won" }),
      lead({ campaign: "bf", firstContactAt: t(2), firstLeadReplyAt: t(20), stage: "in_progress" }),
      lead({ source: "meta_lead_ads", campaign: "natal", firstContactAt: new Date(t(0).getTime() + 30000), stage: "no_reply" }),
      lead({ source: "whatsapp", firstLeadReplyAt: t(0), firstBusinessReplyAt: t(6), stage: "lost" }),
    ]);

    expect(report.leadsReceived).toBe(4);
    expect(report.bySource).toEqual({ form: 2, meta_lead_ads: 1, whatsapp: 1 });
    expect(report.contactedWithinMinuteRate).toBe(66.7);
    expect(report.leadsReplied).toBe(3);
    expect(report.medianBusinessResponseMinutes).toBe(5);
    expect(report.repliedWithoutBusinessAnswer).toBe(1);
    expect(report.stages).toMatchObject({ won: 1, lost: 1, no_reply: 1, in_progress: 1 });
    expect(report.byCampaign[0]).toEqual({ campaign: "bf", leads: 2, won: 1 });
  });

  it("handles an empty week", () => {
    const report = computeWeeklyReport([]);
    expect(report.contactedWithinMinuteRate).toBeNull();
    expect(report.medianBusinessResponseMinutes).toBeNull();
  });
});

describe("leadTemperature", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("is ok when nobody owes an answer", () => {
    expect(leadTemperature({ stage: "new", lastInboundAt: null, lastBusinessReplyAt: null }, now, 5)).toBe("ok");
    expect(leadTemperature({ stage: "in_progress", lastInboundAt: ago(30), lastBusinessReplyAt: ago(20) }, now, 5)).toBe("ok");
  });

  it("is waiting within X minutes and late after", () => {
    expect(leadTemperature({ stage: "in_progress", lastInboundAt: ago(3), lastBusinessReplyAt: null }, now, 5)).toBe("waiting");
    expect(leadTemperature({ stage: "in_progress", lastInboundAt: ago(12), lastBusinessReplyAt: ago(60) }, now, 5)).toBe("late");
  });

  it("is closed for finished leads", () => {
    expect(leadTemperature({ stage: "won", lastInboundAt: ago(90), lastBusinessReplyAt: null }, now, 5)).toBe("closed");
  });
});
