import { randomUUID } from "node:crypto";
import type { WhatsAppClient } from "@post-lead/core";
import { sandboxMessages, type Database } from "@post-lead/db";
import { NOTIFICATION_BUTTON_TITLES, NOTIFICATION_TEMPLATES, notificationText, type NotificationTemplate } from "./notifications";
import { storeWebhook, WEBHOOK_PROVIDERS } from "./webhooks";

const NOTIFICATION_NAMES = new Set<string>(Object.values(NOTIFICATION_TEMPLATES));

function isNotification(name: string): name is NotificationTemplate {
  return NOTIFICATION_NAMES.has(name);
}

/**
 * A WhatsApp client that sends nothing: each message is stored in
 * sandbox_messages for the panel to show. Templates are rendered with the same
 * text the approved template would have.
 */
export function createSandboxWhatsApp(db: Database): WhatsAppClient {
  async function record(row: typeof sandboxMessages.$inferInsert) {
    await db.insert(sandboxMessages).values(row);
    return `wamid.sandbox.${randomUUID()}`;
  }

  return {
    sendText(phoneNumberId, to, body) {
      return record({ phoneNumberId, to, kind: "text", body });
    },
    sendButtons(phoneNumberId, to, body, buttons) {
      return record({ phoneNumberId, to, kind: "buttons", body, buttons });
    },
    sendTemplate(input) {
      const params = input.bodyParams ?? [];
      const body = isNotification(input.template)
        ? notificationText(input.template, params)
        : params.length
          ? `Parâmetros: ${params.join(" · ")}`
          : "(modelo sem parâmetros)";
      const titles = isNotification(input.template) ? (NOTIFICATION_BUTTON_TITLES[input.template] ?? []) : [];
      const buttons = (input.quickReplyPayloads ?? []).map((b) => ({ id: b.payload, title: titles[b.index] ?? `Botão ${b.index + 1}` }));
      return record({ phoneNumberId: input.phoneNumberId, to: input.to, kind: "template", template: input.template, body, buttons });
    },
  };
}

export type SimulatedInbound = {
  /** The number that receives it: the client's number, or the tool's number for a seller. */
  phoneNumberId: string;
  from: string;
  name?: string;
  text?: string;
  /** A reply-button id, as if the person tapped it. */
  buttonId?: string;
  buttonTitle?: string;
};

/**
 * Stores a message shaped like Meta's webhook, as if someone wrote to the
 * number. The worker applies it like any real one.
 */
export async function simulateInbound(db: Database, input: SimulatedInbound) {
  const message = input.buttonId
    ? { type: "button", button: { payload: input.buttonId, text: input.buttonTitle ?? input.buttonId } }
    : { type: "text", text: { body: input.text ?? "" } };

  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "sandbox",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: input.phoneNumberId, display_phone_number: "sandbox" },
              contacts: [{ wa_id: input.from, profile: { name: input.name?.trim() || "Teste" } }],
              messages: [
                {
                  from: input.from,
                  id: `wamid.sandbox.in.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
  await storeWebhook(db, WEBHOOK_PROVIDERS.whatsapp, JSON.stringify(payload));
}
