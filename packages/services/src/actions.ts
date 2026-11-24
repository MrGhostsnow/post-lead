import {
  canSendFreeform,
  computeWeeklyReport,
  isWithinBusinessHours,
  nextOpening,
  nextWeeklyReportAt,
  planFollowUps,
  planStaleCheck,
  type WhatsAppClient,
} from "@post-lead/core";
import {
  and,
  eq,
  events,
  gte,
  leads,
  lt,
  messages,
  operations,
  people,
  scheduledActions,
  sql,
  type Database,
} from "@post-lead/db";
import { buttonPayload, NOTIFICATION_TEMPLATES } from "./notifications";
import { schedule } from "./scheduling";
import { operationCadence } from "./webhooks";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;
/** Each resumption is a paid marketing template; Meta also caps how many a person receives. */
export const MAX_REENGAGEMENTS = 2;
/** Time the owner has to tap "Cancelar" before a stalled lead is resumed. */
export const REENGAGEMENT_NOTICE_MS = 2 * 60 * 60 * 1000;

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

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Makes sure every operation has its next weekly report queued. Safe to call often. */
export async function ensureWeeklyReportsScheduled(db: Database, now = new Date()) {
  const all = await db.select().from(operations);
  const queued = await db
    .select({ operationId: scheduledActions.operationId })
    .from(scheduledActions)
    .where(and(eq(scheduledActions.kind, "weekly_report"), eq(scheduledActions.status, "pending")));
  const hasQueued = new Set(queued.map((q) => q.operationId));

  for (const operation of all) {
    if (hasQueued.has(operation.id)) continue;
    await schedule(db, {
      operationId: operation.id,
      leadId: null,
      kind: "weekly_report",
      runAt: nextWeeklyReportAt(now, operation.businessHours?.timezone ?? DEFAULT_TIMEZONE),
    });
  }
}

async function execute(ctx: ActionContext, action: Action) {
  if (action.kind === "weekly_report") return weeklyReport(ctx, action);
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
      return notifyOwner(
        ctx,
        lead,
        NOTIFICATION_TEMPLATES.newLead,
        [firstName(lead), lead.contactPhone, originLabel(lead)],
        [{ index: 0, payload: buttonPayload("not_lead", lead.id) }],
      );
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
    case "out_of_hours_reply":
      return outOfHoursReply(ctx, lead, operation);
    case "reengagement":
      return reengage(ctx, lead, operation, action);
    case "ask_sale_value":
      return askSaleValue(ctx, lead, action);
  }
}

const isClosed = (lead: Lead) => lead.stage === "won" || lead.stage === "lost" || lead.stage === "no_reply";

function firstName(lead: Lead) {
  return lead.contactName?.trim().split(/\s+/)[0] || "tudo bem";
}

function originLabel(lead: Lead) {
  if (lead.source === "whatsapp_ad") {
    const ad = lead.campaign ? `anúncio ${lead.campaign}` : "anúncio";
    return lead.knownContact ? `${ad} (já era contato)` : ad;
  }
  return "origem não identificada";
}

/** The lead wrote again after the automatic first reply. */
function leadWroteAfterFirstReply(lead: Lead) {
  return Boolean(lead.lastInboundAt && lead.firstContactAt && lead.lastInboundAt > lead.firstContactAt);
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

/**
 * Answers a new lead in seconds with free text. The lead wrote first, so this
 * is inside the 24-hour window: no template, and it counts toward Meta's free
 * service messages. Outside business hours the out-of-hours message goes
 * instead, so the lead gets one message, not two.
 */
async function firstContact(ctx: ActionContext, lead: Lead, operation: Operation) {
  if (lead.firstContactAt || lead.lastBusinessReplyAt || !lead.whatsappConsent || !operation.phoneNumberId || isClosed(lead)) return;
  const now = new Date();
  if (!canSendFreeform(lead.lastInboundAt, now)) return;

  const hours = operation.businessHours;
  const closed = Boolean(hours && !isWithinBusinessHours(now, hours));
  const outOfHours = closed && operation.cadence.outOfHoursMessage ? operation.cadence.outOfHoursMessage : null;
  const text = outOfHours ?? operation.cadence.firstReplyMessage;
  if (!text) return;

  const id = await ctx.whatsapp.sendText(operation.phoneNumberId, lead.contactPhone, text);
  await ctx.db.insert(messages).values({
    operationId: lead.operationId,
    leadId: lead.id,
    waMessageId: id,
    direction: "outbound",
    sender: "automation",
    type: "text",
    body: text,
    sentAt: now,
  });
  await ctx.db
    .update(leads)
    .set({ firstContactAt: now, lastOutboundAt: now, ...(outOfHours ? { lastOutOfHoursReplyAt: now } : {}), updatedAt: now })
    .where(eq(leads.id, lead.id));

  const cadence = operationCadence(operation);
  const steps = planFollowUps(now, cadence);
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
    await schedule(ctx.db, { operationId: operation.id, leadId: lead.id, ...planStaleCheck(now, cadence) });
  }

  await ctx.db.insert(events).values({
    operationId: operation.id,
    leadId: lead.id,
    type: "first_contact_sent",
    payload: { outOfHours: Boolean(outOfHours) },
  });
}

