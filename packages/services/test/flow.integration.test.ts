/**
 * End-to-end flow against a real Postgres with the migrations applied.
 * Skipped unless TEST_DATABASE_URL is set. Do not point it at production:
 * the test inserts and leaves rows behind.
 */
import type { SendTemplateInput, WhatsAppClient } from "@post-lead/core";
import {
  agencies,
  and,
  contacts,
  createDb,
  eq,
  events,
  historyMessages,
  leads,
  operations,
  people,
  scheduledActions,
  sql,
} from "@post-lead/db";
import { describe, expect, it } from "vitest";
import { buttonPayload, processPendingWebhooks, runDueActions, storeWebhook } from "../src";

const url = process.env.TEST_DATABASE_URL;
const TOOL = "tool-pn";
const stamp = Date.now();
let seq = 0;
const wamid = (tag: string) => `wamid.${tag}.${stamp}.${++seq}`;
const unix = (offsetSeconds = 0) => String(Math.floor(Date.now() / 1000) + offsetSeconds);

function fakeWhatsApp() {
  const templates: SendTemplateInput[] = [];
  const texts: { phoneNumberId: string; to: string; body: string }[] = [];
  let n = 0;
  const client: WhatsAppClient = {
    async sendText(phoneNumberId, to, body) {
      texts.push({ phoneNumberId, to, body });
      return `wamid.out.text.${stamp}.${++n}`;
    },
    async sendTemplate(input) {
      templates.push(input);
      return `wamid.out.tpl.${stamp}.${++n}`;
    },
  };
  return { client, templates, texts };
}

const envelope = (phoneNumberId: string, field: string, value: Record<string, unknown>) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
  });

