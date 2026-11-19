import { brazilPhoneVariants, normalizeBrazilPhone, pickNextOwner } from "@post-lead/core";
import { and, eq, events, inArray, leads, operations, people, type Database } from "@post-lead/db";
import { schedule, type DbOrTx } from "./scheduling";

type LeadSource = (typeof leads.$inferInsert)["source"];

export type NewLeadInput = {
  operationId: string;
  contactName?: string | null;
  phone: string;
  source: LeadSource;
  campaign?: string | null;
  ad?: string | null;
  utm?: Record<string, string> | null;
  whatsappConsent: boolean;
};

export type NewLeadResult =
  | { status: "created"; leadId: string }
  | { status: "duplicate"; leadId: string }
  | { status: "invalid_phone" };

export async function findLeadByPhone(db: DbOrTx, operationId: string, phone: string) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.operationId, operationId), inArray(leads.contactPhone, brazilPhoneVariants(phone))))
    .limit(1);
  return lead ?? null;
}

/**
 * Creates a lead, assigns an owner by rotation, and schedules the first
 * automatic contact. A lead that writes first (source "whatsapp") gets no
 * first contact: it already started the conversation.
 */
export async function createLead(db: Database, input: NewLeadInput): Promise<NewLeadResult> {
  const phone = normalizeBrazilPhone(input.phone);
  if (!phone) return { status: "invalid_phone" };

  return db.transaction(async (tx) => {
    const existing = await findLeadByPhone(tx, input.operationId, phone);
    if (existing) {
      await tx.insert(events).values({
        operationId: input.operationId,
        leadId: existing.id,
        type: "lead_resubmitted",
        payload: { source: input.source, campaign: input.campaign ?? null },
      });
      return { status: "duplicate", leadId: existing.id };
    }

    const [operation] = await tx.select().from(operations).where(eq(operations.id, input.operationId));
    if (!operation) throw new Error(`Operation ${input.operationId} not found`);

    // Solo mode: the single person gets every lead, whatever their role.
    const candidates = await tx
      .select()
      .from(people)
      .where(
        operation.mode === "solo"
          ? eq(people.operationId, operation.id)
          : and(eq(people.operationId, operation.id), eq(people.role, "seller")),
      );
    const ownerId = pickNextOwner(candidates);
    const now = new Date();

    const [lead] = await tx
      .insert(leads)
      .values({
        operationId: operation.id,
        contactName: input.contactName ?? null,
        contactPhone: phone,
        source: input.source,
        campaign: input.campaign ?? null,
        ad: input.ad ?? null,
        utm: input.utm ?? null,
        whatsappConsent: input.whatsappConsent,
        consentAt: input.whatsappConsent ? now : null,
        ownerPersonId: ownerId,
        receivedAt: now,
      })
      .returning({ id: leads.id });
    if (!lead) throw new Error("Lead insert returned no row");

    if (ownerId) {
      await tx.update(people).set({ lastAssignedAt: now }).where(eq(people.id, ownerId));
      await schedule(tx, { operationId: operation.id, leadId: lead.id, kind: "notify_owner_new_lead", runAt: now });
    }

    if (input.source !== "whatsapp" && input.whatsappConsent) {
      await schedule(tx, { operationId: operation.id, leadId: lead.id, kind: "first_contact", runAt: now });
    }

    await tx.insert(events).values({
      operationId: operation.id,
      leadId: lead.id,
      type: "lead_received",
      payload: { source: input.source, ownerPersonId: ownerId, consent: input.whatsappConsent },
    });

    return { status: "created", leadId: lead.id };
  });
}