async function followUp(ctx: ActionContext, lead: Lead, operation: Operation, action: Action) {
  // Follow-ups are for a lead who went quiet after the first reply, before anyone answered.
  if (leadWroteAfterFirstReply(lead) || lead.lastBusinessReplyAt || isClosed(lead) || !lead.whatsappConsent || !operation.phoneNumberId) return;

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

async function notifyOwner(
  ctx: ActionContext,
  lead: Lead,
  template: string,
  bodyParams: string[],
  quickReplyPayloads?: { index: number; payload: string }[],
) {
  if (!lead.ownerPersonId) return false;
  const [owner] = await ctx.db.select().from(people).where(eq(people.id, lead.ownerPersonId));
  if (!owner?.active) return false;

  await ctx.whatsapp.sendTemplate({
    phoneNumberId: ctx.toolPhoneNumberId,
    to: owner.whatsappNumber,
    template,
    bodyParams,
    ...(quickReplyPayloads ? { quickReplyPayloads } : {}),
  });
  return true;
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

/**
 * Runs Y days after the last message. Two cases:
 * - The lead never engaged beyond its first message: close as "no_reply".
 * - A conversation stalled midway: warn the owner, with a "Cancelar" button,
 *   and resume the lead on its own if nobody cancels. After the last allowed
 *   resumption, ask the owner for the outcome instead.
 */
async function staleCheck(ctx: ActionContext, lead: Lead, operation: Operation) {
  if (isClosed(lead)) return;

  if (!leadWroteAfterFirstReply(lead) && !lead.lastBusinessReplyAt) {
    await ctx.db.update(leads).set({ stage: "no_reply", updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await ctx.db.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "marked_no_reply", payload: {} });
    return;
  }

  const template = operation.cadence.reengagementTemplate;
  const canResume = Boolean(template && operation.phoneNumberId && lead.whatsappConsent && lead.reengagements < MAX_REENGAGEMENTS);
  if (!canResume) {
    await askOutcome(ctx, lead);
    await ctx.db.insert(events).values({ operationId: operation.id, leadId: lead.id, type: "outcome_requested", payload: {} });
    return;
  }

  const earliest = new Date(Date.now() + REENGAGEMENT_NOTICE_MS);
  const sendAt = (operation.businessHours && nextOpening(earliest, operation.businessHours)) || earliest;
  await notifyOwner(
    ctx,
    lead,
    NOTIFICATION_TEMPLATES.reengagementNotice,
    [firstName(lead), String(operation.staleDays), formatWhen(sendAt, operation.businessHours?.timezone ?? DEFAULT_TIMEZONE)],
    [
      { index: 0, payload: buttonPayload("cancel_reengagement", lead.id) },
      { index: 1, payload: buttonPayload("won", lead.id) },
      { index: 2, payload: buttonPayload("lost", lead.id) },
    ],
  );
  await schedule(ctx.db, { operationId: operation.id, leadId: lead.id, kind: "reengagement", runAt: sendAt });
  await ctx.db.insert(events).values({
    operationId: operation.id,
    leadId: lead.id,
    type: "reengagement_announced",
    payload: { sendAt: sendAt.toISOString() },
  });
}

function formatWhen(at: Date, timezone: string) {
  const fmt = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short" }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(at);
  const day = fmt(at) === fmt(new Date()) ? "hoje" : fmt(at) === fmt(new Date(Date.now() + 86_400_000)) ? "amanhã" : `em ${fmt(at)}`;
  return `${day} às ${time}`;
}

/** Resumes a stalled lead, unless someone talked, cancelled or closed it since the notice. */
async function reengage(ctx: ActionContext, lead: Lead, operation: Operation, action: Action) {
  const template = operation.cadence.reengagementTemplate;
  if (!template || !operation.phoneNumberId || !lead.whatsappConsent || isClosed(lead)) return;
  const noticeAt = action.createdAt;
  if ((lead.lastInboundAt && lead.lastInboundAt > noticeAt) || (lead.lastBusinessReplyAt && lead.lastBusinessReplyAt > noticeAt)) return;

  const id = await ctx.whatsapp.sendTemplate({
    phoneNumberId: operation.phoneNumberId,
    to: lead.contactPhone,
    template,
    ...leadTemplateOptions(lead, operation),
  });
  const sentAt = await recordOutbound(ctx, lead, id, `template:${template}`);
  await ctx.db
    .update(leads)
    .set({ lastOutboundAt: sentAt, reengagements: lead.reengagements + 1, updatedAt: sentAt })
    .where(eq(leads.id, lead.id));
  await schedule(ctx.db, { operationId: operation.id, leadId: lead.id, ...planStaleCheck(sentAt, operationCadence(operation)) });
  await ctx.db.insert(events).values({
    operationId: operation.id,
    leadId: lead.id,
    type: "reengagement_sent",
    payload: { attempt: lead.reengagements + 1, template },
  });
}

/**
 * Right after "Ganhou", asks the person for the sale value. They just tapped
 * a button on the tool's number, so their window is open: free text, no template.
 */
async function askSaleValue(ctx: ActionContext, lead: Lead, action: Action) {
  const to = typeof action.payload.to === "string" ? action.payload.to : null;
  if (!to) return;
  await ctx.whatsapp.sendText(
    ctx.toolPhoneNumberId,
    to,
    `Boa! Qual foi o valor da venda para ${lead.contactName?.trim() || "esse lead"}? Responda só com o número, por exemplo 1500. Se preferir não informar, pode ignorar.`,
  );
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
      { index: 0, payload: buttonPayload("won", lead.id) },
      { index: 1, payload: buttonPayload("lost", lead.id) },
      { index: 2, payload: buttonPayload("open", lead.id) },
    ],
  });
}

