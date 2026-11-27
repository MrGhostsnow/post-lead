/**
 * Talks to the real assistant (Claude API) as scripted leads from different
 * segments and checks the fixed rules on every reply. Nothing is sent on
 * WhatsApp and nothing is written to the database.
 *
 * Usage (from the repo root, with ANTHROPIC_API_KEY in .env):
 *
 *   npm run try-assistant -w @post-lead/worker
 *   npm run try-assistant -w @post-lead/worker -- --only clinica
 */
import { parseArgs } from "node:util";
import {
  applyModelTurn,
  buildSystemPrompt,
  createClaudeAssistant,
  guardReply,
  handoffSummary,
  HANDOFF_LABEL,
  newAssistantState,
  type AssistantSettings,
  type ConversationTurn,
  type HandoffReason,
} from "@post-lead/core";

const { values } = parseArgs({ options: { only: { type: "string" } } });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set in .env");
  process.exit(1);
}
const model = createClaudeAssistant({ apiKey, model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" });

const base = (companyName: string, fields: [string, string][], allowedInfo: string, teamLabel = "vendedor"): AssistantSettings => ({
  enabled: true,
  name: "Bia",
  companyName,
  teamLabel,
  fields: fields.map(([label, question]) => ({
    key: label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    label,
    question,
  })),
  allowedInfo,
  faq: [],
  extraInstructions: "",
  openings: [
    `Oi! Aqui é a Bia, da ${companyName}. Sou a assistente virtual e já vou adiantar teu atendimento.`,
    `Olá! Sou a Bia, assistente virtual da ${companyName}.`,
  ],
});

const veiculos = base(
  "Auto Center Vitória",
  [
    ["Procura", "Qual carro você está procurando?"],
    ["Troca", "Tem algum carro para dar na troca?"],
    ["Financiamento", "Pensa em financiar?"],
    ["Melhor horário", "Qual o melhor horário pro vendedor te chamar?"],
  ],
  "Av. Brumado, 1200. Seg a sex, 8h às 18h; sábado até 12h.",
);
const clinica = base(
  "Clínica Sorriso",
  [
    ["Procedimento", "Qual tratamento você procura?"],
    ["Já é paciente", "Você já é paciente da clínica?"],
    ["Melhor horário", "Qual o melhor horário pra gente te ligar?"],
  ],
  "Rua das Flores, 50. Seg a sex, 8h às 19h. Aceitamos cartão e Pix.",
  "equipe",
);
const imoveis = base(
  "Lar Imóveis",
  [
    ["Busca", "Você procura imóvel para comprar ou alugar?"],
    ["Região", "Qual região você prefere?"],
    ["Quartos", "Quantos quartos você precisa?"],
  ],
  "Atendemos Vitória da Conquista e região.",
  "corretor",
);

type Scenario = {
  id: string;
  settings: AssistantSettings;
  lead: string[];
  /** Handoff reasons that count as a pass; empty means it should still be talking. */
  expect: HandoffReason[];
};

const scenarios: Scenario[] = [
  { id: "veiculos-completo", settings: veiculos, lead: ["Oi, vi o anúncio do Onix", "Um Onix 2022 automático", "Tenho um Gol 2015", "Sim, quero financiar", "Depois das 18h"], expect: ["complete"] },
  { id: "veiculos-preco-2x", settings: veiculos, lead: ["Quanto custa o Onix 2022?", "Mas qual o valor? Só quero saber o preço"], expect: ["price_insist"] },
  { id: "veiculos-estoque", settings: veiculos, lead: ["Vocês ainda têm o Onix prata do anúncio?", "Mas tem ou não tem?"], expect: ["out_of_scope", "asked_human", "price_insist", "guard"] },
  { id: "clinica-atendente", settings: clinica, lead: ["Quero falar com uma pessoa, não com robô"], expect: ["asked_human"] },
  { id: "clinica-reclamacao", settings: clinica, lead: ["Fiz um clareamento aí e ficou horrível, quero resolver isso"], expect: ["complaint", "upset"] },
  { id: "clinica-prazo", settings: clinica, lead: ["Quanto tempo demora um clareamento? Fica pronto em quantos dias?"], expect: ["out_of_scope", "asked_human"] },
  { id: "imoveis-fornecedor", settings: imoveis, lead: ["Boa tarde, sou da gráfica, vim cobrar o boleto das placas"], expect: ["not_lead", "out_of_scope"] },
  { id: "imoveis-completo", settings: imoveis, lead: ["Olá", "Quero alugar", "Bairro Candeias", "Dois quartos"], expect: ["complete"] },
];

let failures = 0;
for (const scenario of scenarios.filter((s) => !values.only || s.id.includes(values.only))) {
  console.log(`\n=== ${scenario.id} ===`);
  let state = newAssistantState(scenario.id);
  const conversation: ConversationTurn[] = [];
  let handoff: HandoffReason | null = null;
  const problems: string[] = [];

  for (const text of scenario.lead) {
    if (handoff) break;
    conversation.push({ from: "lead", text });
    console.log(`  lead: ${text}`);
    const firstReply = !conversation.some((t) => t.from === "assistant");
    const turn = await model.respond({
      system: buildSystemPrompt(scenario.settings, { firstReply }),
      conversation,
      fieldKeys: scenario.settings.fields.map((f) => f.key),
    });
    // The raw model text is checked too: the guard must catch anything that slips.
    const raw = guardReply(turn.reply);
    if (raw) console.log(`  (modelo tentou: "${turn.reply}" → bloqueado: ${raw})`);
    const decision = applyModelTurn(state, turn, scenario.settings, { isFirstReply: firstReply });
    conversation.push({ from: "assistant", text: decision.reply });
    console.log(`  IA:   ${decision.reply.replace(/\n+/g, " / ")}`);
    if (guardReply(decision.reply)) problems.push(`sent a reply breaking a rule: ${decision.reply}`);
    if (decision.reply.length > 600) problems.push("reply longer than 600 characters");
    // After the opening, the first reply must not greet or introduce itself again.
    if (firstReply) {
      const afterOpening = decision.reply.split("\n\n").slice(1).join(" ");
      if (/\b(sou a|aqui é a|assistente virtual)\b/i.test(afterOpening)) problems.push("introduced itself twice");
    }
    if (decision.handoff && decision.reply.trim().endsWith("?")) problems.push("handoff message ends with a question");
    state = decision.state;
    handoff = decision.handoff;
  }

  const first = conversation.find((t) => t.from === "assistant")?.text ?? "";
  if (!/assistente virtual/i.test(first)) problems.push("first reply does not say it is a virtual assistant");
  if (handoff) console.log(`  → passou: ${HANDOFF_LABEL[handoff]} | resumo: ${handoffSummary(state, scenario.settings)}`);
  else console.log("  → ainda conversando");
  if (scenario.expect.length && (!handoff || !scenario.expect.includes(handoff))) {
    problems.push(`expected handoff ${scenario.expect.join(" or ")}, got ${handoff ?? "none"}`);
  }

  if (problems.length) {
    failures++;
    for (const p of problems) console.log(`  ✗ ${p}`);
  } else console.log("  ✓ ok");
}

console.log(failures ? `\n${failures} cenário(s) com problema` : "\nTodos os cenários ok");
process.exit(failures ? 1 : 0);
