import type { SendTemplateInput, WhatsAppClient } from "@post-lead/core";
import { agencies, and, createDb, eq, events, leads, operations, people, scheduledActions, sql } from "@post-lead/db";
import { createLead, outcomePayload, processPendingWebhooks, runDueActions, storeWebhook } from "@post-lead/services";

const db = createDb(process.env.DATABASE_URL);
const TOOL = "tool-demo";
const PN = `client-demo-${Date.now()}`;
const log: { step: string; detail: string }[] = [];
const sent: SendTemplateInput[] = [];
const wa: WhatsAppClient = {
  async sendText(_p, to, body) { log.push({ step: "WhatsApp enviado (texto)", detail: `para ${to}: ${body}` }); return `t.${Math.random()}`; },
  async sendTemplate(i) { sent.push(i); log.push({ step: "WhatsApp enviado", detail: `${i.phoneNumberId === TOOL ? "número da ferramenta" : "número do cliente"} → ${i.to} · modelo ${i.template}${i.bodyParams?.length ? " · " + i.bodyParams.join(", ") : ""}` }); return `m.${Math.random()}`; },
};
const ctx = { db, whatsapp: wa, toolPhoneNumberId: TOOL };
const hook = (field: string, value: object, pn = PN) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [{ field, value: { metadata: { phone_number_id: pn }, ...value } }] }] });
const now = () => String(Math.floor(Date.now() / 1000));
const pending = async (id: string) => (await db.select({ k: scheduledActions.kind }).from(scheduledActions).where(and(eq(scheduledActions.leadId, id), eq(scheduledActions.status, "pending")))).map(r => r.k).sort().join(", ") || "nada";
const stage = async (id: string) => (await db.select({ s: leads.stage }).from(leads).where(eq(leads.id, id)))[0]!.s;

const [a] = await db.insert(agencies).values({ name: "Agência" }).returning();
const [op] = await db.insert(operations).values({ agencyId: a!.id, name: "Clínica Sorriso", phoneNumberId: PN, firstResponseMinutes: 5, staleDays: 3,
  cadence: { firstContactTemplate: "first_contact", followUps: [{ afterMinutes: 60, template: "follow_up_1" }, { afterMinutes: 1440, template: "follow_up_2" }] } }).returning();
await db.insert(people).values([{ operationId: op!.id, name: "Bia", whatsappNumber: "5577911110001", role: "seller" }, { operationId: op!.id, name: "Gestor", whatsappNumber: "5577911110003", role: "manager" }]);

const r = await createLead(db, { operationId: op!.id, contactName: "Ana Souza", phone: "(77) 99876-5432", source: "form", campaign: "Clareamento", whatsappConsent: true });
const id = (r as any).leadId;
log.push({ step: "1. Lead entra pelo formulário", detail: `Ana Souza, campanha Clareamento · responsável: Bia (rodízio) · na fila: ${await pending(id)}` });
await runDueActions(ctx);
log.push({ step: "2. Worker age em segundos", detail: `etapa: ${await stage(id)} · na fila: ${await pending(id)}` });
await storeWebhook(db, "whatsapp", hook("messages", { messages: [{ from: "557798765432", id: `in.${Date.now()}`, timestamp: now(), type: "text", text: { body: "Oi, quanto custa?" } }] }));
await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
log.push({ step: "3. Ana responde (\"Oi, quanto custa?\")", detail: `retornos automáticos cancelados · etapa: ${await stage(id)} · na fila: ${await pending(id)}` });
await runDueActions(ctx);
await storeWebhook(db, "whatsapp", hook("smb_message_echoes", { message_echoes: [{ from: PN, to: "557798765432", id: `e.${Date.now()}`, timestamp: now(), type: "text", text: { body: "Olá Ana!" } }] }));
await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
log.push({ step: "4. Bia responde pelo app WhatsApp Business", detail: `lembrete e alerta ao gestor cancelados · na fila: ${await pending(id)}` });
await db.update(scheduledActions).set({ runAt: sql`now()` }).where(and(eq(scheduledActions.leadId, id), eq(scheduledActions.kind, "stale_check")));
await runDueActions(ctx);
log.push({ step: "5. 3 dias sem conversa (simulado)", detail: "a ferramenta pergunta à Bia o resultado, com 3 botões" });
await storeWebhook(db, "whatsapp", hook("messages", { messages: [{ from: "5577911110001", id: `b.${Date.now()}`, timestamp: now(), type: "button", button: { payload: outcomePayload("won", id), text: "Ganhou" } }] }, TOOL));
await processPendingWebhooks(db, { toolPhoneNumberId: TOOL });
log.push({ step: "6. Bia toca em \"Ganhou\"", detail: `etapa: ${await stage(id)} · na fila: ${await pending(id)}` });
const ev = await db.select({ t: events.type }).from(events).where(eq(events.leadId, id)).orderBy(events.createdAt);
log.push({ step: "Histórico gravado", detail: ev.map(e => e.t).join(" → ") });
console.log(JSON.stringify(log, null, 1));
process.exit(0);
