/**
 * Weekly metrics for one operation, computed from lead rows. Pure, so the
 * same numbers can feed the WhatsApp summary and the panel.
 */

export type ReportLead = {
  source: "form" | "meta_lead_ads" | "whatsapp";
  campaign: string | null;
  stage: "new" | "in_progress" | "won" | "lost" | "no_reply";
  receivedAt: Date;
  firstContactAt: Date | null;
  firstLeadReplyAt: Date | null;
  firstBusinessReplyAt: Date | null;
};

export type WeeklyReport = {
  leadsReceived: number;
  bySource: Record<ReportLead["source"], number>;
  byCampaign: { campaign: string; leads: number; won: number }[];
  /** Of leads the tool contacted, share reached within 60 seconds. */
  contactedWithinMinuteRate: number | null;
  /** Leads that answered at least once. */
  leadsReplied: number;
  /** Median minutes between the lead's first reply and a person's first answer. */
  medianBusinessResponseMinutes: number | null;
  /** Leads that replied but no person answered. */
  repliedWithoutBusinessAnswer: number;
  stages: Record<ReportLead["stage"], number>;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeWeeklyReport(rows: ReportLead[]): WeeklyReport {
  const bySource = { form: 0, meta_lead_ads: 0, whatsapp: 0 };
  const stages = { new: 0, in_progress: 0, won: 0, lost: 0, no_reply: 0 };
  const campaigns = new Map<string, { leads: number; won: number }>();
  let contacted = 0;
  let contactedFast = 0;
  let replied = 0;
  let repliedWithoutAnswer = 0;
  const responseMinutes: number[] = [];

  for (const lead of rows) {
    bySource[lead.source] += 1;
    stages[lead.stage] += 1;

    const key = lead.campaign ?? "(sem campanha)";
    const entry = campaigns.get(key) ?? { leads: 0, won: 0 };
    entry.leads += 1;
    if (lead.stage === "won") entry.won += 1;
    campaigns.set(key, entry);

    if (lead.firstContactAt) {
      contacted += 1;
      if (lead.firstContactAt.getTime() - lead.receivedAt.getTime() <= 60_000) contactedFast += 1;
    }

    if (lead.firstLeadReplyAt) {
      replied += 1;
      if (lead.firstBusinessReplyAt && lead.firstBusinessReplyAt >= lead.firstLeadReplyAt) {
        responseMinutes.push((lead.firstBusinessReplyAt.getTime() - lead.firstLeadReplyAt.getTime()) / 60_000);
      } else if (!lead.firstBusinessReplyAt) {
        repliedWithoutAnswer += 1;
      }
    }
  }

  const medianResponse = median(responseMinutes);

  return {
    leadsReceived: rows.length,
    bySource,
    byCampaign: [...campaigns.entries()]
      .map(([campaign, v]) => ({ campaign, ...v }))
      .sort((a, b) => b.leads - a.leads),
    contactedWithinMinuteRate: contacted ? round1((contactedFast / contacted) * 100) : null,
    leadsReplied: replied,
    medianBusinessResponseMinutes: medianResponse === null ? null : round1(medianResponse),
    repliedWithoutBusinessAnswer: repliedWithoutAnswer,
    stages,
  };
}
