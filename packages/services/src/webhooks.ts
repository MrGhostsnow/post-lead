import { createHash } from "node:crypto";
import {
  brazilPhoneVariants,
  classifyNewNumber,
  isWithinBusinessHours,
  nextOpening,
  parseSaleValue,
  parseWhatsAppWebhook,
  planResponseEscalation,
  planStaleCheck,
  type BusinessEchoEvent,
  type CadenceConfig,
  type ContactSyncEvent,
  type HistoryEvent,
  type InboundMessageEvent,
  type StatusEvent,
} from "@post-lead/core";
import {
  and,
  contacts,
  eq,
  events,
  historyMessages,
  inArray,
  isNotNull,
  leads,
  messages,
  operations,
  people,
  sql,
  webhookEvents,
  type Database,
} from "@post-lead/db";
import { createLead, findLeadByPhone } from "./leads";
import { parseButtonPayload } from "./notifications";
import { cancelPending, hasPending, schedule } from "./scheduling";

const MAX_ATTEMPTS = 5;
const OUT_OF_HOURS_REPLY_GAP_MS = 12 * 60 * 60 * 1000;

export const WEBHOOK_PROVIDERS = { whatsapp: "whatsapp" } as const;

/** Every automatic step that stops once a person or the lead moves the conversation. */
const AUTOMATION = ["first_contact", "follow_up", "stale_check", "reengagement"] as const;

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
  options: { toolPhoneNumberId: string; limit?: number },
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
      for (const event of row.provider === WEBHOOK_PROVIDERS.whatsapp ? parseWhatsAppWebhook(row.payload) : []) {
        if (event.kind === "inbound_message") {
          if (event.phoneNumberId === options.toolPhoneNumberId) await handlePersonReply(db, event);
          else await handleLeadMessage(db, event);
        } else if (event.kind === "business_echo") {
          await handleBusinessEcho(db, event);
        } else if (event.kind === "history") {
          await handleHistory(db, event);
        } else if (event.kind === "contact_sync") {
          await handleContactSync(db, event);
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

async function findContact(db: Database, operationId: string, phone: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.operationId, operationId), inArray(contacts.phone, brazilPhoneVariants(phone))))
    .limit(1);
  return contact ?? null;
}

/** Remembers that the client talks to this number. Never moves lastMessageAt backwards. */
async function touchContact(
  db: Database,
  operationId: string,
  phone: string,
  patch: { lastMessageAt?: Date; name?: string | null; inAddressBook?: boolean; ignoredAt?: Date },
) {
  const existing = await findContact(db, operationId, phone);
  const now = new Date();
  if (existing) {
    await db
      .update(contacts)
      .set({
        ...(patch.lastMessageAt && (!existing.lastMessageAt || patch.lastMessageAt > existing.lastMessageAt)
          ? { lastMessageAt: patch.lastMessageAt }
          : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.inAddressBook !== undefined ? { inAddressBook: patch.inAddressBook } : {}),
        ...(patch.ignoredAt ? { ignoredAt: patch.ignoredAt } : {}),
        updatedAt: now,
      })
      .where(eq(contacts.id, existing.id));
    return;
  }
  await db
    .insert(contacts)
    .values({
      operationId,
      phone,
      name: patch.name ?? null,
      inAddressBook: patch.inAddressBook ?? false,
      lastMessageAt: patch.lastMessageAt ?? null,
      ignoredAt: patch.ignoredAt ?? null,
    })
    .onConflictDoNothing();
}

/**
 * A number wrote to the client's WhatsApp. An existing lead continues its
 * conversation; a new number becomes a lead or not (see classifyNewNumber).
 */
async function handleLeadMessage(db: Database, event: InboundMessageEvent) {
  const operation = await operationByPhoneNumberId(db, event.phoneNumberId);
  if (!operation) return;

  const lead = await findLeadByPhone(db, operation.id, event.from);
  if (!lead) return handleNewNumber(db, operation, event);

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
      await cancelPending(tx, leadId, [...AUTOMATION, "owner_reminder", "manager_alert"]);
      await tx.insert(events).values({ operationId: operation.id, leadId, type: "opted_out", payload: {} });
    });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(leads)
      .set({
        lastInboundAt: event.timestamp,
        // A reply means writing after the automatic first reply, not the opening messages.
        firstLeadReplyAt: lead.firstLeadReplyAt ?? (lead.firstContactAt ? event.timestamp : null),
        contactName: lead.contactName ?? event.contactName,
        stage: lead.stage === "new" || lead.stage === "no_reply" ? "in_progress" : lead.stage,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));

    // The lead answered: automatic follow-ups and any planned resumption stop immediately.
    // A second message before the first reply went out must not cancel that reply.
    await cancelPending(tx, leadId, lead.firstContactAt ? [...AUTOMATION] : ["follow_up", "stale_check", "reengagement"]);
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

