import "server-only";
import { DEFAULT_ASSISTANT, type AssistantSettings } from "@post-lead/core";

/** "Procura | O que você procura?" → field with a key derived from the label. */
function keyOf(label: string) {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

export type AssistantForm = { ok: true; settings: AssistantSettings } | { ok: false; message: string };

export function parseAssistantForm(formData: FormData): AssistantForm {
  const value = (k: string) => String(formData.get(k) ?? "").trim();

  const fields: AssistantSettings["fields"] = [];
  for (const line of lines(value("fields"))) {
    const [label, question] = line.split("|").map((p) => p.trim());
    if (!label || !question) return { ok: false, message: `Dado inválido: "${line}". Use "Rótulo | Pergunta".` };
    const key = keyOf(label);
    if (!key || fields.some((f) => f.key === key)) return { ok: false, message: `Rótulo repetido ou inválido: "${label}".` };
    fields.push({ key, label, question });
  }
  if (fields.length === 0) return { ok: false, message: "Configure pelo menos um dado para a IA coletar." };
  if (fields.length > 8) return { ok: false, message: "No máximo 8 dados: a conversa precisa ser curta." };

  const faq: AssistantSettings["faq"] = [];
  for (const line of lines(value("faq"))) {
    const [question, answer] = line.split("|").map((p) => p.trim());
    if (!question || !answer) return { ok: false, message: `Pergunta frequente inválida: "${line}". Use "Pergunta | Resposta".` };
    faq.push({ question, answer });
  }

  const companyName = value("companyName");
  if (!companyName) return { ok: false, message: "Informe o nome da empresa como a IA deve falar." };
  const openingA = value("openingA");
  const openingB = value("openingB") || openingA;
  if (!openingA) return { ok: false, message: "Escreva pelo menos a abertura A." };

  return {
    ok: true,
    settings: {
      enabled: formData.get("enabled") === "on",
      name: value("name").slice(0, 40),
      companyName: companyName.slice(0, 120),
      teamLabel: (value("teamLabel") || "vendedor").slice(0, 30),
      fields,
      allowedInfo: value("allowedInfo").slice(0, 2000),
      faq,
      extraInstructions: value("extraInstructions").slice(0, 2000),
      openings: [openingA.slice(0, 400), openingB.slice(0, 400)],
    },
  };
}

export function assistantFormValues(settings: AssistantSettings | null, operationName: string): Record<string, string> {
  const s = settings ?? {
    ...DEFAULT_ASSISTANT,
    companyName: operationName,
    openings: [
      `Oi! Aqui é a assistente virtual da ${operationName} e já vou adiantar teu atendimento.`,
      `Olá! Sou a assistente virtual da ${operationName}. Vou te fazer umas perguntas rápidas para o vendedor já chegar sabendo o que você precisa.`,
    ] as [string, string],
  };
  return {
    enabled: s.enabled ? "on" : "",
    name: s.name,
    companyName: s.companyName,
    teamLabel: s.teamLabel,
    fields: s.fields.map((f) => `${f.label} | ${f.question}`).join("\n"),
    allowedInfo: s.allowedInfo,
    faq: s.faq.map((f) => `${f.question} | ${f.answer}`).join("\n"),
    extraInstructions: s.extraInstructions,
    openingA: s.openings[0],
    openingB: s.openings[1],
  };
}
