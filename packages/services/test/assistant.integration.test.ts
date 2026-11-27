/**
 * Pre-attendance assistant against a real Postgres, with a scripted model.
 * Skipped unless TEST_DATABASE_URL is set. Never point it at production.
 */
import type { AssistantModel, ModelTurn, SendTemplateInput, WhatsAppClient } from "@post-lead/core";
import { agencies, and, createDb, eq, events, leads, operations, people, scheduledActions, sql } from "@post-lead/db";
import { describe, expect, it } from "vitest";
import { processPendingWebhooks, runDueActions, storeWebhook } from "../src";

const url = process.env.TEST_DATABASE_URL;
const TOOL = "tool-pn";
const stamp = Date.now();
let seq = 0;

function fakeWhatsApp() {
  const templates: SendTemplateInput[] = [];
  const texts: { phoneNumberId: string; to: string; body: string }[] = [];
  const client: WhatsAppClient = {
    async sendText(phoneNumberId, to, body) {
      texts.push({ phoneNumberId, to, body });
      return `wamid.ai.text.${stamp}.${++seq}`;
    },
    async sendButtons(phoneNumberId, to, body) {
      texts.push({ phoneNumberId, to, body });
      return `wamid.ai.btn.${stamp}.${++seq}`;
    },
    async sendTemplate(input) {
      templates.push(input);
      return `wamid.ai.tpl.${stamp}.${++seq}`;
    },
  };
  return { client, templates, texts };
}

