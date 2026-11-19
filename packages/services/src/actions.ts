import { planFollowUps, planStaleCheck, type WhatsAppClient } from "@post-lead/core";
import {
  and,
  eq,
  events,
  leads,
  messages,
  operations,
  people,
  scheduledActions,
  sql,
  type Database,
} from "@post-lead/db";
import { NOTIFICATION_TEMPLATES, outcomePayload } from "./notifications";
import { schedule } from "./scheduling";
import { operationCadence } from "./webhooks";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;

type Action = typeof scheduledActions.$inferSelect;
type Lead = typeof leads.$inferSelect;
type Operation = typeof operations.$inferSelect;

export type ActionContext = {
  db: Database;
  whatsapp: WhatsAppClient;
  /** Sends notifications to sellers and managers. */
  toolPhoneNumberId: string;
};

/** Puts actions left "running" by a crashed worker back in the queue. */
export async function recoverStuckActions(db: Database) {
  await db.update(scheduledActions).set({ status: "pending" }).where(eq(scheduledActions.status, "running"));
}

export async function runDueActions(ctx: ActionContext, limit = 20): Promise<number> {
  const claimed = await ctx.db.execute<{ id: string }>(sql`
    update scheduled_actions
       set status = 'running', attempts = attempts + 1, updated_at = now()
     where id in (
       select id from scheduled_actions
        where status = 'pending' and run_at <= now()
        order by run_at
        limit ${limit}
        for update skip locked
     )
    returning id
  `);

  for (const { id } of claimed) {
    const [action] = await ctx.db.select().from(scheduledActions).where(eq(scheduledActions.id, id));
    if (!action) continue;

    try {
      await execute(ctx, action);
      await ctx.db.update(scheduledActions).set({ status: "done", updatedAt: new Date() }).where(eq(scheduledActions.id, id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const giveUp = action.attempts >= MAX_ATTEMPTS;
      await ctx.db
        .update(scheduledActions)
        .set({
          status: giveUp ? "failed" : "pending",
          runAt: giveUp ? action.runAt : new Date(Date.now() + RETRY_DELAY_MS),
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(scheduledActions.id, id));
    }
  }

  return claimed.length;
}

async function execute(ctx: ActionContext, action: Action) {
  if (!action.leadId) return;
  const [lead] = await ctx.db.select().from(leads).where(eq(leads.id, action.leadId));
  const [operation] = await ctx.db.select().from(operations).where(eq(operations.id, action.operationId));
  if (!lead || !operation) return;

  switch (action.kind) {
    case "first_contact":
      return firstContact(ctx, lead, operation);
    case "follow_up":
      return followUp(ctx, lead, operation, action);
    case "notify_owner_new_lead":
      return notifyOwner(ctx, lead, NOTIFICATION_TEMPLATES.newLead, [
        firstName(lead),
        lead.contactPhone,
        sourceLabel(lead.source),
      ]);
    case "notify_owner_reply":
      return notifyOwner(ctx, lead, NOTIFICATION_TEMPLATES.leadReplied, [firstName(lead)]);
    case "owner_reminder":
      if (answeredSince(lead, action)) return;
      return notifyOwner(ctx, lead, NOTIFICATION_TEMPLATES.ownerReminder, [
        firstName(lead),
        String(operation.firstResponseMinutes),
      ]);
    case "manager_alert":
      if (answeredSince(lead, action)) return;
      return alertManagers(ctx, lead, operation);
    case "stale_check":
      return staleCheck(ctx, lead, operation);
  }
}

const isClosed = (lead: Lead) => lead.stage === "won" || lead.stage === "lost" || lead.stage === "no_reply";

function firstName(lead: Lead) {
  return lead.contactName?.trim().split(/\s+/)[0] || "tudo bem";
}

function sourceLabel(source: Lead["source"]) {
  return { form: "formulário", meta_lead_ads: "anúncio", whatsapp: "WhatsApp" }[source];
}

function answeredSince(lead: Lead, action: Action) {
  const since = typeof action.payload.since === "string" ? new Date(action.payload.since) : null;
  return Boolean(since && lead.lastBusinessReplyAt && lead.lastBusinessReplyAt >= since);
}

function leadTemplateOptions(lead: Lead, operation: Operation) {
  return {
    languageCode: operation.cadence.languageCode ?? "pt_BR",
    bodyParams: operation.cadence.firstNameParam === false ? [] : [firstName(lead)],
  };
}

async function recordOutbound(ctx: ActionContext, lead: Lead, waMessageId: string, body: string) {
  const now = new Date();
  await ctx.db.insert(messages).values({
    operationId: lead.operationId,
    leadId: lead.id,
    waMessageId,
    direction: "outbound",
    sender: "automation",
    type: "template",
    body,
    sentAt: now,
  });
  return now;
}

async function firstContact(ctx: ActionContext, lead: Lead, operation: Operation) {
  // Skip if the lead already wrote, has no opt-in, or the client number is not connected yet.
  if (lead.lastInboundAt || !lead.whatsappConsent || !operation.phoneNumberId || isClosed(lead)) return;

  const template = operation.cadence.firstContactTemplate;
  const id = await ctx.whatsapp.sendTemplate({
    phoneNumberId: operation.phoneNumberId,
    to: lead.contactPhone,
    template,
    ...leadTemplateOptions(lead, operation),
  });
  const sentAt = await recordOutbound(ctx, lead, id, `template:${template}`);

  await ctx.db.update(leads).set({ firstContactAt: sentAt, lastOutboundAt: sentAt, updatedAt: sentAt }).where(eq(leads.id, lead.id));

  const cadence = operationCadence(operation);
  const steps = planFollowUps(sentAt, cadence);
  for (const step of steps) {
    await schedule(ctx.db, {
      operationId: operation.id,
      leadId: lead.id,
      kind: "follow_up",
      runAt: step.runAt,
      payload: step.kind === "follow_up" ? { step: step.step, template: step.template, isLast: step.step === steps.length } : {},
    });
  }
  // No follow-ups configured: still close the loop after Y days.
  if (steps.length === 0) {
    await schedule(ctx.db, { operationId: operation.id, leadId: lead.id, ...planStaleCheck(sentAt, cadence) });
  }

  await ctx.db.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "first_contact_sent", payload: { template } });
}

async function followUp(ctx: ActionContext, lead: Lead, operation: Operation, action: Action) {
  if (lead.lastInboundAt || lead.lastBusinessReplyAt || isClosed(lead) || !operation.phoneNumberId) return;

  const template = String(action.payload.template ?? "");
  if (!template) throw new Error("follow_up without template");

  const id = await ctx.whatsapp.sendTemplate({
    phoneNumberId: operation.phoneNumberId,
    to: lead.contactPhone,
    template,
    ...leadTemplateOptions(lead, operation),
  });
  const sentAt = await recordOutbound(ctx, lead, id, `template:${template}`);
  await ctx.db.update(leads).set({ lastOutboundAt: sentAt, updatedAt: sentAt }).where(eq(leads.id, lead.id));

  // After the last follow-up, wait Y days; stale_check marks the lead "no_reply" if it never answered.
  if (action.payload.isLast) {
    await schedule(ctx.db, { operationId: operation.id, leadId: lead.id, ...planStaleCheck(sentAt, operationCadence(operation)) });
  }

  await ctx.db.insert(events).values({
    operationId: operation.id,
    leadId: lead.id,
    type: "follow_up_sent",
    payload: { step: action.payload.step ?? null, template },
  });
}

async function notifyOwner(ctx: ActionContext, lead: Lead, template: string, bodyParams: string[]) {
  if (!lead.ownerPersonId) return;
  const [owner] = await ctx.db.select().from(people).where(eq(people.id, lead.ownerPersonId));
  if (!owner?.active) return;

  await ctx.whatsapp.sendTemplate({ phoneNumberId: ctx.toolPhoneNumberId, to: owner.whatsappNumber, template, bodyParams });
}

async function alertManagers(ctx: ActionContext, lead: Lead, operation: Operation) {
  const managers = await ctx.db
    .select()
    .from(people)
    .where(and(eq(people.operationId, operation.id), eq(people.role, "manager"), eq(people.active, true)));

  const [owner] = lead.ownerPersonId
    ? await ctx.db.select().from(people).where(eq(people.id, lead.ownerPersonId))
    : [];
  const waited = String(operation.firstResponseMinutes * 2);

  for (const manager of managers) {
    if (manager.id === owner?.id) continue; // Solo mode: the owner already got the reminder.
    await ctx.whatsapp.sendTemplate({
      phoneNumberId: ctx.toolPhoneNumberId,
      to: manager.whatsappNumber,
      template: NOTIFICATION_TEMPLATES.managerAlert,
      bodyParams: [firstName(lead), owner?.name ?? "sem responsável", waited],
    });
  }

  await ctx.db.insert(events).values({
    operationId: operation.id,
    leadId: lead.id,
    type: "manager_alerted",
    payload: { managers: managers.length },
  });
}

async function staleCheck(ctx: ActionContext, lead: Lead, operation: Operation) {
  if (isClosed(lead)) return;

  // Never answered the automatic contacts: close as "no_reply", send nothing else.
  if (!lead.lastInboundAt) {
    await ctx.db.update(leads).set({ stage: "no_reply", updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await ctx.db.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "marked_no_reply", payload: {} });
    return;
  }

  // The conversation stalled: ask the owner for the outcome, one tap.
  await askOutcome(ctx, lead);
  await ctx.db.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "outcome_requested", payload: {} });
}

async function askOutcome(ctx: ActionContext, lead: Lead) {
  if (!lead.ownerPersonId) return;
  const [owner] = await ctx.db.select().from(people).where(eq(people.id, lead.ownerPersonId));
  if (!owner?.active) return;

  await ctx.whatsapp.sendTemplate({
    phoneNumberId: ctx.toolPhoneNumberId,
    to: owner.whatsappNumber,
    template: NOTIFICATION_TEMPLATES.askOutcome,
    bodyParams: [firstName(lead)],
    quickReplyPayloads: [
      { index: 0, payload: outcomePayload("won", lead.id) },
      { index: 1, payload: outcomePayload("lost", lead.id) },
      { index: 2, payload: outcomePayload("open", lead.id) },
    ],
  });
}
