import { randomUUID } from "node:crypto";
import {
  ASSISTANT_DEADLINE_MS,
  brazilPhoneVariants,
  newAssistantState,
  nextOpening,
  normalizeBrazilPhone,
  pickNextOwner,
  readAssistantSettings,
} from "@post-lead/core";
import { and, eq, events, inArray, leads, operations, people, type Database } from "@post-lead/db";
import { schedule, type DbOrTx } from "./scheduling";

type LeadSource = (typeof leads.$inferInsert)["source"];

export type NewLeadInput = {
  operationId: string;
  contactName?: string | null;
  contactEmail?: string | null;
  phone: string;
  source: LeadSource;
  campaign?: string | null;
  ad?: string | null;
  utm?: Record<string, string> | null;
  whatsappConsent: boolean;
  ctwaClid?: string | null;
  knownContact?: boolean;
  /** When the lead wrote; defaults to now. Response times are measured from here. */
  receivedAt?: Date;
};

export type NewLeadResult =
  /** assistant: the pre-attendance assistant talks first; the owner hears at handoff. */
  | { status: "created"; leadId: string; assistant: boolean }
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
 * Creates a lead, assigns an owner by rotation, tells the owner and schedules
 * the automatic first reply. Every lead writes first, so the reply is free
 * text inside the 24-hour window.
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
    const useAssistant = Boolean(readAssistantSettings(operation.assistant)?.enabled) && input.whatsappConsent;
    const leadId = randomUUID();

    const [lead] = await tx
      .insert(leads)
      .values({
        id: leadId,
        assistantState: useAssistant ? newAssistantState(leadId) : null,
        operationId: operation.id,
        contactName: input.contactName ?? null,
        contactPhone: phone,
        contactEmail: input.contactEmail ?? null,
        source: input.source,
        campaign: input.campaign ?? null,
        ad: input.ad ?? null,
        utm: input.utm ?? null,
        ctwaClid: input.ctwaClid ?? null,
        knownContact: input.knownContact ?? false,
        whatsappConsent: input.whatsappConsent,
        consentAt: input.whatsappConsent ? now : null,
        ownerPersonId: ownerId,
        receivedAt: input.receivedAt ?? now,
      })
      .returning({ id: leads.id });
    if (!lead) throw new Error("Lead insert returned no row");

    if (ownerId) await tx.update(people).set({ lastAssignedAt: now }).where(eq(people.id, ownerId));

    if (useAssistant) {
      // The assistant answers now and must hand over within 15 minutes.
      await schedule(tx, { operationId: operation.id, leadId: lead.id, kind: "assistant_reply", runAt: now });
      await schedule(tx, {
        operationId: operation.id,
        leadId: lead.id,
        kind: "assistant_deadline",
        runAt: new Date(now.getTime() + ASSISTANT_DEADLINE_MS),
      });
    } else {
      if (ownerId) {
        // Nobody is woken up at night: the notice waits for the next opening.
        const notifyAt = (operation.businessHours && nextOpening(now, operation.businessHours)) || now;
        await schedule(tx, { operationId: operation.id, leadId: lead.id, kind: "notify_owner_new_lead", runAt: notifyAt });
      }
      if (input.whatsappConsent) {
        await schedule(tx, { operationId: operation.id, leadId: lead.id, kind: "first_contact", runAt: now });
      }
    }

    await tx.insert(events).values({
      operationId: operation.id,
      leadId: lead.id,
      type: "lead_received",
      payload: { source: input.source, ownerPersonId: ownerId, consent: input.whatsappConsent, assistant: useAssistant },
    });

    return { status: "created", leadId: lead.id, assistant: useAssistant };
  });
}