async function outOfHoursReply(ctx: ActionContext, lead: Lead, operation: Operation) {
  const text = operation.cadence.outOfHoursMessage;
  const now = new Date();
  // Free text is only allowed inside the lead's 24-hour window.
  if (!text || !operation.phoneNumberId || !lead.whatsappConsent || !canSendFreeform(lead.lastInboundAt, now)) return;
  // The automatic first reply already covers a brand-new lead, and one notice per 12 hours is enough.
  if (!lead.firstContactAt) return;
  if (lead.lastOutOfHoursReplyAt && now.getTime() - lead.lastOutOfHoursReplyAt.getTime() < 12 * 60 * 60 * 1000) return;

  const id = await ctx.whatsapp.sendText(operation.phoneNumberId, lead.contactPhone, text);
  await ctx.db.insert(messages).values({
    operationId: lead.operationId,
    leadId: lead.id,
    waMessageId: id,
    direction: "outbound",
    sender: "automation",
    type: "text",
    body: text,
    sentAt: now,
  });
  await ctx.db
    .update(leads)
    .set({ lastOutOfHoursReplyAt: now, lastOutboundAt: now, updatedAt: now })
    .where(eq(leads.id, lead.id));
}

async function weeklyReport(ctx: ActionContext, action: Action) {
  const [operation] = await ctx.db.select().from(operations).where(eq(operations.id, action.operationId));
  if (!operation) return;

  const periodEnd = action.runAt;
  const periodStart = new Date(periodEnd.getTime() - WEEK_MS);
  const rows = await ctx.db
    .select()
    .from(leads)
    .where(and(eq(leads.operationId, operation.id), gte(leads.receivedAt, periodStart), lt(leads.receivedAt, periodEnd)));

  const report = computeWeeklyReport(rows);

  await ctx.db.insert(events).values({
    operationId: operation.id,
    type: "weekly_report",
    payload: { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), report },
  });

  // Managers receive it; in solo mode the owner is the only person.
  const recipients = await ctx.db
    .select()
    .from(people)
    .where(
      operation.mode === "solo"
        ? and(eq(people.operationId, operation.id), eq(people.active, true))
        : and(eq(people.operationId, operation.id), eq(people.role, "manager"), eq(people.active, true)),
    );

  const pct = (n: number | null) => (n === null ? "-" : `${n}%`);
  const params = [
    operation.name,
    String(report.leadsReceived),
    pct(report.contactedWithinMinuteRate),
    String(report.leadsReplied),
    report.medianBusinessResponseMinutes === null ? "-" : `${report.medianBusinessResponseMinutes} min`,
    String(report.repliedWithoutBusinessAnswer),
    String(report.stages.won),
  ];

  for (const person of recipients) {
    await ctx.whatsapp.sendTemplate({
      phoneNumberId: ctx.toolPhoneNumberId,
      to: person.whatsappNumber,
      template: NOTIFICATION_TEMPLATES.weeklyReport,
      bodyParams: params,
    });
  }

  await schedule(ctx.db, {
    operationId: operation.id,
    leadId: null,
    kind: "weekly_report",
    runAt: nextWeeklyReportAt(periodEnd, operation.businessHours?.timezone ?? DEFAULT_TIMEZONE),
  });
}
