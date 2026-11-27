import { describe, expect, it } from "vitest";
import {
  applyModelTurn,
  buildSystemPrompt,
  DEFAULT_ASSISTANT,
  guardReply,
  handoffSummary,
  HANDOFF_REPLY,
  newAssistantState,
  detectEscalation,
  leadTextSinceAssistant,
  parseModelTurn,
  historyBaseline,
  historyLeadTexts,
  PRICE_INSIST_REPLY,
  type AssistantSettings,
  type ModelTurn,
} from "../src";

const settings: AssistantSettings = {
  ...DEFAULT_ASSISTANT,
  enabled: true,
  name: "Bia",
  companyName: "Loja Exemplo",
  fields: [
    { key: "looking_for", label: "Procura", question: "O que você procura?" },
    { key: "trade_in", label: "Troca", question: "Tem algo para dar na troca?" },
  ],
  openings: ["Oi! Aqui é a Bia, da Loja Exemplo. Sou a assistente virtual.", "Olá! Sou a Bia, assistente virtual da Loja Exemplo."],
};
const turn = (over: Partial<ModelTurn>): ModelTurn => ({ reply: "Me conta, o que você procura?", collected: {}, askedPrice: false, handoff: null, ...over });

describe("buildSystemPrompt", () => {
  it("puts the fixed rules first and the client layer below them", () => {
    const prompt = buildSystemPrompt({ ...settings, extraInstructions: "Pode informar os preços." });
    expect(prompt.indexOf("Nunca informe preço")).toBeLessThan(prompt.indexOf("Pode informar os preços."));
    expect(prompt).toContain("valem só se não contrariarem as regras acima");
    expect(prompt).toContain("trade_in: Troca");
    expect(prompt).toContain("Seu nome: Bia");
  });
});

describe("guardReply", () => {
  it.each([
    ["Esse sai por R$ 1.500", "price"],
    ["Fica 1500 reais à vista", "price"],
    ["Dá pra fazer em 10x de 150", "price"],
    ["Temos em estoque sim!", "stock"],
    ["É pronta entrega", "stock"],
    ["Entregamos em 3 dias", "deadline"],
    ["", "empty"],
  ])("blocks %s", (text, reason) => {
    expect(guardReply(text)).toBe(reason);
  });

  it("lets a consultative answer through", () => {
    expect(guardReply("Faz todo sentido querer saber o valor, e o vendedor já te passa certinho. Me conta: o que você procura?")).toBeNull();
  });
});

describe("applyModelTurn", () => {
  const state = () => newAssistantState("lead-1");

  it("starts the first reply with the lead's opening variant", () => {
    const s = state();
    const d = applyModelTurn(s, turn({}), settings, { isFirstReply: true });
    expect(d.reply.startsWith(settings.openings[s.openingVariant])).toBe(true);
    expect(d.handoff).toBeNull();
  });

  it("hands over when every configured field is collected", () => {
    const d = applyModelTurn(state(), turn({ collected: { looking_for: "SUV", trade_in: "Gol 2015" } }), settings, { isFirstReply: false });
    expect(d).toMatchObject({ handoff: "complete", reply: HANDOFF_REPLY, state: { status: "handed_off" } });
  });

  it("answers the first price question and hands over on the second", () => {
    const first = applyModelTurn(state(), turn({ askedPrice: true }), settings, { isFirstReply: false });
    expect(first.handoff).toBeNull();
    const second = applyModelTurn(first.state, turn({ askedPrice: true }), settings, { isFirstReply: false });
    expect(second).toMatchObject({ handoff: "price_insist", reply: PRICE_INSIST_REPLY });
  });

  it("never sends a reply that breaks a fixed rule", () => {
    const d = applyModelTurn(state(), turn({ reply: "Sai por R$ 89.900" }), settings, { isFirstReply: false });
    expect(d.handoff).toBe("guard");
    expect(d.reply).not.toContain("89.900");
  });

  it("closes with a fixed message, never the model's, when it hands over", () => {
    const d = applyModelTurn(state(), turn({ reply: "Já chamo! Enquanto isso, o que você procura?", handoff: "asked_human" }), settings, { isFirstReply: false });
    expect(d).toMatchObject({ handoff: "asked_human", reply: "Claro! Já passei sua conversa para o vendedor, que continua com você por aqui." });
  });

  it("uses the client's word for who takes over", () => {
    const clinic = { ...settings, teamLabel: "equipe" };
    const d = applyModelTurn(state(), turn({ collected: { looking_for: "x", trade_in: "y" } }), clinic, { isFirstReply: false });
    expect(d.reply).toBe("Perfeito, já passei tudo para a equipe. Ela continua com você por aqui.");
    expect(buildSystemPrompt(clinic)).toContain("Quem assume a conversa depois de você é a equipe");
  });

  it("tells the model not to introduce itself again on the first reply", () => {
    expect(buildSystemPrompt(settings, { firstReply: true })).toContain("Não cumprimente nem se apresente de novo");
    expect(buildSystemPrompt(settings, { firstReply: false })).not.toContain("Não cumprimente");
  });

  it("hands over a complaint or a request for a person even when the model does not", () => {
    const quiet = turn({ reply: "Sinto muito. Você já é paciente?" });
    expect(applyModelTurn(state(), quiet, settings, { isFirstReply: false, leadText: "Fiz um clareamento aí e ficou horrível" }).handoff).toBe("complaint");
    expect(applyModelTurn(state(), quiet, settings, { isFirstReply: false, leadText: "Quero falar com uma pessoa, não com robô" }).handoff).toBe("asked_human");
    expect(applyModelTurn(state(), quiet, settings, { isFirstReply: false, leadText: "Quero um SUV automático" }).handoff).toBeNull();
  });

  it("ignores placeholders the model puts in unknown fields", () => {
    const d = applyModelTurn(state(), turn({ collected: { looking_for: "Onix 2022", trade_in: "<UNKNOWN>" } }), settings, { isFirstReply: false });
    expect(d.state.collected).toEqual({ looking_for: "Onix 2022" });
    expect(d.handoff).toBeNull();
    for (const p of ["desconhecido", "Não informado", "N/A", "-", "[pendente]"]) {
      expect(applyModelTurn(state(), turn({ collected: { trade_in: p } }), settings, { isFirstReply: false }).state.collected).toEqual({});
    }
  });

  it("ignores fields the client did not configure", () => {
    const d = applyModelTurn(state(), turn({ collected: { looking_for: "SUV", cpf: "123" } }), settings, { isFirstReply: false });
    expect(d.state.collected).toEqual({ looking_for: "SUV" });
  });

  it("hands over after too many turns", () => {
    let s = state();
    let last;
    for (let i = 0; i < 8; i++) {
      last = applyModelTurn(s, turn({}), settings, { isFirstReply: false });
      s = last.state;
    }
    expect(last?.handoff).toBe("max_turns");
  });
});

