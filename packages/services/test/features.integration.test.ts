/**
 * Business hours, out-of-order delivery and weekly report against a real Postgres.
 * Skipped unless TEST_DATABASE_URL is set. Never point it at production.
 */
import type { SendTemplateInput, WhatsAppClient } from "@post-lead/core";
import { agencies, and, createDb, eq, events, leads, operations, people, scheduledActions } from "@post-lead/db";
import { describe, expect, it } from "vitest";
import {
  ensureWeeklyReportsScheduled,
  processPendingWebhooks,
  runDueActions,
  storeWebhook,
} from "../src";

const url = process.env.TEST_DATABASE_URL;
const TOOL = "tool-pn";
const stamp = Date.now();

function fakeWhatsApp() {
  const templates: SendTemplateInput[] = [];
  const texts: { phoneNumberId: string; to: string; body: string }[] = [];
  let n = 0;
  const client: WhatsAppClient = {
    async sendText(phoneNumberId, to, body) {
      texts.push({ phoneNumberId, to, body });
      return `wamid.text.${stamp}.${++n}`;
    },
    async sendTemplate(input) {
      templates.push(input);
      return `wamid.tpl.${stamp}.${++n}`;
    },
  };
  return { client, templates, texts };
}

async function setup(db: ReturnType<typeof createDb>, overrides: Partial<typeof operations.$inferInsert> = {}) {
  const [agency] = await db.insert(agencies).values({ name: "Agência" }).returning();
  const [operation] = await db
    .insert(operations)
    .values({
      agencyId: agency!.id,
      name: "Clínica Teste",
      cadence: { firstReplyMessage: "Oi! Recebemos sua mensagem.", followUps: [] },
      ...overrides,
    })
    .returning();
  return operation!;
}

