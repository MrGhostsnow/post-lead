import { describe, expect, it } from "vitest";
import {
  createWhatsAppClient,
  computeWeeklyReport,
  leadTemperature,
  nextOpening,
  nextWeeklyReportAt,
  classifyNewNumber,
  parseSaleValue,
  parseWhatsAppWebhook,
  type KnownContact,
  planResponseEscalation,
  type BusinessHours,
  type ReportLead,
} from "../src";

const hours: BusinessHours = {
  timezone: "America/Sao_Paulo",
  days: { mon: ["08:00", "18:00"], tue: ["08:00", "18:00"], wed: ["08:00", "18:00"], thu: ["08:00", "18:00"], fri: ["08:00", "18:00"] },
};

describe("classifyNewNumber", () => {
  const contact = (c: Partial<KnownContact>): KnownContact => ({ inAddressBook: false, lastMessageAt: null, ignoredAt: null, ...c });

  it("makes an unknown number a lead of unknown origin", () => {
    expect(classifyNewNumber({ fromAd: false, contact: null })).toEqual({ kind: "lead", source: "whatsapp", knownContact: false });
  });

  it("does not make a known contact a new lead", () => {
    expect(classifyNewNumber({ fromAd: false, contact: contact({ lastMessageAt: new Date() }) })).toEqual({ kind: "ignore", reason: "known_contact" });
    expect(classifyNewNumber({ fromAd: false, contact: contact({ inAddressBook: true }) })).toEqual({ kind: "ignore", reason: "known_contact" });
  });

  it("lets an ad win over history, flagging the known contact", () => {
    expect(classifyNewNumber({ fromAd: true, contact: contact({ inAddressBook: true }) })).toEqual({ kind: "lead", source: "whatsapp_ad", knownContact: true });
    expect(classifyNewNumber({ fromAd: true, contact: null })).toEqual({ kind: "lead", source: "whatsapp_ad", knownContact: false });
  });

  it("never answers a number marked as not a lead, even from an ad", () => {
    expect(classifyNewNumber({ fromAd: true, contact: contact({ ignoredAt: new Date() }) })).toEqual({ kind: "ignore", reason: "ignored" });
  });
});

describe("parseSaleValue", () => {
  it.each([
    ["1500", 150000],
    ["R$ 1.500", 150000],
    ["1.500,00", 150000],
    ["1500.50", 150050],
    ["1,5", 150],
    ["15,000", 1500000],
    ["r$350", 35000],
  ])("reads %s", (text, cents) => {
    expect(parseSaleValue(text)).toBe(cents);
  });

  it.each(["", "não sei", "0", "-10", "mil reais"])("rejects %s", (text) => {
    expect(parseSaleValue(text)).toBeNull();
  });
});

