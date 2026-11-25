import "server-only";
import { computeWeeklyReport, HANDOFF_LABEL, leadTemperature, readAssistantState, type Temperature } from "@post-lead/core";
import { and, contacts, desc, eq, events, gte, historyMessages, inArray, isNotNull, leads, operations, people, sql } from "@post-lead/db";
import { getDb } from "./server";

type Operation = typeof operations.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function operationsOverview(agencyIds: string[]) {
  if (agencyIds.length === 0) return [];
  const db = getDb();
  const ops = await db.select().from(operations).where(inArray(operations.agencyId, agencyIds)).orderBy(operations.name);
  if (ops.length === 0) return [];

  const since = new Date(Date.now() - 7 * DAY_MS);
  const openRows = await db
    .select({
      operationId: leads.operationId,
      stage: leads.stage,
      receivedAt: leads.receivedAt,
      lastInboundAt: leads.lastInboundAt,
      lastBusinessReplyAt: leads.lastBusinessReplyAt,
    })
    .from(leads)
    .where(inArray(leads.operationId, ops.map((o) => o.id)));

  const now = new Date();
  return ops.map((op) => {
    const rows = openRows.filter((r) => r.operationId === op.id);
    const temps = rows.map((r) => leadTemperature(r, now, op.firstResponseMinutes));
    return {
      operation: op,
      leadsLast7Days: rows.filter((r) => r.receivedAt >= since).length,
      open: temps.filter((t) => t !== "closed").length,
      late: temps.filter((t) => t === "late").length,
      waiting: temps.filter((t) => t === "waiting").length,
    };
  });
}

export type LeadRow = {
  id: string;
  contactName: string | null;
  contactPhone: string;
  source: string;
  campaign: string | null;
  knownContact: boolean;
  stage: string;
  saleValueCents: number | null;
  /** "Com a IA", or the handoff reason, for leads that went through the assistant. */
  assistantLabel: string | null;
  handoffSummary: string | null;
  ownerName: string | null;
  receivedAt: Date;
  temperature: Temperature;
};

export async function operationLeads(operation: Operation, limit = 100): Promise<LeadRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: leads.id,
      contactName: leads.contactName,
      contactPhone: leads.contactPhone,
      source: leads.source,
      campaign: leads.campaign,
      knownContact: leads.knownContact,
      stage: leads.stage,
      saleValueCents: leads.saleValueCents,
      assistantState: leads.assistantState,
      handedOffAt: leads.handedOffAt,
      handoffSummary: leads.handoffSummary,
      receivedAt: leads.receivedAt,
      lastInboundAt: leads.lastInboundAt,
      lastBusinessReplyAt: leads.lastBusinessReplyAt,
      ownerName: people.name,
    })
    .from(leads)
    .leftJoin(people, eq(people.id, leads.ownerPersonId))
    .where(eq(leads.operationId, operation.id))
    .orderBy(desc(leads.receivedAt))
    .limit(limit);

  const now = new Date();
  const order: Record<Temperature, number> = { late: 0, waiting: 1, ok: 2, closed: 3 };
  return rows
    .map(({ assistantState, ...r }) => {
      const state = readAssistantState(assistantState);
      const assistantActive = state?.status === "active";
      return {
        ...r,
        assistantLabel: !state
          ? null
          : assistantActive
            ? "Com a IA agora"
            : state.status === "stopped"
              ? "Vendedor assumiu da IA"
              : `IA passou: ${HANDOFF_LABEL[state.handoffReason ?? "complete"]}`,
        temperature: leadTemperature({ ...r, assistantActive }, now, operation.firstResponseMinutes),
      };
    })
    .sort((a, b) => order[a.temperature] - order[b.temperature]);
}

export async function operationPeople(operationId: string) {
  return getDb().select().from(people).where(eq(people.operationId, operationId)).orderBy(people.role, people.name);
}

export async function lastSevenDays(operationId: string) {
  const rows = await getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.operationId, operationId), gte(leads.receivedAt, new Date(Date.now() - 7 * DAY_MS))));
  return computeWeeklyReport(rows);
}

/** What activation brought in: history, known contacts, and numbers marked as not a lead. */
export async function activationSummary(operationId: string) {
  const db = getDb();
  const [history] = await db
    .select({ messages: sql<number>`count(*)::int`, since: sql<Date | null>`min(${historyMessages.sentAt})` })
    .from(historyMessages)
    .where(eq(historyMessages.operationId, operationId));
  const [known] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.operationId, operationId), sql`(${contacts.inAddressBook} or ${contacts.lastMessageAt} is not null)`));
  const [ignored] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(and(eq(contacts.operationId, operationId), isNotNull(contacts.ignoredAt)));
  const [declined] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.operationId, operationId), eq(events.type, "history_declined")));
  return {
    historyMessages: history?.messages ?? 0,
    historySince: history?.since ? new Date(history.since) : null,
    knownContacts: known?.count ?? 0,
    ignored: ignored?.count ?? 0,
    historyDeclined: (declined?.count ?? 0) > 0,
  };
}

export async function weeklyReports(operationId: string, limit = 6) {
  const rows = await getDb()
    .select({ createdAt: events.createdAt, payload: events.payload })
    .from(events)
    .where(and(eq(events.operationId, operationId), eq(events.type, "weekly_report")))
    .orderBy(desc(events.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    createdAt: r.createdAt,
    report: (r.payload as { report?: ReturnType<typeof computeWeeklyReport> }).report ?? null,
  }));
}

export async function stageCounts(operationId: string) {
  const rows = await getDb()
    .select({ stage: leads.stage, count: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.operationId, operationId))
    .groupBy(leads.stage);
  const counts = { new: 0, in_progress: 0, won: 0, lost: 0, no_reply: 0 };
  for (const r of rows) counts[r.stage] = r.count;
  return counts;
}
