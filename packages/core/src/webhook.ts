/**
 * Turns WhatsApp Business Platform webhook payloads into a small set of
 * normalized events. Only the fields the product needs are kept.
 *
 * Fields handled:
 * - "messages": messages from leads, and delivery statuses of what we sent.
 * - "smb_message_echoes": messages the business sent from the WhatsApp Business
 *   app (coexistence). This is how we know a person answered the lead.
 */

export type InboundMessageEvent = {
  kind: "inbound_message";
  phoneNumberId: string;
  from: string;
  contactName: string | null;
  waMessageId: string;
  timestamp: Date;
  type: string;
  text: string | null;
  /** Id of a tapped quick-reply or interactive button, when there is one. */
  buttonPayload: string | null;
};

export type BusinessEchoEvent = {
  kind: "business_echo";
  phoneNumberId: string;
  to: string;
  waMessageId: string;
  timestamp: Date;
  type: string;
  text: string | null;
};

export type StatusEvent = {
  kind: "status";
  phoneNumberId: string;
  waMessageId: string;
  recipient: string;
  status: string;
  timestamp: Date;
};

export type NormalizedEvent = InboundMessageEvent | BusinessEchoEvent | StatusEvent;

type RawMessage = {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
};

type RawValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: RawMessage[];
  message_echoes?: RawMessage[];
  statuses?: { id?: string; status?: string; timestamp?: string; recipient_id?: string }[];
};

type RawPayload = {
  object?: string;
  entry?: { changes?: { field?: string; value?: RawValue }[] }[];
};

const toDate = (unixSeconds: string | undefined) =>
  new Date(Number(unixSeconds ?? 0) * 1000);

function textOf(message: RawMessage): string | null {
  return (
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    null
  );
}

function buttonPayloadOf(message: RawMessage): string | null {
  return (
    message.button?.payload ??
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    null
  );
}

export function parseWhatsAppWebhook(payload: unknown): NormalizedEvent[] {
  const body = payload as RawPayload;
  if (body?.object !== "whatsapp_business_account") return [];

  const events: NormalizedEvent[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;

      if (change.field === "messages") {
        for (const message of value.messages ?? []) {
          if (!message.id || !message.from) continue;
          const contact = value.contacts?.find((c) => c.wa_id === message.from);
          events.push({
            kind: "inbound_message",
            phoneNumberId,
            from: message.from,
            contactName: contact?.profile?.name ?? null,
            waMessageId: message.id,
            timestamp: toDate(message.timestamp),
            type: message.type ?? "unknown",
            text: textOf(message),
            buttonPayload: buttonPayloadOf(message),
          });
        }
        for (const status of value.statuses ?? []) {
          if (!status.id || !status.status) continue;
          events.push({
            kind: "status",
            phoneNumberId,
            waMessageId: status.id,
            recipient: status.recipient_id ?? "",
            status: status.status,
            timestamp: toDate(status.timestamp),
          });
        }
      }

      if (change.field === "smb_message_echoes") {
        // Check the payload shape against Meta's coexistence docs before going live.
        const echoes = value.message_echoes ?? value.messages ?? [];
        for (const message of echoes) {
          if (!message.id || !message.to) continue;
          events.push({
            kind: "business_echo",
            phoneNumberId,
            to: message.to,
            waMessageId: message.id,
            timestamp: toDate(message.timestamp),
            type: message.type ?? "unknown",
            text: textOf(message),
          });
        }
      }
    }
  }

  return events;
}
