import { MODEL_HANDOFF_REASONS, type AssistantModel, type ModelTurn } from "./assistant";

export class AssistantApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const TOOL = "responder_lead";

/**
 * AssistantModel backed by the Claude Messages API. The reply comes back as a
 * forced tool call, so it is always structured: reply, collected fields,
 * whether the lead asked the price, and an optional handoff reason.
 */
export function createClaudeAssistant(options: {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): AssistantModel {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async respond({ system, conversation, fieldKeys }) {
      // The API needs alternating roles starting with the user; merge repeats.
      const messages: { role: "user" | "assistant"; content: string }[] = [];
      for (const turn of conversation) {
        const role = turn.from === "lead" ? "user" : "assistant";
        const last = messages[messages.length - 1];
        if (last?.role === role) last.content += `\n${turn.text}`;
        else messages.push({ role, content: turn.text });
      }
      if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: "(início da conversa)" });

      const collectedProperties = Object.fromEntries(fieldKeys.map((k) => [k, { type: "string" }]));
      const body = {
        model: options.model,
        max_tokens: 600,
        system,
        messages,
        tools: [
          {
            name: TOOL,
            description: "Envia a próxima mensagem ao lead e registra os dados coletados.",
            input_schema: {
              type: "object",
              properties: {
                reply: { type: "string", description: "Mensagem para o lead, curta, em português." },
                collected: { type: "object", properties: collectedProperties, additionalProperties: false },
                askedPrice: { type: "boolean", description: "A última mensagem do lead pergunta preço ou valor." },
                handoff: { type: ["string", "null"], enum: [...MODEL_HANDOFF_REASONS, null] },
              },
              required: ["reply", "collected", "askedPrice", "handoff"],
            },
          },
        ],
        tool_choice: { type: "tool", name: TOOL },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
      try {
        const response = await doFetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": options.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const json = (await response.json().catch(() => null)) as
          | { content?: { type: string; name?: string; input?: unknown }[]; error?: { message?: string } }
          | null;
        if (!response.ok) throw new AssistantApiError(json?.error?.message ?? `Claude API error ${response.status}`, response.status);

        const call = json?.content?.find((c) => c.type === "tool_use" && c.name === TOOL);
        return parseModelTurn(call?.input);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Validates the tool input; anything malformed is an error, never a guess. */
export function parseModelTurn(input: unknown): ModelTurn {
  const value = input as Partial<Record<keyof ModelTurn, unknown>> | undefined;
  if (!value || typeof value.reply !== "string") throw new AssistantApiError("Assistant returned no reply", 502);
  const collected: Record<string, string> = {};
  if (value.collected && typeof value.collected === "object") {
    for (const [k, v] of Object.entries(value.collected as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) collected[k] = v;
    }
  }
  const handoff = MODEL_HANDOFF_REASONS.find((r) => r === value.handoff) ?? null;
  return { reply: value.reply, collected, askedPrice: value.askedPrice === true, handoff };
}