describe.skipIf(!url)("lead flow", () => {
  const db = createDb(url);
  const wa = fakeWhatsApp();
  const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL };

  async function setup(name: string, cadence: Partial<typeof operations.$inferInsert.cadence> = {}) {
    const pn = `pn-${name}-${stamp}`;
    const [agency] = await db.insert(agencies).values({ name: `Agência ${name}` }).returning();
    const [operation] = await db
      .insert(operations)
      .values({
        agencyId: agency!.id,
        name,
        phoneNumberId: pn,
        firstResponseMinutes: 5,
        staleDays: 3,
        cadence: {
          firstReplyMessage: "Oi! Recebemos sua mensagem, já já alguém te responde por aqui.",
          followUps: [{ afterMinutes: 60, template: "follow_up_1" }],
          reengagementTemplate: "reengage_1",
          ...cadence,
        },
      })
      .returning();
    return { pn, opId: operation!.id };
  }

  const deliver = async (pn: string, field: string, value: Record<string, unknown>) => {
    await storeWebhook(db, "whatsapp", envelope(pn, field, value));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
  };
  const leadWrites = (pn: string, from: string, body: string, extra: Record<string, unknown> = {}) =>
    deliver(pn, "messages", {
      contacts: [{ wa_id: from, profile: { name: "Ana Souza" } }],
      messages: [{ from, id: wamid("in"), timestamp: unix(), type: "text", text: { body }, ...extra }],
    });
  const tap = (personPhone: string, payload: string) =>
    deliver(TOOL, "messages", { messages: [{ from: personPhone, id: wamid("btn"), timestamp: unix(), type: "button", button: { payload, text: "x" } }] });
  const pending = async (leadId: string) =>
    (
      await db
        .select({ kind: scheduledActions.kind })
        .from(scheduledActions)
        .where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.status, "pending")))
    ).map((r) => r.kind).sort();
  const makeDue = (leadId: string, kind: (typeof scheduledActions.$inferSelect)["kind"]) =>
    db
      .update(scheduledActions)
      .set({ runAt: sql`now() - interval '1 minute'` })
      .where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.kind, kind), eq(scheduledActions.status, "pending")));

  it("answers a lead from an ad, hands over to a person, resumes a stalled chat and records the sale", async () => {
    const { pn, opId } = await setup("ads");
    await db.insert(people).values([
      { operationId: opId, name: "Bia", whatsappNumber: "5577911110001", role: "seller" },
      { operationId: opId, name: "Gestor", whatsappNumber: "5577911110003", role: "manager" },
    ]);
    const phone = "5577981110001";

    // 1. The lead writes after tapping an ad.
    await leadWrites(pn, phone, "Oi, quero saber o preço", {
      referral: { source_id: "ad-1", source_type: "ad", source_url: "https://fb.me/x", headline: "Clareamento", ctwa_clid: "clid-1" },
    });
    const [lead] = await db.select().from(leads).where(eq(leads.operationId, opId));
    expect(lead).toMatchObject({ source: "whatsapp_ad", campaign: "Clareamento", ad: "ad-1", ctwaClid: "clid-1", knownContact: false });
    const leadId = lead!.id;
    expect(await pending(leadId)).toEqual(["first_contact", "manager_alert", "notify_owner_new_lead", "owner_reminder"]);

    // 2. Free-text first reply from the client's number; the seller is told, with "Não é lead".
    await runDueActions(ctx);
    expect(wa.texts.filter((t) => t.to === phone)).toEqual([
      { phoneNumberId: pn, to: phone, body: "Oi! Recebemos sua mensagem, já já alguém te responde por aqui." },
    ]);
    const notice = wa.templates.find((t) => t.template === "notify_new_lead" && t.to === "5577911110001");
    expect(notice).toMatchObject({ phoneNumberId: TOOL, bodyParams: ["Ana", phone, "anúncio Clareamento", "sem pré-atendimento"] });
    expect(notice?.quickReplyPayloads).toEqual([{ index: 0, payload: buttonPayload("not_lead", leadId) }]);
    expect(await pending(leadId)).toEqual(["follow_up", "manager_alert", "owner_reminder"]);

    // 3. Bia answers from the app: reminders and follow-ups stop; only the stall check stays.
    await deliver(pn, "smb_message_echoes", { message_echoes: [{ from: pn, to: phone, id: wamid("echo"), timestamp: unix(), type: "text", text: { body: "Olá Ana!" } }] });
    expect(await pending(leadId)).toEqual(["stale_check"]);

    // 4. Y days of silence: Bia is warned, with Cancelar / Ganhou / Perdeu, and Bia cancels.
    await makeDue(leadId, "stale_check");
    await runDueActions(ctx);
    const warn = () => wa.templates.filter((t) => t.template === "notify_reengagement" && t.to === "5577911110001");
    expect(warn()).toHaveLength(1);
    expect(warn()[0]?.quickReplyPayloads?.map((b) => b.payload)).toEqual([
      buttonPayload("cancel_reengagement", leadId),
      buttonPayload("won", leadId),
      buttonPayload("lost", leadId),
    ]);
    expect(await pending(leadId)).toEqual(["reengagement"]);
    await tap("5577911110001", buttonPayload("cancel_reengagement", leadId));
    expect(await pending(leadId)).toEqual(["stale_check"]);

    // 5. Still silent later: warned again, nobody cancels, the tool resumes the lead itself.
    await makeDue(leadId, "stale_check");
    await runDueActions(ctx);
    await makeDue(leadId, "reengagement");
    await runDueActions(ctx);
    expect(wa.templates.filter((t) => t.template === "reengage_1" && t.to === phone)).toHaveLength(1);
    const [resumed] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(resumed?.reengagements).toBe(1);
    expect(await pending(leadId)).toEqual(["stale_check"]);

    // 6. Bia taps "Ganhou", is asked the value, and answers it.
    await tap("5577911110001", buttonPayload("won", leadId));
    expect(await pending(leadId)).toEqual(["ask_sale_value"]);
    await runDueActions(ctx);
    expect(wa.texts.find((t) => t.to === "5577911110001")).toMatchObject({ phoneNumberId: TOOL });
    await deliver(TOOL, "messages", { messages: [{ from: "5577911110001", id: wamid("val"), timestamp: unix(), type: "text", text: { body: "R$ 1.500,00" } }] });
    const [won] = await db.select().from(leads).where(eq(leads.id, leadId));
    expect(won).toMatchObject({ stage: "won", saleValueCents: 150000 });
  }, 30_000);

  it("keeps known contacts out, lets ads in, and stops for good on Não é lead", async () => {
    const { pn, opId } = await setup("contacts");
    await db.insert(people).values({ operationId: opId, name: "Dono", whatsappNumber: "5577911119999", role: "seller" });
    const fromHistory = "5577982220001";
    const inAddressBook = "5577982220002";
    const clientStarted = "5577982220003";
    const stranger = "5577982220004";

    // Activation: 180 days of history (no text kept) and the app's address book.
    await deliver(pn, "history", {
      history: [{
        metadata: { phase: 0, chunk_order: 1, progress: 100 },
        threads: [{ id: fromHistory, messages: [
          { from: fromHistory, id: wamid("h"), timestamp: unix(-86400 * 30), type: "text", text: { body: "segredo" } },
          { from: "5577933330000", to: fromHistory, id: wamid("h"), timestamp: unix(-86400 * 30 + 60), type: "text", text: { body: "resposta" } },
        ] }],
      }],
    });
    await deliver(pn, "smb_app_state_sync", { state_sync: [{ type: "contact", contact: { full_name: "Fornecedor", phone_number: inAddressBook }, action: "add" }] });
    // After activation, the client starts a chat from the app.
    await deliver(pn, "smb_message_echoes", { message_echoes: [{ from: pn, to: clientStarted, id: wamid("echo"), timestamp: unix(), type: "text", text: { body: "Oi, tudo bem?" } }] });

    const history = await db.select().from(historyMessages).where(eq(historyMessages.operationId, opId));
    expect(history.map((h) => h.direction).sort()).toEqual(["inbound", "outbound"]);
    expect(JSON.stringify(history)).not.toContain("segredo");

    // None of them becomes a lead when they write.
    for (const phone of [fromHistory, inAddressBook, clientStarted]) await leadWrites(pn, phone, "Oi");
    expect(await db.select().from(leads).where(eq(leads.operationId, opId))).toHaveLength(0);

    // A known contact who comes from an ad is a lead, flagged as already known.
    await leadWrites(pn, fromHistory, "Vi o anúncio", { referral: { source_id: "ad-9", source_type: "ad", headline: "Promoção" } });
    const [adLead] = await db.select().from(leads).where(eq(leads.operationId, opId));
    expect(adLead).toMatchObject({ source: "whatsapp_ad", knownContact: true });

    // A stranger becomes a lead of unknown origin; the owner taps "Não é lead".
    await leadWrites(pn, stranger, "Bom dia");
    const [strangerLead] = await db.select().from(leads).where(and(eq(leads.operationId, opId), eq(leads.contactPhone, stranger)));
    expect(strangerLead?.source).toBe("whatsapp");
    await tap("5577911119999", buttonPayload("not_lead", strangerLead!.id));
    expect(await db.select().from(leads).where(eq(leads.id, strangerLead!.id))).toHaveLength(0);
    const [ignored] = await db.select().from(contacts).where(and(eq(contacts.operationId, opId), eq(contacts.phone, stranger)));
    expect(ignored?.ignoredAt).not.toBeNull();

    // Writing again, even from an ad, changes nothing.
    await leadWrites(pn, stranger, "Oi de novo", { referral: { source_id: "ad-9", source_type: "ad" } });
    expect(await db.select().from(leads).where(and(eq(leads.operationId, opId), eq(leads.contactPhone, stranger)))).toHaveLength(0);

    // A business that declines to share history is recorded, not an error.
    await storeWebhook(db, "whatsapp", JSON.stringify({ messaging_product: "whatsapp", metadata: { phone_number_id: pn }, history: [{ errors: [{ code: 2593109 }] }] }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
    const declined = await db.select().from(events).where(and(eq(events.operationId, opId), eq(events.type, "history_declined")));
    expect(declined).toHaveLength(1);
  }, 30_000);

  it("follows up a lead who goes quiet after the first reply, then closes it as no_reply", async () => {
    const { pn, opId } = await setup("quiet");
    await db.insert(people).values({ operationId: opId, name: "Bia", whatsappNumber: "5577911117777", role: "seller" });
    const phone = "5577984440001";

    await leadWrites(pn, phone, "Oi");
    const [lead] = await db.select().from(leads).where(eq(leads.operationId, opId));
    await runDueActions(ctx); // first reply
    await makeDue(lead!.id, "follow_up");
    await runDueActions(ctx); // last follow-up schedules the stall check
    await makeDue(lead!.id, "stale_check");
    await runDueActions(ctx);

    const [after] = await db.select().from(leads).where(eq(leads.id, lead!.id));
    expect(after?.stage).toBe("no_reply");
    expect(wa.templates.filter((t) => t.to === phone).map((t) => t.template)).toEqual(["follow_up_1"]);
  }, 30_000);

  it("keeps the first reply when the lead sends two messages in a row", async () => {
    const { pn, opId } = await setup("double");
    const phone = "5577985550001";
    await leadWrites(pn, phone, "Oi");
    await leadWrites(pn, phone, "Quero saber o preço");
    const [lead] = await db.select().from(leads).where(eq(leads.operationId, opId));
    expect(await pending(lead!.id)).toContain("first_contact");
    await runDueActions(ctx);
    expect(wa.texts.filter((t) => t.to === phone)).toHaveLength(1);
  }, 30_000);

  it("runs on a single test number: the team's messages are replies, anyone else is a lead", async () => {
    const { opId } = await setup("single");
    // The client's number is the tool's number.
    await db.update(operations).set({ phoneNumberId: TOOL }).where(eq(operations.id, opId));
    await db.insert(people).values({ operationId: opId, name: "Bia", whatsappNumber: "5577911116666", role: "seller" });
    const lead = "5577986669999";

    await leadWrites(TOOL, lead, "Oi, quero saber mais");
    const [created] = await db.select().from(leads).where(eq(leads.operationId, opId));
    expect(created?.contactPhone).toBe(lead);

    await tap("5577911116666", buttonPayload("won", created!.id));
    const [won] = await db.select().from(leads).where(eq(leads.id, created!.id));
    expect(won?.stage).toBe("won");
    expect(await db.select().from(leads).where(eq(leads.contactPhone, "5577911116666"))).toHaveLength(0);

    // Leave the tool number free for the other tests.
    await db.update(operations).set({ phoneNumberId: null }).where(eq(operations.id, opId));
  }, 30_000);
});
