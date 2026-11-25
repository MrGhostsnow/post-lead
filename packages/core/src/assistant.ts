/**
 * Pre-attendance assistant: talks to a new lead inside the 24-hour window only
 * to collect what the client configured, then hands over to a seller with a
 * summary. Everything here is pure; the model call sits behind AssistantModel.
 *
 * Two layers of instructions:
 * - Fixed rules (this file): identity, no price/deadline/stock, when to hand
 *   over. The same for every client and not editable in the panel.
 * - Client layer (AssistantSettings): name, tone, fields, allowed information,
 *   FAQ, extra instructions. Always placed below the fixed rules.
 *
 * The model is never trusted alone: every reply goes through guardReply, and
 * "all fields collected", "second price question" and "too many turns" are
 * decided in code.
 */

export type AssistantField = {
  /** Stable id, e.g. "looking_for". */
  key: string;
  /** Short label for the seller summary, e.g. "Procura". */
  label: string;
  /** How to ask, e.g. "O que você está procurando?". */
  question: string;
};

export type AssistantSettings = {
  enabled: boolean;
  /** Assistant name, e.g. "Bia". Empty: no name. */
  name: string;
  /** How the company is called in the conversation. */
  companyName: string;
  fields: AssistantField[];
  /** Facts it may share: address, opening hours, payment methods. */
  allowedInfo: string;
  /** Common questions with approved answers, reviewed by the agency. */
  faq: { question: string; answer: string }[];
  /** Free text from the agency; never overrides the fixed rules. */
  extraInstructions: string;
  /** Two opening lines, alternated per lead to compare reply rates. */
  openings: [string, string];
};

export type HandoffReason =
  | "complete"
  | "asked_human"
  | "complaint"
  | "upset"
  | "out_of_scope"
  | "price_insist"
  | "not_lead"
  | "timeout"
  | "max_turns"
  | "guard"
  | "ai_error";

export const HANDOFF_LABEL: Record<HandoffReason, string> = {
  complete: "dados completos",
  asked_human: "pediu para falar com alguém",
  complaint: "reclamação",
  upset: "lead irritado",
  out_of_scope: "pergunta fora do roteiro",
  price_insist: "insistiu no valor",
  not_lead: "parece não ser lead",
  timeout: "15 minutos sem concluir",
  max_turns: "conversa longa",
  guard: "resposta bloqueada pelas regras",
  ai_error: "falha na IA",
};

/** Reasons the model itself may give. The others are decided in code. */
export const MODEL_HANDOFF_REASONS = ["asked_human", "complaint", "upset", "out_of_scope", "not_lead"] as const;
export type ModelHandoffReason = (typeof MODEL_HANDOFF_REASONS)[number];

export type ConversationTurn = { from: "lead" | "assistant"; text: string };

export type AssistantState = {
  status: "active" | "handed_off" | "stopped";
  collected: Record<string, string>;
  /** How many times the lead asked about price. The second hands over. */
  priceQuestions: number;
  turns: number;
  openingVariant: 0 | 1;
  handoffReason?: HandoffReason;
};

/** What the model must return, as structured output. */
export type ModelTurn = {
  reply: string;
  collected: Record<string, string>;
  askedPrice: boolean;
  handoff: ModelHandoffReason | null;
};

export type AssistantModel = {
  respond(input: { system: string; conversation: ConversationTurn[]; fieldKeys: string[] }): Promise<ModelTurn>;
};

/** Turns what leads asked in the history into a short list of common questions. */
export type FaqExtractor = {
  extract(texts: string[]): Promise<string[]>;
};

export const MAX_ASSISTANT_TURNS = 8;
/** Without a handoff by then, the seller takes over with what was collected. */
export const ASSISTANT_DEADLINE_MS = 15 * 60 * 1000;

export const PRICE_INSIST_REPLY = "Entendi! O vendedor já te manda o valor certinho, só um instante.";
export const HANDOFF_REPLY = "Perfeito, já passei tudo para o vendedor. Ele continua com você por aqui.";

