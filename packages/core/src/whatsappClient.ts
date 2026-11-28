/**
 * Minimal client for sending messages through the WhatsApp Cloud API.
 */
import { brazilPhoneVariants } from "./phone";

/** Meta's "recipient not in allowed list", returned while sending from a test number. */
const NOT_IN_ALLOWED_LIST = 131030;

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

/** A reply button on a free-text message; its id comes back when the person taps it. */
export type ReplyButton = { id: string; title: string };

export type WhatsAppClient = {
  sendText(phoneNumberId: string, to: string, body: string): Promise<string>;
  /** Free text with up to three reply buttons. Only inside the 24-hour window. */
  sendButtons(phoneNumberId: string, to: string, body: string, buttons: ReplyButton[]): Promise<string>;
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
  /**
   * One token for every number, or a lookup by sending number: each client
   * connected through Embedded Signup has its own business token.
   */
  accessToken: string | ((phoneNumberId: string) => Promise<string>);
  apiVersion: string;
  fetchImpl?: typeof fetch;
}): WhatsAppClient {
  const doFetch = options.fetchImpl ?? fetch;
  const tokenFor = (phoneNumberId: string) =>
    typeof options.accessToken === "string" ? Promise.resolve(options.accessToken) : options.accessToken(phoneNumberId);

  /**
   * Many Brazilian WhatsApp accounts still report their number without the
   * ninth digit, while the test number's allowed list keeps the form the
   * person typed. On that refusal, try the other form once.
   */
  async function post(phoneNumberId: string, body: Record<string, unknown>): Promise<string> {
    try {
      return await postOnce(phoneNumberId, body);
    } catch (error) {
      const to = typeof body.to === "string" ? body.to : null;
      const code = (error as WhatsAppApiError).details as { error?: { code?: number } } | null;
      if (!(error instanceof WhatsAppApiError) || code?.error?.code !== NOT_IN_ALLOWED_LIST || !to) throw error;
      const other = brazilPhoneVariants(to).find((v) => v !== to);
      if (!other) throw error;
      return postOnce(phoneNumberId, { ...body, to: other });
    }
  }

  async function postOnce(phoneNumberId: string, body: Record<string, unknown>): Promise<string> {
    const response = await doFetch(
      `https://graph.facebook.com/${options.apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await tokenFor(phoneNumberId)}`,
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

    sendButtons(phoneNumberId, to, body, buttons) {
      return post(phoneNumberId, {
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
        },
      });
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
