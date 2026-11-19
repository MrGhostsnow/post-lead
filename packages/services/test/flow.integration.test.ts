/**
 * End-to-end flow against a real Postgres with the migrations applied.
 * Skipped unless TEST_DATABASE_URL is set. Do not point it at production:
 * the test inserts and leaves rows behind.
 */
import type { SendTemplateInput, WhatsAppClient } from "@post-lead/core";
import {
  agencies,
  and,
  createDb,
  eq,
  leads,
  operations,
  people,
  scheduledActions,
  sql,
} from "@post-lead/db";
import { describe, expect, it } from "vitest";
import {
  createLead,
  outcomePayload,
  processPendingWebhooks,
  runDueActions,
  storeWebhook,
} from "../src";

const url = process.env.TEST_DATABASE_URL;
const TOOL = "tool-pn";
const CLIENT = `client-pn-${Date.now()}`;

function fakeWhatsApp() {
  const sent: SendTemplateInput[] = [];
  let n = 0;
  const client: WhatsAppClient = {
    async sendText() {
      return `wamid.text.${++n}`;
    },
    async sendTemplate(input) {
      sent.push(input);
      return `wamid.tpl.${Date.now()}.${++n}`;
    },
  };
  return { client, sent };
}

const webhook = (field: string, value: Record<string, unknown>, phoneNumberId = CLIENT) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field, value: { metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
  });

const unix = () => String(Math.floor(Date.now() / 1000));

