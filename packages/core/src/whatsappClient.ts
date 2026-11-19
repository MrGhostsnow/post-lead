/**
 * Minimal client for sending messages through the WhatsApp Cloud API.
 */

export type TemplateButtonParam = { index: number; payload: string };

export type SendTemplateInput = {
  phoneNumberId: string;
  to: string;
  template: string;
  languageCode?: string;
  bodyParams?: string[];
  /** Payloads for quick-reply buttons, returned to us when the person taps one. */
  quickReplyPayloads?: TemplateButtonParam[];
};

export type WhatsAppClient = {
  sendText(phoneNumberId: string, to: string, body: string): Promise<string>;
  sendTemplate(input: SendTemplateInput): Promise<string>;
};

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message);
  }
}

export function createWhatsAppClient(options: {
  accessToken: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
}): WhatsAppClient {
  const doFetch = options.fetchImpl ?? fetch;

  async function post(phoneNumberId: string, body: Record<string, unknown>): Promise<string> {
    const response = await doFetch(
      `https://graph.facebook.com/${options.apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      },
    );

    const json = (await response.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string } }
      | null;

    if (!response.ok) {
      throw new WhatsAppApiError(
        json?.error?.message ?? `WhatsApp API error ${response.status}`,
        response.status,
        json,
      );
    }

    const id = json?.messages?.[0]?.id;
    if (!id) throw new WhatsAppApiError("WhatsApp API returned no message id", response.status, json);
    return id;
  }

  return {
    sendText(phoneNumberId, to, body) {
      return post(phoneNumberId, { to, type: "text", text: { body } });
    },

    sendTemplate(input) {
      const components: Record<string, unknown>[] = [];

      if (input.bodyParams?.length) {
        components.push({
          type: "body",
          parameters: input.bodyParams.map((text) => ({ type: "text", text })),
        });
      }
      for (const button of input.quickReplyPayloads ?? []) {
        components.push({
          type: "button",
          sub_type: "quick_reply",
          index: String(button.index),
          parameters: [{ type: "payload", payload: button.payload }],
        });
      }

      return post(input.phoneNumberId, {
        to: input.to,
        type: "template",
        template: {
          name: input.template,
          language: { code: input.languageCode ?? "pt_BR" },
          ...(components.length ? { components } : {}),
        },
      });
    },
  };
}
