/**
 * Templates sent from the tool's own number to sellers and managers.
 * Each one must be created and approved in WhatsApp Manager under these names,
 * in Portuguese (pt_BR), with the body variables listed here.
 */
export const NOTIFICATION_TEMPLATES = {
  /** {{1}} lead name, {{2}} lead phone, {{3}} source. */
  newLead: "notify_new_lead",
  /** {{1}} lead name. */
  leadReplied: "notify_lead_replied",
  /** {{1}} lead name, {{2}} minutes waiting. */
  ownerReminder: "notify_owner_reminder",
  /** {{1}} lead name, {{2}} owner name, {{3}} minutes waiting. */
  managerAlert: "notify_manager_alert",
  /**
   * {{1}} lead name. Three quick-reply buttons, in this order:
   * "Ganhou", "Perdeu", "Segue negociando".
   */
  askOutcome: "ask_lead_outcome",
  /**
   * {{1}} client name, {{2}} leads received, {{3}} % contacted within 1 minute,
   * {{4}} leads that replied, {{5}} median minutes for a person to answer,
   * {{6}} replied but nobody answered, {{7}} won.
   */
  weeklyReport: "weekly_report",
} as const;

export type Outcome = "won" | "lost" | "open";

const OUTCOME_PREFIX = "outcome";

export function outcomePayload(outcome: Outcome, leadId: string): string {
  return `${OUTCOME_PREFIX}:${outcome}:${leadId}`;
}

export function parseOutcomePayload(payload: string): { outcome: Outcome; leadId: string } | null {
  const [prefix, outcome, leadId] = payload.split(":");
  if (prefix !== OUTCOME_PREFIX || !leadId) return null;
  if (outcome !== "won" && outcome !== "lost" && outcome !== "open") return null;
  return { outcome, leadId };
}