/** Plays back the given turns; an Error in the list is thrown instead. */
function scriptedModel(script: (ModelTurn | Error)[]) {
  const calls: { system: string; conversation: { from: string; text: string }[] }[] = [];
  const model: AssistantModel = {
    async respond(input) {
      calls.push(input);
      const next = script.shift();
      if (!next) throw new Error("script ended");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { model, calls };
}

const turn = (over: Partial<ModelTurn>): ModelTurn => ({ reply: "Me conta, o que você procura?", collected: {}, askedPrice: false, handoff: null, ...over });

const ASSISTANT = {
  enabled: true,
  name: "Bia",
  companyName: "Loja Exemplo",
  fields: [
    { key: "looking_for", label: "Procura", question: "O que você procura?" },
    { key: "best_time", label: "Melhor horário", question: "Qual o melhor horário?" },
  ],
  allowedInfo: "Rua A, 10. Seg a sex, 8h às 18h.",
  faq: [],
  extraInstructions: "",
  openings: ["Oi! Aqui é a Bia, da Loja Exemplo. Sou a assistente virtual.", "Olá! Sou a Bia, assistente virtual da Loja Exemplo."],
};

describe.skipIf(!url)("pre-attendance assistant", () => {
  const db = createDb(url);

  // Leftovers from other test files must not consume this file's scripted turns.
  async function parkForeignActions(opId: string) {
    await db.update(scheduledActions).set({ runAt: sql`now() + interval '1 day'` })
      .where(and(eq(scheduledActions.status, "pending"), sql`${scheduledActions.operationId} <> ${opId}`, sql`${scheduledActions.runAt} <= now()`));
  }
  async function run(opId: string, ctx: Parameters<typeof runDueActions>[0]) {
    for (let i = 0; i < 10; i++) {
      await parkForeignActions(opId);
      if ((await runDueActions(ctx)) === 0) return;
    }
  }

  async function setup(name: string) {
    const pn = `pn-ai-${name}-${stamp}`;
    const [agency] = await db.insert(agencies).values({ name: `Agência ${name}` }).returning();
    const [operation] = await db
      .insert(operations)
      .values({
        agencyId: agency!.id,
        name,
        phoneNumberId: pn,
        firstResponseMinutes: 5,
        cadence: { firstReplyMessage: "Oi! Recebemos sua mensagem, já já alguém te responde.", followUps: [] },
        assistant: ASSISTANT,
      })
      .returning();
    const seller = `55779111${String(stamp).slice(-5)}${++seq % 10}`;
    await db.insert(people).values({ operationId: operation!.id, name: "Bia Vendedora", whatsappNumber: seller, role: "seller" });
    return { pn, opId: operation!.id, seller };
  }

  const deliver = async (pn: string, field: string, value: Record<string, unknown>) => {
    await storeWebhook(db, "whatsapp", JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "w", changes: [{ field, value: { metadata: { phone_number_id: pn }, ...value } }] }],
    }));
    await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
  };
  const writes = (pn: string, from: string, body: string) =>
    deliver(pn, "messages", {
      contacts: [{ wa_id: from, profile: { name: "Ana Souza" } }],
      messages: [{ from, id: `wamid.ai.in.${stamp}.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
    });
  const pending = async (leadId: string) =>
    (await db.select({ kind: scheduledActions.kind }).from(scheduledActions)
      .where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.status, "pending")))).map((r) => r.kind).sort();
  const runNow = async (opId: string, leadId: string, ctx: Parameters<typeof runDueActions>[0]) => {
    await db.update(scheduledActions).set({ runAt: sql`now() - interval '1 second'` })
      .where(and(eq(scheduledActions.leadId, leadId), eq(scheduledActions.status, "pending"), sql`${scheduledActions.kind} = 'assistant_reply'`));
    await run(opId, ctx);
  };
  /** Each test only runs its own lead's due actions, so scripted turns are not used up elsewhere. */
  const leadOf = async (opId: string) => (await db.select().from(leads).where(eq(leads.operationId, opId)))[0]!;

  it("collects the fields, hands over with a summary and starts the seller's clock then", async () => {
    const { pn, opId, seller } = await setup("complete");
    const wa = fakeWhatsApp();
    const ai = scriptedModel([
      turn({ reply: "Faz todo sentido querer saber o valor, e o vendedor já te passa certinho. Me conta: o que você procura?", askedPrice: true }),
      turn({ reply: "Ótimo! Qual o melhor horário pro vendedor te chamar?", collected: { looking_for: "SUV automático" } }),
      turn({ reply: "Combinado!", collected: { looking_for: "SUV automático", best_time: "depois das 18h" } }),
    ]);
    const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL, assistant: ai.model };
    const phone = "5577986660001";

    await writes(pn, phone, "Quanto custa?");
    let lead = await leadOf(opId);
    // The assistant talks first: no seller notice, no reminder yet.
    expect(await pending(lead.id)).toEqual(["assistant_deadline", "assistant_reply"]);

    await run(opId, ctx);
    const first = wa.texts.filter((t) => t.to === phone);
    expect(first).toHaveLength(1);
    expect(first[0]!.body).toMatch(/^(Oi! Aqui é a Bia|Olá! Sou a Bia)/);
    expect(first[0]!.phoneNumberId).toBe(pn);
    expect(ai.calls[0]!.system).toContain("Nunca informe preço");
    expect(ai.calls[0]!.conversation).toEqual([{ from: "lead", text: "Quanto custa?" }]);

    await writes(pn, phone, "Um SUV automático");
    await runNow(opId, lead.id, ctx);
    await writes(pn, phone, "Depois das 18h");
    await runNow(opId, lead.id, ctx);

    lead = await leadOf(opId);
    expect(lead.handoffSummary).toBe("Procura: SUV automático · Melhor horário: depois das 18h · Motivo: dados completos");
    expect(lead.handedOffAt).not.toBeNull();
    // The seller's clock starts at handoff; with no follow-ups configured, a stall check closes the loop.
    expect(await pending(lead.id)).toEqual(["manager_alert", "owner_reminder", "stale_check"]);
    const reminder = await db.select().from(scheduledActions)
      .where(and(eq(scheduledActions.leadId, lead.id), sql`${scheduledActions.kind} = 'owner_reminder'`));
    expect(reminder[0]!.runAt.getTime() - lead.handedOffAt!.getTime()).toBe(5 * 60_000);
    const notice = wa.templates.find((t) => t.template === "notify_new_lead" && t.to === seller);
    expect(notice?.bodyParams?.[3]).toBe(lead.handoffSummary);
    expect(wa.texts.filter((t) => t.to === phone).at(-1)?.body).toContain("já passei tudo para o vendedor");
  }, 30_000);

  it("hands over on the second price question with the fixed reply", async () => {
    const { pn, opId } = await setup("price");
    const wa = fakeWhatsApp();
    const ai = scriptedModel([turn({ askedPrice: true }), turn({ askedPrice: true, reply: "Já já te passo." })]);
    const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL, assistant: ai.model };
    const phone = "5577986660002";

    await writes(pn, phone, "Qual o valor?");
    await run(opId, ctx);
    await writes(pn, phone, "Mas qual o valor??");
    const lead = await leadOf(opId);
    await runNow(opId, lead.id, ctx);

    expect(wa.texts.filter((t) => t.to === phone).at(-1)?.body).toBe("Entendi! O vendedor já te manda o valor certinho, só um instante.");
    expect((await leadOf(opId)).assistantState).toMatchObject({ status: "handed_off", handoffReason: "price_insist" });
  }, 30_000);

  it("never sends a price the model made up", async () => {
    const { pn, opId } = await setup("guard");
    const wa = fakeWhatsApp();
    const ai = scriptedModel([turn({ reply: "Esse sai por R$ 89.900 à vista!" })]);
    await writes(pn, "5577986660003", "Oi");
    await run(opId, { db, whatsapp: wa.client, toolPhoneNumberId: TOOL, assistant: ai.model });
    const sent = wa.texts.filter((t) => t.to === "5577986660003").map((t) => t.body).join(" ");
    expect(sent).not.toContain("89.900");
    expect((await leadOf(opId)).assistantState).toMatchObject({ status: "handed_off", handoffReason: "guard" });
  }, 30_000);

  it("stops at once when someone answers in the app", async () => {
    const { pn, opId } = await setup("takeover");
    const wa = fakeWhatsApp();
    const ai = scriptedModel([turn({}), turn({})]);
    const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL, assistant: ai.model };
    const phone = "5577986660004";

    await writes(pn, phone, "Oi");
    await run(opId, ctx);
    await deliver(pn, "smb_message_echoes", { message_echoes: [{ from: pn, to: phone, id: `wamid.ai.echo.${stamp}.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Oi Ana, aqui é o Carlos!" } }] });
    const lead = await leadOf(opId);
    expect(lead.assistantState).toMatchObject({ status: "stopped" });
    expect(await pending(lead.id)).not.toContain("assistant_reply");

    await writes(pn, phone, "Oi Carlos");
    await run(opId, ctx);
    expect(ai.calls).toHaveLength(1);
  }, 30_000);

  it("sends the fixed reply and calls a person when the model fails", async () => {
    const { pn, opId } = await setup("failure");
    const wa = fakeWhatsApp();
    const ai = scriptedModel([new Error("provider down")]);
    const phone = "5577986660005";

    await writes(pn, phone, "Oi");
    await run(opId, { db, whatsapp: wa.client, toolPhoneNumberId: TOOL, assistant: ai.model });

    expect(wa.texts.filter((t) => t.to === phone).map((t) => t.body)).toEqual(["Oi! Recebemos sua mensagem, já já alguém te responde."]);
    const lead = await leadOf(opId);
    expect(lead.assistantState).toMatchObject({ status: "handed_off", handoffReason: "ai_error" });
    expect(wa.templates.some((t) => t.template === "notify_new_lead" && t.bodyParams?.[3]?.includes("falha na IA"))).toBe(true);
  }, 30_000);

  it("hands over with what it has after 15 minutes", async () => {
    const { pn, opId } = await setup("deadline");
    const wa = fakeWhatsApp();
    const ai = scriptedModel([turn({ collected: { looking_for: "Moto 160" } })]);
    const ctx = { db, whatsapp: wa.client, toolPhoneNumberId: TOOL, assistant: ai.model };

    await writes(pn, "5577986660006", "Quero uma moto 160");
    await run(opId, ctx);
    const lead = await leadOf(opId);
    await db.update(scheduledActions).set({ runAt: sql`now() - interval '1 second'` })
      .where(and(eq(scheduledActions.leadId, lead.id), sql`${scheduledActions.kind} = 'assistant_deadline'`));
    await run(opId, ctx);

    const after = await leadOf(opId);
    expect(after.handoffSummary).toBe("Procura: Moto 160 · Motivo: 15 minutos sem concluir");
  }, 30_000);

  it("reads the history once for common questions, skips the address book and erases the text", async () => {
    const { pn, opId } = await setup("faq");
    const seen: string[][] = [];
    const ctx = {
      db,
      whatsapp: fakeWhatsApp().client,
      toolPhoneNumberId: TOOL,
      faqExtractor: { async extract(texts: string[]) { seen.push(texts); return ["Aceita cartão?", "Qual o horário?"]; } },
    };
    const now = Math.floor(Date.now() / 1000);
    await deliver(pn, "smb_app_state_sync", { state_sync: [{ type: "contact", contact: { full_name: "Fornecedor", phone_number: "5577987770002" }, action: "add" }] });
    await deliver(pn, "history", { history: [{ threads: [
      { id: "5577987770001", messages: [
        { from: "5577987770001", id: `wamid.faq.${stamp}.1`, timestamp: String(now - 86400), type: "text", text: { body: "Boa tarde" } },
        { from: "5577987770001", id: `wamid.faq.${stamp}.2`, timestamp: String(now - 86300), type: "text", text: { body: "Aceita cartão?" } },
      ] },
      { id: "5577987770002", messages: [{ from: "5577987770002", id: `wamid.faq.${stamp}.3`, timestamp: String(now - 86000), type: "text", text: { body: "Segue o boleto do fornecedor" } }] },
    ] }] });

    await db.update(scheduledActions).set({ runAt: sql`now() - interval '1 second'` })
      .where(and(eq(scheduledActions.operationId, opId), sql`${scheduledActions.kind} = 'extract_faq'`));
    await run(opId, ctx);

    expect(seen).toEqual([["Boa tarde", "Aceita cartão?"]]);
    const [suggestions] = await db.select().from(events).where(and(eq(events.operationId, opId), eq(events.type, "faq_suggestions")));
    expect(suggestions?.payload).toEqual({ questions: ["Aceita cartão?", "Qual o horário?"] });
    const leftovers = await db.execute(sql`select count(*)::int as n from webhook_events where payload::text like ${`%wamid.faq.${stamp}%`}`);
    expect(leftovers[0]).toMatchObject({ n: 0 });
  }, 30_000);
});
