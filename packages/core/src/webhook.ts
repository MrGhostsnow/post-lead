/**
 * Turns WhatsApp Business Platform webhook payloads into a small set of
 * normalized events. Only the fields the product needs are kept.
 *
 * Fields handled:
 * - "messages": messages from leads, and delivery statuses of what we sent.
 * - "smb_message_echoes": messages the business sent from the WhatsApp Business
 *   app (coexistence). This is how we know a person answered the lead.
 * - "history": the 180 days of chats Meta shares once at activation. Only who,
 *   when and which direction are kept, never the text.
 * - "smb_app_state_sync": contacts in the app's address book, and later changes.
 */

/** Present when the lead wrote after tapping a click-to-WhatsApp ad. */
export type AdReferral = {
  sourceId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  ctwaClid: string | null;
};

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
  referral: AdReferral | null;
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

export type HistoryEvent = {
  kind: "history";
  phoneNumberId: string;
  /** False when the business declined to share its history. */
  shared: boolean;
  messages: { contactPhone: string; waMessageId: string; direction: "inbound" | "outbound"; timestamp: Date }[];
};

export type ContactSyncEvent = {
  kind: "contact_sync";
  phoneNumberId: string;
  contacts: { phone: string; name: string | null; action: "add" | "remove" }[];
};

export type NormalizedEvent = InboundMessageEvent | BusinessEchoEvent | StatusEvent | HistoryEvent | ContactSyncEvent;

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
  referral?: {
    source_id?: string;
    source_type?: string;
    source_url?: string;
    headline?: string;
    ctwa_clid?: string;
  };
};

type RawHistoryChunk = {
  threads?: { id?: string; messages?: RawMessage[] }[];
  errors?: { code?: number }[];
};

type RawStateSync = {
  type?: string;
  contact?: { full_name?: string; first_name?: string; phone_number?: string };
  action?: string;
};

type RawValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: RawMessage[];
  message_echoes?: RawMessage[];
  statuses?: { id?: string; status?: string; timestamp?: string; recipient_id?: string }[];
  history?: RawHistoryChunk[];
  state_sync?: RawStateSync[];
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

function referralOf(message: RawMessage): AdReferral | null {
  const r = message.referral;
  if (!r) return null;
  return {
    sourceId: r.source_id ?? null,
    sourceType: r.source_type ?? null,
    sourceUrl: r.source_url ?? null,
    headline: r.headline ?? null,
    ctwaClid: r.ctwa_clid ?? null,
  };
}

function historyEvent(phoneNumberId: string, chunks: RawHistoryChunk[]): HistoryEvent {
  const declined = chunks.some((c) => c.errors?.length);
  const out: HistoryEvent["messages"] = [];
  for (const chunk of chunks) {
    for (const thread of chunk.threads ?? []) {
      // The thread id is the other person's number; a message "from" them is inbound.
      if (!thread.id) continue;
      for (const message of thread.messages ?? []) {
        if (!message.id || !message.timestamp) continue;
        out.push({
          contactPhone: thread.id,
          waMessageId: message.id,
          direction: message.from === thread.id ? "inbound" : "outbound",
          timestamp: toDate(message.timestamp),
        });
      }
    }
  }
  return { kind: "history", phoneNumberId, shared: !declined, messages: out };
}

export function parseWhatsAppWebhook(payload: unknown): NormalizedEvent[] {
  // A declined history share arrives without the usual envelope.
  const bare = payload as RawValue & { messaging_product?: string };
  if (!(payload as RawPayload)?.object && bare?.history && bare.metadata?.phone_number_id) {
    return [historyEvent(bare.metadata.phone_number_id, bare.history)];
  }

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
            referral: referralOf(message),
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

      if (change.field === "history") {
        events.push(historyEvent(phoneNumberId, value.history ?? []));
      }

      if (change.field === "smb_app_state_sync") {
        const synced: ContactSyncEvent["contacts"] = [];
        for (const item of value.state_sync ?? []) {
          const phone = item.contact?.phone_number;
          if (item.type !== "contact" || !phone) continue;
          synced.push({
            phone,
            name: item.contact?.full_name ?? item.contact?.first_name ?? null,
            action: item.action === "remove" ? "remove" : "add",
          });
        }
        events.push({ kind: "contact_sync", phoneNumberId, contacts: synced });
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