describe.skipIf(!url)("business hours", () => {
  it("answers out of hours once and delays the seller's clock to the next opening", async () => {
    const db = createDb(url);
    const pn = `pn-hours-${stamp}`;
    // Closed every day, so "now" is always out of hours, whatever time the test runs.
    const operation = await setup(db, {
      phoneNumberId: pn,
      businessHours: { timezone: "America/Sao_Paulo", days: { sun: ["00:00", "00:15"] } },
      cadence: { firstReplyMessage: "Oi! Já te respondemos.", followUps: [], outOfHoursMessage: "Recebemos sua mensagem! Respondemos a partir das 8h." },
    });
    await db.insert(people).values({ operationId: operation.id, name: "Bia", whatsappNumber: "5577911113333", role: "seller" });
    const wa = fakeWhatsApp();

    const inbound = (id: string) =>
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "waba", changes: [{ field: "messages", value: {
          metadata: { phone_number_id: pn },
          messages: [{ from: "5577982223344", id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Oi" } }],
        } }] }],
      });

    await storeWebhook(db, "whatsapp", inbound(`wamid.ooh1.${stamp}`));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    await runDueActions({ db, whatsapp: wa.client, toolPhoneNumberId: TOOL });

    // Out of hours, the first reply is the out-of-hours message, not both.
    const replies = wa.texts.filter((t) => t.to === "5577982223344");
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ phoneNumberId: pn, body: "Recebemos sua mensagem! Respondemos a partir das 8h." });

    // A second message right after does not trigger another out-of-hours reply.
    await storeWebhook(db, "whatsapp", inbound(`wamid.ooh2.${stamp}`));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    await runDueActions({ db, whatsapp: wa.client, toolPhoneNumberId: TOOL });
    expect(wa.texts.filter((t) => t.to === "5577982223344")).toHaveLength(1);

    // The seller is not notified now: the notification waits for the next opening.
    const [lead] = await db.select().from(leads).where(eq(leads.operationId, operation.id));
    const [notify] = await db
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.leadId, lead!.id), eq(scheduledActions.kind, "notify_owner_new_lead")));
    expect(notify?.status).toBe("pending");
    expect(notify!.runAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe.skipIf(!url)("out-of-order delivery", () => {
  it("does not remind anyone when the answer arrives before the lead message it answers", async () => {
    const db = createDb(url);
    const pn = `pn-order-${stamp}`;
    const operation = await setup(db, { phoneNumberId: pn });
    await db.insert(people).values({ operationId: operation.id, name: "Bia", whatsappNumber: "5577911116666", role: "seller" });
    const lead = "5577983334455";
    const t0 = Math.floor(Date.now() / 1000);
    const wrap = (field: string, value: Record<string, unknown>) =>
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [{ field, value: { metadata: { phone_number_id: pn }, ...value } }] }] });

    // First the lead writes (creates the lead), then the answer, then a second lead message that Meta delivers late.
    await storeWebhook(db, "whatsapp", wrap("messages", { messages: [{ from: lead, id: `wamid.o1.${stamp}`, timestamp: String(t0 - 60), type: "text", text: { body: "Oi" } }] }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    await storeWebhook(db, "whatsapp", wrap("smb_message_echoes", { message_echoes: [{ from: pn, to: lead, id: `wamid.o2.${stamp}`, timestamp: String(t0), type: "text", text: { body: "Olá!" } }] }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    await storeWebhook(db, "whatsapp", wrap("messages", { messages: [{ from: lead, id: `wamid.o3.${stamp}`, timestamp: String(t0 - 30), type: "text", text: { body: "Alguém?" } }] }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });

    const [row] = await db.select().from(leads).where(eq(leads.operationId, operation.id));
    const pending = await db
      .select({ kind: scheduledActions.kind })
      .from(scheduledActions)
      .where(and(eq(scheduledActions.leadId, row!.id), eq(scheduledActions.status, "pending")));
    expect(pending.map((p) => p.kind)).not.toContain("owner_reminder");
    expect(pending.map((p) => p.kind)).not.toContain("manager_alert");
  });
});

describe.skipIf(!url)("weekly report", () => {
  it("queues one report per operation, sends it to managers and queues the next", async () => {
    const db = createDb(url);
    const operation = await setup(db, { name: "Loja Relatório" });
    await db.insert(people).values([
      { operationId: operation.id, name: "Gestora", whatsappNumber: "5577911114444", role: "manager" },
      { operationId: operation.id, name: "Vendedor", whatsappNumber: "5577911115555", role: "seller" },
    ]);
    const now = Date.now();
    await db.insert(leads).values([
      { operationId: operation.id, contactPhone: "5577900000001", source: "whatsapp_ad", stage: "won", receivedAt: new Date(now - 86400_000), firstContactAt: new Date(now - 86400_000 + 3000) },
      { operationId: operation.id, contactPhone: "5577900000002", source: "whatsapp", stage: "no_reply", receivedAt: new Date(now - 2 * 86400_000), firstContactAt: new Date(now - 2 * 86400_000 + 5000) },
    ]);

    await ensureWeeklyReportsScheduled(db);
    await ensureWeeklyReportsScheduled(db); // idempotent
    const queued = await db
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.operationId, operation.id), eq(scheduledActions.kind, "weekly_report"), eq(scheduledActions.status, "pending")));
    expect(queued).toHaveLength(1);

    // Pretend Monday arrived.
    await db.update(scheduledActions).set({ runAt: new Date() }).where(eq(scheduledActions.id, queued[0]!.id));
    const wa = fakeWhatsApp();
    await runDueActions({ db, whatsapp: wa.client, toolPhoneNumberId: TOOL });

    const sent = wa.templates.filter((t) => t.template === "weekly_report");
    expect(sent.map((s) => s.to)).toEqual(["5577911114444"]); // managers only
    expect(sent[0]?.bodyParams).toEqual(["Loja Relatório", "2", "100%", "2", "-", "2", "1"]);

    const [stored] = await db
      .select()
      .from(events)
      .where(and(eq(events.operationId, operation.id), eq(events.type, "weekly_report")));
    expect(stored?.payload).toMatchObject({ report: { leadsReceived: 2 } });

    const next = await db
      .select()
      .from(scheduledActions)
      .where(and(eq(scheduledActions.operationId, operation.id), eq(scheduledActions.kind, "weekly_report"), eq(scheduledActions.status, "pending")));
    expect(next).toHaveLength(1);
    expect(next[0]!.runAt.getTime()).toBeGreaterThan(Date.now());
  });
});
