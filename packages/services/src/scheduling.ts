import { and, eq, inArray, scheduledActions, type Database } from "@post-lead/db";

type ActionKind = (typeof scheduledActions.$inferInsert)["kind"];
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

export async function schedule(
  db: DbOrTx,
  input: {
    operationId: string;
    leadId: string | null;
    kind: ActionKind;
    runAt: Date;
    payload?: Record<string, unknown>;
  },
) {
  await db.insert(scheduledActions).values({
    operationId: input.operationId,
    leadId: input.leadId,
    kind: input.kind,
    runAt: input.runAt,
    payload: input.payload ?? {},
  });
}

export async function cancelPending(db: DbOrTx, leadId: string, kinds: ActionKind[]) {
  await db
    .update(scheduledActions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(scheduledActions.leadId, leadId),
        eq(scheduledActions.status, "pending"),
        inArray(scheduledActions.kind, kinds),
      ),
    );
}

export async function hasPending(db: DbOrTx, leadId: string, kind: ActionKind): Promise<boolean> {
  const rows = await db
    .select({ id: scheduledActions.id })
    .from(scheduledActions)
    .where(
      and(
        eq(scheduledActions.leadId, leadId),
        eq(scheduledActions.status, "pending"),
        eq(scheduledActions.kind, kind),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
