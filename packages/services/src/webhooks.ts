import { createHash } from "node:crypto";
import {
  isWithinBusinessHours,
  nextOpening,
  parseLeadgenWebhook,
  parseWhatsAppWebhook,
  planResponseEscalation,
  planStaleCheck,
  type BusinessEchoEvent,
  type CadenceConfig,
  type InboundMessageEvent,
  type MetaLeadsClient,
  type StatusEvent,
} from "@post-lead/core";
import { eq, events, leads, messages, operations, sql, webhookEvents, type Database } from "@post-lead/db";
import { handleLeadgen } from "./leadAds";
import { createLead, findLeadByPhone } from "./leads";
import { parseOutcomePayload } from "./notifications";
import { cancelPending, hasPending, schedule } from "./scheduling";

const MAX_ATTEMPTS = 5;
const OUT_OF_HOURS_REPLY_GAP_MS = 12 * 60 * 60 * 1000;

export const WEBHOOK_PROVIDERS = { whatsapp: "whatsapp", metaLeadgen: "meta_leadgen" } as const;

/** Stores a raw webhook. Returns false when the same payload was already stored. */
export async function storeWebhook(db: Database, provider: string, rawBody: string): Promise<boolean> {
  const dedupeKey = createHash("sha256").update(rawBody).digest("hex");
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, dedupeKey, payload: JSON.parse(rawBody) })
    .onConflictDoNothing({ target: webhookEvents.dedupeKey })
    .returning({ id: webhookEvents.id });
  return inserted.length > 0;
}

export function operationCadence(operation: typeof operations.$inferSelect): CadenceConfig {
  return {
    firstContactTemplate: operation.cadence.firstContactTemplate,
    followUps: operation.cadence.followUps,
    firstResponseMinutes: operation.firstResponseMinutes,
    staleDays: operation.staleDays,
  };
}

/**
 * Claims unprocessed webhooks and applies them. The MVP runs a single worker;
 * the attempts counter stops a poisonous payload from looping forever.
 */
export async function processPendingWebhooks(
  db: Database,
  options: { toolPhoneNumberId: string; leadsClient?: MetaLeadsClient; limit?: number },
): Promise<number> {
  const claimed = await db.execute<{ id: string; provider: string; payload: unknown }>(sql`
    update webhook_events
       set attempts = attempts + 1
     where id in (
       select id from webhook_events
        where processed_at is null and attempts < ${MAX_ATTEMPTS}
        order by received_at
        limit ${options.limit ?? 20}
        for update skip locked
     )
    returning id, provider, payload
  `);

  for (const row of claimed) {
    try {
      if (row.provider === WEBHOOK_PROVIDERS.metaLeadgen) {
        if (!options.leadsClient) throw new Error("Lead Ads webhook received but no leads client is configured");
        for (const event of parseLeadgenWebhook(row.payload)) {
          await handleLeadgen(db, options.leadsClient, event);
        }
      }
      for (const event of row.provider === WEBHOOK_PROVIDERS.whatsapp ? parseWhatsAppWebhook(row.payload) : []) {
        if (event.kind === "inbound_message") {
          if (event.phoneNumberId === options.toolPhoneNumberId) await handlePersonReply(db, event);
          else await handleLeadMessage(db, event);
        } else if (event.kind === "business_echo") {
          await handleBusinessEcho(db, event);
        } else {
          await handleStatus(db, event);
        }
      }
      await db.update(webhookEvents).set({ processedAt: new Date(), lastError: null }).where(eq(webhookEvents.id, row.id));
    } catch (error) {
      await db
        .update(webhookEvents)
        .set({ lastError: error instanceof Error ? error.message : String(error) })
        .where(eq(webhookEvents.id, row.id));
    }
  }

  return claimed.length;
}

async function operationByPhoneNumberId(db: Database, phoneNumberId: string) {
  const [operation] = await db.select().from(operations).where(eq(operations.phoneNumberId, phoneNumberId));
  return operation ?? null;
}

