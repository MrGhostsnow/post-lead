/**
 * "Temperature" of an open lead, shown as a colour in the panel and the
 * client link. It answers one question: does someone need to act now?
 */

export type Temperature =
  /** Nothing pending from the business. */
  | "ok"
  /** The business owes an answer, still within X minutes. */
  | "waiting"
  /** The business owes an answer for more than X minutes. */
  | "late"
  /** Won, lost or no reply. */
  | "closed";

export type TemperatureLead = {
  stage: "new" | "in_progress" | "won" | "lost" | "no_reply";
  lastInboundAt: Date | null;
  lastBusinessReplyAt: Date | null;
  /** The assistant is still talking to the lead: nobody owes an answer yet. */
  assistantActive?: boolean;
  /** When the assistant passed the lead on; the X minutes count from here. */
  handedOffAt?: Date | null;
};

export function leadTemperature(lead: TemperatureLead, now: Date, firstResponseMinutes: number): Temperature {
  if (lead.stage === "won" || lead.stage === "lost" || lead.stage === "no_reply") return "closed";

  const leadIsWaiting =
    lead.lastInboundAt !== null &&
    (lead.lastBusinessReplyAt === null || lead.lastBusinessReplyAt < lead.lastInboundAt);

  if (!leadIsWaiting || lead.assistantActive) return "ok";

  const since = Math.max(lead.lastInboundAt!.getTime(), lead.handedOffAt?.getTime() ?? 0);
  const waitedMs = now.getTime() - since;
  return waitedMs > firstResponseMinutes * 60_000 ? "late" : "waiting";
}