describe.skipIf(!url)("lead flow", () => {
  it("contacts, stops on reply, hands over to a person and records the outcome", async () => {
    const db = createDb(url);
    const wa = fakeWhatsApp();
    const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL };
    const pending = async (leadId: string) =>
      (
        await db
          .select({ kind: scheduledActions.kind })
          .from(scheduledActions)
          .where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.status, "pending")))
      ).map((r) => r.kind).sort();

    // Setup: one operation with two sellers and a manager.
    const [agency] = await db.insert(agencies).values({ name: "Agency" }).returning();
    const [operation] = await db
      .insert(operations)
      .values({
        agencyId: agency!.id,
        name: "Client",
        phoneNumberId: CLIENT,
        firstResponseMinutes: 5,
        staleDays: 3,
        cadence: {
          firstContactTemplate: "first_contact",
          followUps: [
            { afterMinutes: 60, template: "follow_up_1" },
            { afterMinutes: 1440, template: "follow_up_2" },
          ],
        },
      })
      .returning();
    const opId = operation!.id;
    await db.insert(people).values([
      { operationId: opId, name: "Bia", whatsappNumber: "5577911110001", role: "seller" },
      { operationId: opId, name: "Caio", whatsappNumber: "5577911110002", role: "seller" },
      { operationId: opId, name: "Gestor", whatsappNumber: "5577911110003", role: "manager" },
    ]);

    // 1. A form lead with consent.
    const created = await createLead(db, {
      operationId: opId,
      contactName: "Ana Souza",
      phone: "(77) 99876-5432",
      source: "form",
      whatsappConsent: true,
    });
    expect(created.status).toBe("created");
    const leadId = (created as { leadId: string }).leadId;
    expect(await pending(leadId)).toEqual(["first_contact", "notify_owner_new_lead"]);

    // The same phone again is a duplicate, not a second lead.
    expect((await createLead(db, { operationId: opId, phone: "77998765432", source: "form", whatsappConsent: true })).status).toBe("duplicate");

    // 2. The worker sends the first contact and the owner notification.
    await runDueActions(ctx);
    expect(wa.sent.map((s) => s.template).sort()).toEqual(["first_contact", "notify_new_lead"]);
    expect(wa.sent.find((s) => s.template === "first_contact")).toMatchObject({ phoneNumberId: CLIENT, to: "5577998765432", bodyParams: ["Ana"] });
    expect(wa.sent.find((s) => s.template === "notify_new_lead")?.phoneNumberId).toBe(TOOL);
    expect(await pending(leadId)).toEqual(["follow_up", "follow_up"]);

    // 3. The lead replies; WhatsApp reports the number without the ninth digit.
    await storeWebhook(db, "whatsapp", webhook("messages", {
      contacts: [{ wa_id: "557798765432", profile: { name: "Ana" } }],
      messages: [{ from: "557798765432", id: `wamid.in.${Date.now()}`, timestamp: unix(), type: "text", text: { body: "Oi, quero saber o preço" } }],
    }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    let [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.stage).toBe("in_progress");
    expect(await pending(leadId)).toEqual(["manager_alert", "notify_owner_reply", "owner_reminder", "stale_check"]);

    // A redelivered webhook is ignored.
    const again = webhook("messages", { messages: [{ from: "557798765432", id: "wamid.dup", timestamp: "1", type: "text", text: { body: "x" } }] });
    expect(await storeWebhook(db, "whatsapp", again)).toBe(true);
    expect(await storeWebhook(db, "whatsapp", again)).toBe(false);

    // 4. A seller answers from the WhatsApp Business app: reminders and alerts stop.
    await storeWebhook(db, "whatsapp", webhook("smb_message_echoes", {
      message_echoes: [{ from: CLIENT, to: "557798765432", id: `wamid.echo.${Date.now()}`, timestamp: unix(), type: "text", text: { body: "Olá Ana!" } }],
    }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    expect(await pending(leadId)).toEqual(["notify_owner_reply", "stale_check"]);

    // 5. Y days pass without messages: the owner is asked for the outcome.
    await db.update(scheduledActions).set({ runAt: sql`now() - interval '1 minute'` })
      .where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.kind, "stale_check")));
    wa.sent.length = 0;
    await runDueActions(ctx);
    const ask = wa.sent.find((s) => s.template === "ask_lead_outcome");
    expect(ask?.quickReplyPayloads?.map((b) => b.payload)).toEqual([
      outcomePayload("won", leadId),
      outcomePayload("lost", leadId),
      outcomePayload("open", leadId),
    ]);

    // 6. The owner taps "Ganhou" in the tool's chat.
    await storeWebhook(db, "whatsapp", webhook("messages", {
      messages: [{ from: ask!.to, id: `wamid.btn.${Date.now()}`, timestamp: unix(), type: "button", button: { payload: outcomePayload("won", leadId), text: "Ganhou" } }],
    }, TOOL));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.stage).toBe("won");
    expect(await pending(leadId)).toEqual([]);
  }, 30_000);

  it("marks a lead that never answers as no_reply after the cadence", async () => {
    const db = createDb(url);
    const wa = fakeWhatsApp();
    const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL };
    const [agency] = await db.insert(agencies).values({ name: "Agency 2" }).returning();
    const [operation] = await db.insert(operations).values({
      agencyId: agency!.id,
      name: "Solo client",
      mode: "solo",
      phoneNumberId: `${CLIENT}-solo`,
      cadence: { firstContactTemplate: "first_contact", followUps: [{ afterMinutes: 60, template: "follow_up_1" }] },
    }).returning();
    await db.insert(people).values({ operationId: operation!.id, name: "Dono", whatsappNumber: "5577911119999", role: "manager" });

    const created = await createLead(db, { operationId: operation!.id, phone: "77991234567", source: "form", whatsappConsent: true });
    const leadId = (created as { leadId: string }).leadId;
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(lead?.ownerPersonId).not.toBeNull(); // Solo mode: the owner gets the lead whatever the role.

    const due = sql`now() - interval '1 minute'`;
    await runDueActions(ctx); // first contact
    await db.update(scheduledActions).set({ runAt: due }).where(eq(scheduledActions.leadId, leadId));
    await runDueActions(ctx); // last follow-up, schedules the stale check
    await db.update(scheduledActions).set({ runAt: due }).where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.status, "pending")));
    await runDueActions(ctx); // stale check

    const [after] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(after?.stage).toBe("no_reply");
    // runDueActions is global, so keep only messages for this lead and its owner.
    const mine = wa.sent.filter((s) => s.to === "5577991234567" || s.to === "5577911119999");
    expect(mine.map((s) => s.template).sort()).toEqual(["first_contact", "follow_up_1", "notify_new_lead"]);
  }, 30_000);

  it("does not send the first contact without consent", async () => {
    const db = createDb(url);
    const [agency] = await db.insert(agencies).values({ name: "Agency 3" }).returning();
    const [operation] = await db.insert(operations).values({
      agencyId: agency!.id,
      name: "No consent",
      cadence: { firstContactTemplate: "first_contact", followUps: [] },
    }).returning();
    const created = await createLead(db, { operationId: operation!.id, phone: "77990000000", source: "form", whatsappConsent: false });
    const leadId = (created as { leadId: string }).leadId;
    const kinds = await db.select({ kind: scheduledActions.kind }).from(scheduledActions).where(eq(scheduledActions.leadId, leadId));
    expect(kinds.map((k) => k.kind)).not.toContain("first_contact");
  });
});