type OperationRow = typeof operations.$inferSelect;

/** First message from a number with no lead. */
async function handleNewNumber(db: Database, operation: OperationRow, event: InboundMessageEvent) {
  const contact = await findContact(db, operation.id, event.from);
  const fromAd = event.referral?.sourceType === "ad" || Boolean(event.referral?.ctwaClid);
  const decision = classifyNewNumber({ fromAd, contact });

  if (decision.kind === "ignore") {
    // A contact the client already talks to keeps being a contact; nothing is stored about the message.
    if (decision.reason === "known_contact") await touchContact(db, operation.id, event.from, { lastMessageAt: event.timestamp });
    return;
  }

  // Writing first is the lead's own opt-in to be answered on WhatsApp.
  const created = await createLead(db, {
    operationId: operation.id,
    contactName: event.contactName,
    phone: event.from,
    source: decision.source,
    campaign: decision.source === "whatsapp_ad" ? (event.referral?.headline ?? null) : null,
    ad: event.referral?.sourceId ?? null,
    ctwaClid: event.referral?.ctwaClid ?? null,
    knownContact: decision.knownContact,
    whatsappConsent: true,
    receivedAt: event.timestamp,
  });
  if (created.status === "invalid_phone") return;
  const leadId = created.leadId;

  const inserted = await db
    .insert(messages)
    .values({
      operationId: operation.id,
      leadId,
      waMessageId: event.waMessageId,
      direction: "inbound",
      sender: "lead",
      type: event.type,
      body: event.text,
      sentAt: event.timestamp,
    })
    .onConflictDoNothing({ target: messages.waMessageId })
    .returning({ id: messages.id });
  if (inserted.length === 0) return;

  const cadence = operationCadence(operation);
  await db.transaction(async (tx) => {
    await tx.update(leads).set({ lastInboundAt: event.timestamp, updatedAt: new Date() }).where(eq(leads.id, leadId));
    // The lead is waiting for a person from the first message: start the clock.
    for (const action of planResponseEscalation(event.timestamp, cadence, operation.businessHours)) {
      await schedule(tx, {
        operationId: operation.id,
        leadId,
        kind: action.kind,
        runAt: action.runAt,
        payload: { since: event.timestamp.toISOString() },
      });
    }
  });
}

/** The 180-day history Meta shares once at activation: time and direction only. */
async function handleHistory(db: Database, event: HistoryEvent) {
  const operation = await operationByPhoneNumberId(db, event.phoneNumberId);
  if (!operation) return;

  if (!event.shared) {
    await db.insert(events).values({ operationId: operation.id, type: "history_declined", payload: {} });
    return;
  }

  for (let i = 0; i < event.messages.length; i += 500) {
    const chunk = event.messages.slice(i, i + 500);
    await db
      .insert(historyMessages)
      .values(chunk.map((m) => ({
        operationId: operation.id,
        contactPhone: m.contactPhone,
        waMessageId: m.waMessageId,
        direction: m.direction,
        sentAt: m.timestamp,
      })))
      .onConflictDoNothing({ target: historyMessages.waMessageId });
  }

  const lastByContact = new Map<string, Date>();
  for (const m of event.messages) {
    const current = lastByContact.get(m.contactPhone);
    if (!current || m.timestamp > current) lastByContact.set(m.contactPhone, m.timestamp);
  }
  for (const [phone, lastMessageAt] of lastByContact) {
    await touchContact(db, operation.id, phone, { lastMessageAt });
  }

  await db.insert(events).values({
    operationId: operation.id,
    type: "history_received",
    payload: { messages: event.messages.length, contacts: lastByContact.size },
  });
}

/** The app's address book: saved numbers are not new leads. */
async function handleContactSync(db: Database, event: ContactSyncEvent) {
  const operation = await operationByPhoneNumberId(db, event.phoneNumberId);
  if (!operation) return;
  for (const c of event.contacts) {
    await touchContact(db, operation.id, c.phone, { name: c.name, inAddressBook: c.action === "add" });
  }
}

