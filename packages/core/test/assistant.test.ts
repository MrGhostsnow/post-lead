import { describe, expect, it } from "vitest";
import {
  applyModelTurn,
  buildSystemPrompt,
  DEFAULT_ASSISTANT,
  guardReply,
  handoffSummary,
  HANDOFF_REPLY,
  newAssistantState,
  parseModelTurn,
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

  it("follows the model when it asks for a person", () => {
    const d = applyModelTurn(state(), turn({ reply: "Claro, já chamo o vendedor!", handoff: "asked_human" }), settings, { isFirstReply: false });
    expect(d).toMatchObject({ handoff: "asked_human", reply: "Claro, já chamo o vendedor!" });
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
