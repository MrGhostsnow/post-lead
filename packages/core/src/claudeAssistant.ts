import { MODEL_HANDOFF_REASONS, type AssistantModel, type FaqExtractor, type ModelTurn } from "./assistant";

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

/**
 * FaqExtractor backed by the Claude API. Receives lead messages from the
 * history once, returns up to 15 common questions. The texts are not kept.
 */
export function createClaudeFaqExtractor(options: { apiKey: string; model: string; fetchImpl?: typeof fetch }): FaqExtractor {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async extract(texts) {
      if (texts.length === 0) return [];
      const response = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 1200,
          system:
            "Você recebe mensagens que clientes mandaram a uma empresa pelo WhatsApp. Liste as perguntas mais comuns, de forma genérica, em português, sem nomes, telefones ou qualquer dado pessoal. No máximo 15, da mais comum para a menos comum.",
          messages: [{ role: "user", content: texts.map((t) => `- ${t.replace(/\s+/g, " ")}`).join("\n") }],
          tools: [
            {
              name: "listar_perguntas",
              description: "Registra as perguntas frequentes.",
              input_schema: { type: "object", properties: { questions: { type: "array", items: { type: "string" } } }, required: ["questions"] },
            },
          ],
          tool_choice: { type: "tool", name: "listar_perguntas" },
        }),
      });
      const json = (await response.json().catch(() => null)) as { content?: { type: string; input?: { questions?: unknown } }[]; error?: { message?: string } } | null;
      if (!response.ok) throw new AssistantApiError(json?.error?.message ?? `Claude API error ${response.status}`, response.status);
      const questions = json?.content?.find((c) => c.type === "tool_use")?.input?.questions;
      return Array.isArray(questions) ? questions.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, 15) : [];
    },
  };
}