/** Someone at the client answered from the WhatsApp Business app (coexistence). */
async function handleBusinessEcho(db: Database, event: BusinessEchoEvent) {
  const operation = await operationByPhoneNumberId(db, event.phoneNumberId);
  if (!operation) return;

  const lead = await findLeadByPhone(db, operation.id, event.to);
  if (!lead) {
    // Not a lead: the client started or continued a chat. If that number writes
    // back later, it is a contact, not a new lead.
    await touchContact(db, operation.id, event.to, { lastMessageAt: event.timestamp });
    return;
  }

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
    await cancelPending(tx, lead.id, [...AUTOMATION, "owner_reminder", "manager_alert"]);
    await schedule(tx, { operationId: operation.id, leadId: lead.id, ...planStaleCheck(event.timestamp, cadence) });

    await tx.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "business_replied", payload: {} });
  });
}

/** A seller or manager answered a notification sent by the tool's number. */
async function handlePersonReply(db: Database, event: InboundMessageEvent) {
  const parsed = event.buttonPayload ? parseButtonPayload(event.buttonPayload) : null;
  if (!parsed) return recordSaleValue(db, event);

  const [lead] = await db.select().from(leads).where(eq(leads.id, parsed.leadId));
  if (!lead) return;
  const [operation] = await db.select().from(operations).where(eq(operations.id, lead.operationId));
  if (!operation) return;

  switch (parsed.action) {
    case "open":
      await schedule(db, { operationId: lead.operationId, leadId: lead.id, ...planStaleCheck(new Date(), operationCadence(operation)) });
      break;

    case "won":
    case "lost":
      await db.update(leads).set({ stage: parsed.action, updatedAt: new Date() }).where(eq(leads.id, lead.id));
      await cancelPending(db, lead.id, [...AUTOMATION, "owner_reminder", "manager_alert"]);
      if (parsed.action === "won") {
        const person = await personByNumber(db, lead.operationId, event.from);
        if (person) {
          await db.update(people).set({ pendingSaleValueLeadId: lead.id, updatedAt: new Date() }).where(eq(people.id, person.id));
          await schedule(db, { operationId: lead.operationId, leadId: lead.id, kind: "ask_sale_value", runAt: new Date(), payload: { to: event.from } });
        }
      }
      break;

    case "cancel_reengagement":
      await cancelPending(db, lead.id, ["reengagement"]);
      // Check again in Y days; the owner keeps the conversation until then.
      await schedule(db, { operationId: lead.operationId, leadId: lead.id, ...planStaleCheck(new Date(), operationCadence(operation)) });
      break;

    case "not_lead":
      // Gone for good: the lead (and its scheduled steps) is deleted and the number ignored from now on.
      await touchContact(db, lead.operationId, lead.contactPhone, { ignoredAt: new Date() });
      await db.delete(leads).where(eq(leads.id, lead.id));
      await db.insert(events).values({ operationId: lead.operationId, type: "marked_not_lead", payload: {} });
      return;
  }

  await db.insert(events).values({
    operationId: lead.operationId,
    leadId: lead.id,
    type: parsed.action === "cancel_reengagement" ? "reengagement_cancelled" : "outcome_recorded",
    payload: { action: parsed.action },
  });
}

async function personByNumber(db: Database, operationId: string, phone: string) {
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.operationId, operationId), inArray(people.whatsappNumber, brazilPhoneVariants(phone))))
    .limit(1);
  return person ?? null;
}

/** Free text after "Ganhou" is the sale value. Anything unreadable is ignored. */
async function recordSaleValue(db: Database, event: InboundMessageEvent) {
  if (!event.text) return;
  const [person] = await db
    .select()
    .from(people)
    .where(and(inArray(people.whatsappNumber, brazilPhoneVariants(event.from)), isNotNull(people.pendingSaleValueLeadId)))
    .limit(1);
  if (!person?.pendingSaleValueLeadId) return;

  const cents = parseSaleValue(event.text);
  if (cents === null) return;

  const leadId = person.pendingSaleValueLeadId;
  await db.update(leads).set({ saleValueCents: cents, updatedAt: new Date() }).where(eq(leads.id, leadId));
  await db.update(people).set({ pendingSaleValueLeadId: null, updatedAt: new Date() }).where(eq(people.id, person.id));
  await db.insert(events).values({ operationId: person.operationId, leadId, type: "sale_value_recorded", payload: { cents } });
}

async function handleStatus(db: Database, event: StatusEvent) {
  await db.update(messages).set({ status: event.status }).where(eq(messages.waMessageId, event.waMessageId));
}