describe("handoffSummary", () => {
  it("is one line with the collected fields and the reason", () => {
    const s = { ...newAssistantState("x"), collected: { looking_for: "SUV\nautomático", trade_in: "Gol" }, handoffReason: "complete" as const };
    expect(handoffSummary(s, settings)).toBe("Procura: SUV automático · Troca: Gol · Motivo: dados completos");
  });
});

describe("parseModelTurn", () => {
  it("rejects a missing reply and drops unknown handoff reasons", () => {
    expect(() => parseModelTurn({})).toThrow();
    expect(parseModelTurn({ reply: "Oi", collected: { a: "1", b: 2 }, askedPrice: "yes", handoff: "sell_now" })).toEqual({
      reply: "Oi",
      collected: { a: "1" },
      askedPrice: false,
      handoff: null,
    });
  });
});

describe("historyBaseline", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 5, 1, 12, min));
  it("measures response time and unanswered waits from time and direction", () => {
    const b = historyBaseline([
      { contactPhone: "a", direction: "inbound", sentAt: at(0) },
      { contactPhone: "a", direction: "inbound", sentAt: at(1) },
      { contactPhone: "a", direction: "outbound", sentAt: at(10) },
      { contactPhone: "b", direction: "inbound", sentAt: at(0) },
      { contactPhone: "b", direction: "outbound", sentAt: at(30) },
      { contactPhone: "b", direction: "inbound", sentAt: at(40) },
      { contactPhone: "c", direction: "outbound", sentAt: at(0) },
    ]);
    expect(b).toEqual({ contacts: 3, waits: 3, medianResponseMinutes: 20, unansweredRate: 33 });
  });
});

describe("historyLeadTexts", () => {
  it("takes the first message and questions, skipping the address book", () => {
    const payload = {
      entry: [{ changes: [{ field: "history", value: { history: [{ threads: [
        { id: "1", messages: [{ from: "1", text: { body: "Oi" } }, { from: "biz", text: { body: "Olá?" } }, { from: "1", text: { body: "Aceita cartão?" } }, { from: "1", text: { body: "ok" } }] },
        { id: "2", messages: [{ from: "2", text: { body: "Sou o fornecedor" } }] },
      ] }] } }] }],
    };
    expect(historyLeadTexts([payload], new Set(["2"]))).toEqual(["Oi", "Aceita cartão?"]);
  });
});

describe("detectEscalation", () => {
  it.each([
    ["Vou no Procon", "complaint"],
    ["Que atendimento péssimo", "complaint"],
    ["quero meu dinheiro de volta", "complaint"],
    ["Me liga pra mim por favor", "asked_human"],
    ["Posso falar com o gerente?", "asked_human"],
    ["não quero falar com robô", "asked_human"],
    ["Vocês ainda têm o Onix prata do anúncio?", "out_of_scope"],
    ["Mas tem ou não tem?", "out_of_scope"],
    ["Fica pronto em quantos dias?", "out_of_scope"],
    ["É pronta entrega?", "out_of_scope"],
    ["Tem SUV automático?", null],
    ["Qual o horário de vocês?", null],
  ])("%s → %s", (text, expected) => {
    expect(detectEscalation(text)).toBe(expected);
  });

  it("only looks at what the lead wrote since the assistant last spoke", () => {
    expect(leadTextSinceAssistant([
      { from: "lead", text: "péssimo" },
      { from: "assistant", text: "?" },
      { from: "lead", text: "SUV" },
      { from: "lead", text: "automático" },
    ])).toBe("SUV\nautomático");
  });
});