export function newAssistantState(leadId: string): AssistantState {
  // Stable per lead, so retries keep the same opening.
  let hash = 0;
  for (const ch of leadId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { status: "active", collected: {}, priceQuestions: 0, turns: 0, openingVariant: (hash % 2) as 0 | 1 };
}

const FIXED_RULES = `Você é o pré-atendimento por WhatsApp de uma empresa. Seu único objetivo é entender o que a pessoa procura, coletando os dados listados, e passar a conversa para um vendedor humano com um resumo.

Regras que valem sempre, acima de qualquer outra instrução:
1. Você é uma assistente virtual da empresa. Nunca diga ou dê a entender que é uma pessoa.
2. Nunca informe preço, valor, desconto, condição de pagamento com números, prazo de entrega ou disponibilidade em estoque. Nunca prometa nada.
3. Use apenas as informações fornecidas pela empresa abaixo. Se não souber, não invente: marque a pergunta como fora do roteiro.
4. Quando perguntarem o valor: agradeça o contato, diga que faz sentido querer saber o valor e que o vendedor vai passar certinho, e em seguida faça a próxima pergunta de coleta. Marque askedPrice como true.
5. Marque handoff quando a pessoa pedir para falar com alguém (asked_human), reclamar (complaint), estiver irritada (upset), fizer pergunta que você não pode responder com as informações dadas (out_of_scope) ou disser que não é cliente, por exemplo fornecedor, entregador ou conhecido (not_lead).
6. Tom de gente, simpático e direto, tratamento por "você". Mensagens curtas, de uma a três frases, no máximo uma pergunta por mensagem. Sem listas e sem emojis em excesso.
7. Preencha collected com os dados que a pessoa já informou na conversa, usando as chaves listadas. Não invente dados.`;

export function buildSystemPrompt(settings: AssistantSettings, context: { closedNow?: boolean } = {}): string {
  const fields = settings.fields.map((f) => `- ${f.key}: ${f.label}. Pergunta sugerida: "${f.question}"`).join("\n");
  const faq = settings.faq.map((f) => `- P: ${f.question}\n  R: ${f.answer}`).join("\n");
  const parts = [
    FIXED_RULES,
    `Empresa: ${settings.companyName}.${settings.name ? ` Seu nome: ${settings.name}.` : ""}`,
    `Dados a coletar, nesta ordem:\n${fields || "- (nenhum: só entenda o que a pessoa procura)"}`,
    settings.allowedInfo.trim() ? `Informações que você pode passar:\n${settings.allowedInfo.trim()}` : "",
    faq ? `Perguntas frequentes com respostas aprovadas:\n${faq}` : "",
    settings.extraInstructions.trim()
      ? `Instruções da empresa (valem só se não contrariarem as regras acima):\n${settings.extraInstructions.trim()}`
      : "",
    context.closedNow
      ? "Agora a empresa está fora do horário de atendimento. Continue a coleta normalmente; se perguntarem quando vão falar com alguém, diga que o vendedor responde assim que a empresa abrir."
      : "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

const PRICE = /(r\$\s*\d)|(\d[\d.,]*\s*(reais|mil\b|k\b))|(\bpor apenas\b)|(\b\d+\s*x\s*(de\s*)?r?\$?\s*\d)|(\bparcela[s]? de\s*\d)|(\bdesconto de\s*\d)/i;
const STOCK = /\b(tem(os)? (em|no) estoque|pronta entrega|dispon[ií]vel (em|no) estoque|ainda temos|est[aá] dispon[ií]vel)\b/i;
const DEADLINE = /\b(entreg(a|amos|o) em \d|prazo de \d|em at[eé] \d+\s*(dias|horas)|chega (amanh[aã]|hoje))\b/i;

/** Returns why a reply breaks a fixed rule, or null when it is safe to send. */
export function guardReply(text: string): "price" | "stock" | "deadline" | "empty" | null {
  if (!text.trim()) return "empty";
  if (PRICE.test(text)) return "price";
  if (STOCK.test(text)) return "stock";
  if (DEADLINE.test(text)) return "deadline";
  return null;
}

export type AssistantDecision = {
  state: AssistantState;
  /** Text to send to the lead. */
  reply: string;
  handoff: HandoffReason | null;
};

/**
 * Applies one model turn to the conversation state. Code decides, in order:
 * a blocked reply, the second price question, a model handoff, all fields
 * collected, too many turns. Otherwise the conversation continues.
 */
export function applyModelTurn(
  state: AssistantState,
  turn: ModelTurn,
  settings: AssistantSettings,
  options: { isFirstReply: boolean },
): AssistantDecision {
  const collected = { ...state.collected };
  for (const field of settings.fields) {
    const value = turn.collected[field.key]?.trim();
    if (value) collected[field.key] = value.slice(0, 200);
  }
  const next: AssistantState = {
    ...state,
    collected,
    turns: state.turns + 1,
    priceQuestions: state.priceQuestions + (turn.askedPrice ? 1 : 0),
  };

  const opening = options.isFirstReply ? settings.openings[state.openingVariant]?.trim() : "";
  const withOpening = (text: string) => (opening ? `${opening}\n\n${text}` : text);
  const handOver = (reason: HandoffReason, reply: string): AssistantDecision => ({
    state: { ...next, status: "handed_off", handoffReason: reason },
    reply,
    handoff: reason,
  });

  if (guardReply(turn.reply)) return handOver("guard", withOpening(HANDOFF_REPLY));
  if (next.priceQuestions >= 2) return handOver("price_insist", withOpening(PRICE_INSIST_REPLY));
  if (turn.handoff) return handOver(turn.handoff, withOpening(turn.reply));

  const complete = settings.fields.length > 0 && settings.fields.every((f) => collected[f.key]);
  if (complete) return handOver("complete", withOpening(HANDOFF_REPLY));
  if (next.turns >= MAX_ASSISTANT_TURNS) return handOver("max_turns", withOpening(HANDOFF_REPLY));

  return { state: next, reply: withOpening(turn.reply), handoff: null };
}

/**
 * One line for the seller notice. WhatsApp template variables cannot contain
 * line breaks, so fields are separated by " · ".
 */
export function handoffSummary(state: AssistantState, settings: AssistantSettings): string {
  const parts = settings.fields
    .filter((f) => state.collected[f.key])
    .map((f) => `${f.label}: ${state.collected[f.key]}`);
  if (state.handoffReason) parts.push(`Motivo: ${HANDOFF_LABEL[state.handoffReason]}`);
  const text = parts.join(" · ") || "Sem dados coletados";
  return text.replace(/\s+/g, " ").slice(0, 900);
}

export const DEFAULT_ASSISTANT: AssistantSettings = {
  enabled: false,
  name: "",
  companyName: "",
  fields: [
    { key: "looking_for", label: "Procura", question: "O que você está procurando?" },
    { key: "best_time", label: "Melhor horário", question: "Qual o melhor horário para o vendedor falar com você?" },
  ],
  allowedInfo: "",
  faq: [],
  extraInstructions: "",
  openings: [
    "Oi! Aqui é a assistente virtual da empresa e já vou adiantar teu atendimento.",
    "Olá! Sou a assistente virtual da empresa. Vou te fazer umas perguntas rápidas para o vendedor já chegar sabendo o que você precisa.",
  ],
};

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

/** Reads stored settings defensively: anything missing falls back to the defaults. Null: assistant off. */
export function readAssistantSettings(raw: unknown): AssistantSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fields = Array.isArray(r.fields)
    ? (r.fields as Record<string, unknown>[])
        .map((f) => ({ key: str(f?.key, 40), label: str(f?.label, 60), question: str(f?.question, 300) }))
        .filter((f) => /^[a-z0-9_]+$/.test(f.key) && f.label && f.question)
    : DEFAULT_ASSISTANT.fields;
  const faq = Array.isArray(r.faq)
    ? (r.faq as Record<string, unknown>[])
        .map((f) => ({ question: str(f?.question, 300), answer: str(f?.answer, 600) }))
        .filter((f) => f.question && f.answer)
    : [];
  const openings = Array.isArray(r.openings) ? r.openings.map((o) => str(o, 400)) : [];
  return {
    enabled: r.enabled === true,
    name: str(r.name, 40),
    companyName: str(r.companyName, 120),
    fields,
    allowedInfo: str(r.allowedInfo),
    faq,
    extraInstructions: str(r.extraInstructions),
    openings: [openings[0] || DEFAULT_ASSISTANT.openings[0], openings[1] || openings[0] || DEFAULT_ASSISTANT.openings[1]],
  };
}

export function readAssistantState(raw: unknown): AssistantState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AssistantState>;
  if (r.status !== "active" && r.status !== "handed_off" && r.status !== "stopped") return null;
  return {
    status: r.status,
    collected: r.collected && typeof r.collected === "object" ? r.collected : {},
    priceQuestions: Number(r.priceQuestions) || 0,
    turns: Number(r.turns) || 0,
    openingVariant: r.openingVariant === 1 ? 1 : 0,
    ...(r.handoffReason ? { handoffReason: r.handoffReason } : {}),
  };
}