/** A lead wrote to the client's number. */
async function handleLeadMessage(db: Database, event: InboundMessageEvent) {
  const operation = await operationByPhoneNumberId(db, event.phoneNumberId);
  if (!operation) return;

  let lead = await findLeadByPhone(db, operation.id, event.from);
  if (!lead) {
    // Writing first is the lead's own opt-in to be answered on WhatsApp.
    const created = await createLead(db, {
      operationId: operation.id,
      contactName: event.contactName,
      phone: event.from,
      source: "whatsapp",
      whatsappConsent: true,
    });
    if (created.status === "invalid_phone") return;
    lead = await findLeadByPhone(db, operation.id, event.from);
    if (!lead) return;
  }

  const inserted = await db
    .insert(messages)
    .values({
      operationId: operation.id,
      leadId: lead.id,
      waMessageId: event.waMessageId,
      direction: "inbound",
      sender: "lead",
      type: event.type,
      body: event.text,
      sentAt: event.timestamp,
    })
    .onConflictDoNothing({ target: messages.waMessageId })
    .returning({ id: messages.id });
  if (inserted.length === 0) return; // Already handled.

  const cadence = operationCadence(operation);
  const leadId = lead.id;

  // Opt-out offered in the last follow-up: stop everything, never message again.
  if (event.text?.trim().toUpperCase() === "SAIR") {
    await db.transaction(async (tx) => {
      await tx
        .update(leads)
        .set({ whatsappConsent: false, lastInboundAt: event.timestamp, updatedAt: new Date() })
        .where(eq(leads.id, leadId));
      await cancelPending(tx, leadId, ["first_contact", "follow_up", "stale_check", "owner_reminder", "manager_alert"]);
      await tx.insert(events).values({ operationId: operation.id, leadId, type: "opted_out", payload: {} });
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        lastInboundAt: event.timestamp,
        firstLeadReplyAt: lead.firstLeadReplyAt ?? event.timestamp,
        contactName: lead.contactName ?? event.contactName,
        stage: lead.stage === "new" || lead.stage === "no_reply" ? "in_progress" : lead.stage,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    // The lead answered: automatic follow-ups stop immediately.
    await cancelPending(tx, leadId, ["first_contact", "follow_up", "stale_check"]);
    await schedule(tx, { operationId: operation.id, leadId, ...planStaleCheck(event.timestamp, cadence) });

    const hours = operation.businessHours;
    const isOpen = !hours || isWithinBusinessHours(event.timestamp, hours);

    // Outside business hours: tell the lead when they will be answered (once per 12h).
    const lastOohReply = lead.lastOutOfHoursReplyAt?.getTime() ?? 0;
    if (!isOpen && operation.cadence.outOfHoursMessage && event.timestamp.getTime() - lastOohReply > OUT_OF_HOURS_REPLY_GAP_MS) {
      await schedule(tx, { operationId: operation.id, leadId, kind: "out_of_hours_reply", runAt: new Date() });
    }

    // Start the clock for a person to answer, unless it is already running.
    // Outside business hours, the notification and the clock wait for the next opening.
    // Meta may deliver a person's answer before the lead message it answers.
    const alreadyAnswered = Boolean(lead.lastBusinessReplyAt && lead.lastBusinessReplyAt >= event.timestamp);
    if (!alreadyAnswered && !(await hasPending(tx, leadId, "owner_reminder"))) {
      const notifyAt = (hours && nextOpening(new Date(), hours)) || new Date();
      await schedule(tx, { operationId: operation.id, leadId, kind: "notify_owner_reply", runAt: notifyAt });
      for (const action of planResponseEscalation(event.timestamp, cadence, hours)) {
        await schedule(tx, {
          operationId: operation.id,
          leadId,
          kind: action.kind,
          runAt: action.runAt,
          payload: { since: event.timestamp.toISOString() },
        });
      }
    }

    await tx.insert(events).values({ operationId: operation.id, leadId, type: "lead_replied", payload: {} });
  });
}

/** Someone at the client answered from the WhatsApp Business app (coexistence). */
async function handleBusinessEcho(db: Database, event: BusinessEchoEvent) {
  const operation = await operationByPhoneNumberId(db, event.phoneNumberId);
  if (!operation) return;

  const lead = await findLeadByPhone(db, operation.id, event.to);
  if (!lead) return; // Not a lead: personal or unrelated chat.

  const inserted = await db
    .insert(messages)
    .values({
      operationId: operation.id,
      leadId: lead.id,
      waMessageId: event.waMessageId,
      direction: "outbound",
      sender: "business_app",
      type: event.type,
      body: event.text,
      sentAt: event.timestamp,
    })
    .onConflictDoNothing({ target: messages.waMessageId })
    .returning({ id: messages.id });
  if (inserted.length === 0) return;

  const cadence = operationCadence(operation);

  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        firstBusinessReplyAt: lead.firstBusinessReplyAt ?? event.timestamp,
        lastBusinessReplyAt: event.timestamp,
        lastOutboundAt: event.timestamp,
        stage: lead.stage === "new" ? "in_progress" : lead.stage,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));

    // A person took over: no reminders, alerts or automatic follow-ups.
    await cancelPending(tx, lead.id, ["first_contact", "follow_up", "owner_reminder", "manager_alert", "stale_check"]);
    await schedule(tx, { operationId: operation.id, leadId: lead.id, ...planStaleCheck(event.timestamp, cadence) });

    await tx.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "business_replied", payload: {} });
  });
}

/** A seller or manager tapped a button in a notification sent by the tool's number. */
async function handlePersonReply(db: Database, event: InboundMessageEvent) {
  const parsed = event.buttonPayload ? parseOutcomePayload(event.buttonPayload) : null;
  if (!parsed) return;

  const [lead] = await db.select().from(leads).where(eq(leads.id, parsed.leadId));
  if (!lead) return;

  if (parsed.outcome === "open") {
    const [operation] = await db.select().from(operations).where(eq(operations.id, lead.operationId));
    if (operation) {
      await schedule(db, { operationId: lead.operationId, leadId: lead.id, ...planStaleCheck(new Date(), operationCadence(operation)) });
    }
  } else {
    await db.update(leads).set({ stage: parsed.outcome, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await cancelPending(db, lead.id, ["follow_up", "owner_reminder", "manager_alert", "stale_check"]);
  }

  await db.insert(events).values({
    operationId: lead.operationId,
    leadId: lead.id,
    type: "outcome_recorded",
    payload: { outcome: parsed.outcome, from: event.from },
  });
}

async function handleStatus(db: Database, event: StatusEvent) {
  await db.update(messages).set({ status: event.status }).where(eq(messages.waMessageId, event.waMessageId));
}