describe("parseWhatsAppWebhook (ads, history, contacts)", () => {
  const envelope = (field: string, value: object) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "pn1" }, ...value } }] }],
  });

  it("keeps the ad referral of a click-to-WhatsApp message", () => {
    const [event] = parseWhatsAppWebhook(
      envelope("messages", {
        contacts: [{ wa_id: "5577981110001", profile: { name: "Ana" } }],
        messages: [{
          from: "5577981110001", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Oi" },
          referral: { source_id: "1202", source_type: "ad", source_url: "https://fb.me/x", headline: "Clareamento", ctwa_clid: "clid" },
        }],
      }),
    );
    expect(event).toMatchObject({
      kind: "inbound_message",
      referral: { sourceId: "1202", sourceType: "ad", headline: "Clareamento", ctwaClid: "clid" },
    });
  });

  it("reads history with direction and no text", () => {
    const [event] = parseWhatsAppWebhook(
      envelope("history", {
        history: [{
          metadata: { phase: 0, chunk_order: 1, progress: 100 },
          threads: [{
            id: "5577981110002",
            messages: [
              { from: "5577981110002", id: "wamid.h1", timestamp: "1700000000", type: "text", text: { body: "Oi" } },
              { from: "557733334444", to: "5577981110002", id: "wamid.h2", timestamp: "1700000060", type: "text", text: { body: "Olá" } },
            ],
          }],
        }],
      }),
    );
    expect(event).toEqual({
      kind: "history",
      phoneNumberId: "pn1",
      shared: true,
      messages: [
        { contactPhone: "5577981110002", waMessageId: "wamid.h1", direction: "inbound", timestamp: new Date(1700000000 * 1000) },
        { contactPhone: "5577981110002", waMessageId: "wamid.h2", direction: "outbound", timestamp: new Date(1700000060 * 1000) },
      ],
    });
    expect(JSON.stringify(event)).not.toContain("Olá");
  });

  it("recognizes a declined history share", () => {
    const [event] = parseWhatsAppWebhook({
      messaging_product: "whatsapp",
      metadata: { phone_number_id: "pn1" },
      history: [{ errors: [{ code: 2593109 }] }],
    });
    expect(event).toEqual({ kind: "history", phoneNumberId: "pn1", shared: false, messages: [] });
  });

  it("reads address book changes", () => {
    const [event] = parseWhatsAppWebhook(
      envelope("smb_app_state_sync", {
        state_sync: [
          { type: "contact", contact: { full_name: "Fornecedor Zé", phone_number: "5577999998888" }, action: "add" },
          { type: "contact", contact: { phone_number: "5577999997777" }, action: "remove" },
        ],
      }),
    );
    expect(event).toEqual({
      kind: "contact_sync",
      phoneNumberId: "pn1",
      contacts: [
        { phone: "5577999998888", name: "Fornecedor Zé", action: "add" },
        { phone: "5577999997777", name: null, action: "remove" },
      ],
    });
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
    const [reminder] = planResponseEscalation(night, { followUps: [], firstResponseMinutes: 5, staleDays: 3 }, hours);
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

  it("summarizes contact speed, response time, outcomes and sale value", () => {
    const report = computeWeeklyReport([
      // Wrote from an ad, auto reply in 5s, a person answered in 4 min, won R$ 1.500.
      lead({ source: "whatsapp_ad", campaign: "bf", firstContactAt: new Date(t(0).getTime() + 5000), firstBusinessReplyAt: t(4), stage: "won", saleValueCents: 150000 }),
      // From the same ad, nobody answered yet.
      lead({ source: "whatsapp_ad", campaign: "bf", firstContactAt: t(2), stage: "in_progress" }),
      // Unknown origin, auto reply in 30s, answered in 6 min, lost.
      lead({ source: "whatsapp", firstContactAt: new Date(t(0).getTime() + 30000), firstBusinessReplyAt: t(6), stage: "lost" }),
    ]);

    expect(report.leadsReceived).toBe(3);
    expect(report.bySource).toEqual({ form: 0, meta_lead_ads: 0, whatsapp: 1, whatsapp_ad: 2 });
    expect(report.contactedWithinMinuteRate).toBe(66.7);
    expect(report.leadsReplied).toBe(3);
    expect(report.medianBusinessResponseMinutes).toBe(5);
    expect(report.repliedWithoutBusinessAnswer).toBe(1);
    expect(report.stages).toMatchObject({ won: 1, lost: 1, in_progress: 1 });
    expect(report.byCampaign[0]).toEqual({ campaign: "bf", leads: 2, won: 1 });
    expect(report.wonValueCents).toBe(150000);
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

describe("WhatsApp client and the test number's allowed list", () => {
  function fakeFetch(allowed: string) {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const to = JSON.parse(init.body).to as string;
      calls.push(to);
      const ok = to === allowed;
      return {
        ok,
        status: ok ? 200 : 400,
        json: async () =>
          ok ? { messages: [{ id: "wamid.ok" }] } : { error: { message: "Recipient phone number not in allowed list", code: 131030 } },
      };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("retries with the ninth digit when the list has the other form", async () => {
    const { calls, fetchImpl } = fakeFetch("5577988383289");
    const client = createWhatsAppClient({ accessToken: "t", apiVersion: "v25.0", fetchImpl });
    await expect(client.sendText("pn", "557788383289", "oi")).resolves.toBe("wamid.ok");
    expect(calls).toEqual(["557788383289", "5577988383289"]);
  });

  it("gives up when neither form is allowed", async () => {
    const { calls, fetchImpl } = fakeFetch("5511999999999");
    const client = createWhatsAppClient({ accessToken: "t", apiVersion: "v25.0", fetchImpl });
    await expect(client.sendText("pn", "557788383289", "oi")).rejects.toThrow("not in allowed list");
    expect(calls).toHaveLength(2);
  });
});
