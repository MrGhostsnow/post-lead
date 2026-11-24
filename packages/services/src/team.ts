import { brazilPhoneVariants, pickNextOwner } from "@post-lead/core";
import { and, eq, events, inArray, leads, operations, people, type Database } from "@post-lead/db";

export type TeamMember = {
  name: string;
  /** Normalized number, e.g. "5577999990001". */
  whatsappNumber: string;
  role: "seller" | "manager";
};

export type TeamSyncResult = {
  added: number;
  updated: number;
  deactivated: number;
  reassigned: number;
};

const OPEN_STAGES = ["new", "in_progress"] as const;

/**
 * Makes the operation's active people match `team`.
 *
 * People are matched by WhatsApp number (either Brazilian form). A match is
 * updated and reactivated, a new number is added, and anyone missing from the
 * list is deactivated rather than deleted, so lead history keeps their name.
 * Open leads owned by someone who can no longer receive them (deactivated, or
 * no longer a seller in team mode) go to the next person in the rotation.
 */
export async function syncTeam(db: Database, operationId: string, team: TeamMember[]): Promise<TeamSyncResult> {
  return db.transaction(async (tx) => {
    const [operation] = await tx.select().from(operations).where(eq(operations.id, operationId));
    if (!operation) throw new Error(`Operation ${operationId} not found`);

    const existing = await tx.select().from(people).where(eq(people.operationId, operationId));
    const result: TeamSyncResult = { added: 0, updated: 0, deactivated: 0, reassigned: 0 };
    const kept = new Set<string>();

    for (const member of team) {
      const variants = brazilPhoneVariants(member.whatsappNumber);
      const match = existing.find((p) => !kept.has(p.id) && variants.includes(p.whatsappNumber));
      if (match) {
        kept.add(match.id);
        if (match.name !== member.name || match.role !== member.role || !match.active || match.whatsappNumber !== member.whatsappNumber) {
          await tx
            .update(people)
            .set({ name: member.name, role: member.role, whatsappNumber: member.whatsappNumber, active: true, updatedAt: new Date() })
            .where(eq(people.id, match.id));
          result.updated++;
        }
      } else {
        await tx.insert(people).values({ ...member, operationId });
        result.added++;
      }
    }

    const removed = existing.filter((p) => p.active && !kept.has(p.id)).map((p) => p.id);
    if (removed.length) {
      await tx.update(people).set({ active: false, updatedAt: new Date() }).where(inArray(people.id, removed));
      result.deactivated = removed.length;
    }

    // Who may own leads now, after the changes above.
    const current = await tx.select().from(people).where(eq(people.operationId, operationId));
    const candidates = current.filter((p) => p.active && (operation.mode === "solo" || p.role === "seller"));
    const allowed = new Set(candidates.map((p) => p.id));

    const openLeads = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.operationId, operationId), inArray(leads.stage, [...OPEN_STAGES])))
      .orderBy(leads.receivedAt);
    const orphaned = openLeads.filter((l) => l.ownerPersonId && !allowed.has(l.ownerPersonId));

    const rotation = candidates.map((p) => ({ id: p.id, active: true, lastAssignedAt: p.lastAssignedAt }));
    for (const lead of orphaned) {
      const ownerId = pickNextOwner(rotation);
      const now = new Date();
      await tx.update(leads).set({ ownerPersonId: ownerId, updatedAt: now }).where(eq(leads.id, lead.id));
      if (ownerId) {
        await tx.update(people).set({ lastAssignedAt: now }).where(eq(people.id, ownerId));
        rotation.find((r) => r.id === ownerId)!.lastAssignedAt = now;
      }
      await tx.insert(events).values({
        operationId,
        leadId: lead.id,
        type: "lead_reassigned",
        payload: { from: lead.ownerPersonId, to: ownerId, reason: "team_changed" },
      });
      result.reassigned++;
    }

    return result;
  });
}
