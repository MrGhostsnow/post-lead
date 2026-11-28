/**
 * Every message template the tool needs, in one place: created through the
 * Graph API on the tool's WhatsApp account (team notices) and on each client's
 * account (lead messages), and used by the worker to render the same text as
 * free text inside the 24-hour window.
 *
 * Meta rules kept here: the body may not start or end with a variable, every
 * variable needs an example, and quick-reply buttons have at most 25 characters.
 * Seller notices are internal, so Meta classifies them as marketing; utility is
 * rejected for them.
 */

export type TemplateAudience = "team" | "lead";

export type TemplateDefinition = {
  name: string;
  audience: TemplateAudience;
  category: "MARKETING" | "UTILITY";
  language: "pt_BR";
  /** Body with {{1}}, {{2}}, … */
  body: string;
  /** One example per variable, in order. */
  examples: string[];
  /** Quick-reply button titles, in order. */
  buttons?: string[];
};

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  // To sellers and managers, from the tool's number.
  {
    name: "notify_new_lead",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: "Novo lead: {{1}} ({{2}}), {{3}}. Resumo: {{4}}. Abra o WhatsApp Business para continuar.",
    examples: ["Maria", "5577999990000", "anúncio Clareamento", "Procura: clareamento, melhor horário: tarde"],
    buttons: ["Não é lead"],
  },
  {
    name: "notify_lead_replied",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: "O lead {{1}} respondeu. Abra o WhatsApp Business para continuar o atendimento.",
    examples: ["Maria"],
  },
  {
    name: "notify_owner_reminder",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: "O lead {{1}} está esperando resposta há {{2}} minutos. Abra o WhatsApp Business para responder.",
    examples: ["Maria", "5"],
  },
  {
    name: "notify_manager_alert",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: "Atenção: {{1}} está sem resposta. Responsável: {{2}}. Tempo de espera: {{3}} minutos.",
    examples: ["Maria", "Bia", "10"],
  },
  {
    name: "notify_reengagement",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: "A conversa com {{1}} está parada há {{2}} dias. Vou retomar o contato {{3}}. Se você combinou algo com o cliente, toque em Cancelar.",
    examples: ["Maria", "3", "às 16h"],
    buttons: ["Cancelar", "Ganhou", "Perdeu"],
  },
  {
    name: "ask_lead_outcome",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: "Como ficou o atendimento de {{1}}?",
    examples: ["Maria"],
    buttons: ["Ganhou", "Perdeu", "Segue negociando"],
  },
  {
    name: "weekly_report",
    audience: "team",
    category: "MARKETING",
    language: "pt_BR",
    body: [
      "Resumo da semana — {{1}}",
      "Leads recebidos: {{2}}",
      "Contatados em até 1 minuto: {{3}}",
      "Escreveram: {{4}}",
      "Tempo para a equipe responder (mediana): {{5}}",
      "Responderam e ficaram sem resposta da equipe: {{6}}",
      "Vendas fechadas: {{7}}",
      "Boa semana!",
    ].join("\n"),
    examples: ["Clínica Sorriso", "42", "40 (95%)", "30", "4 min", "2", "6 (R$ 9.000)"],
  },

  // To leads, from each client's number.
  {
    name: "follow_up_1",
    audience: "lead",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oi, {{1}}! Ainda posso te ajudar? É só responder esta mensagem que um atendente continua com você.",
    examples: ["Maria"],
  },
  {
    name: "follow_up_2",
    audience: "lead",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oi, {{1}}! Passando para saber se ainda tem interesse. Se preferir não receber mais mensagens, responda SAIR.",
    examples: ["Maria"],
  },
  {
    name: "reengage_1",
    audience: "lead",
    category: "MARKETING",
    language: "pt_BR",
    body: "Oi, {{1}}! Passando para retomar nossa conversa. Ainda posso te ajudar? Se preferir não receber mais mensagens, responda SAIR.",
    examples: ["Maria"],
  },
];

export function templateDefinition(name: string): TemplateDefinition | undefined {
  return TEMPLATE_DEFINITIONS.find((t) => t.name === name);
}

/** The body with its variables filled in, as the person would read it. */
export function renderTemplate(definition: TemplateDefinition, params: string[]): string {
  return definition.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

/** Checks Meta's rules before submitting; returns the problems found. */
export function templateProblems(definition: TemplateDefinition): string[] {
  const problems: string[] = [];
  const body = definition.body.trim();
  const vars = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (/^\{\{\d+\}\}/.test(body)) problems.push("body starts with a variable");
  if (/\{\{\d+\}\}$/.test(body)) problems.push("body ends with a variable");
  vars.forEach((n, i) => {
    if (n !== i + 1) problems.push(`variables must be {{1}}..{{n}} in order (found {{${n}}} at position ${i + 1})`);
  });
  if (vars.length !== definition.examples.length) problems.push(`${vars.length} variables but ${definition.examples.length} examples`);
  for (const title of definition.buttons ?? []) if (title.length > 25) problems.push(`button "${title}" is over 25 characters`);
  if (!/^[a-z0-9_]+$/.test(definition.name)) problems.push("name must be lowercase letters, digits and underscores");
  return problems;
}

/** The request body for POST /{waba-id}/message_templates. */
export function templateCreatePayload(definition: TemplateDefinition) {
  const components: Record<string, unknown>[] = [
    {
      type: "BODY",
      text: definition.body,
      ...(definition.examples.length ? { example: { body_text: [definition.examples] } } : {}),
    },
  ];
  if (definition.buttons?.length) {
    components.push({ type: "BUTTONS", buttons: definition.buttons.map((text) => ({ type: "QUICK_REPLY", text })) });
  }
  return { name: definition.name, language: definition.language, category: definition.category, components };
}

export type TemplateStatus = { name: string; language: string; status: string; category?: string };

/**
 * Template management on a WhatsApp Business Account through the Graph API.
 * Separate from the message client: it needs the account id, not a number.
 */
export function createTemplateManager(options: { accessToken: string; apiVersion: string; fetchImpl?: typeof fetch }) {
  const doFetch = options.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${options.apiVersion}`;
  const headers = { Authorization: `Bearer ${options.accessToken}`, "Content-Type": "application/json" };

  async function call<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(url, { ...init, headers });
    const json = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !json) throw new Error(json?.error?.message ?? `Graph API error ${response.status}`);
    return json;
  }

  return {
    async list(wabaId: string): Promise<TemplateStatus[]> {
      const out: TemplateStatus[] = [];
      let url: string | undefined = `${base}/${wabaId}/message_templates?fields=name,language,status,category&limit=200`;
      while (url) {
        const page: { data?: TemplateStatus[]; paging?: { next?: string } } = await call(url);
        out.push(...(page.data ?? []));
        url = page.paging?.next;
      }
      return out;
    },

    async create(wabaId: string, definition: TemplateDefinition): Promise<{ id: string; status: string }> {
      return call(`${base}/${wabaId}/message_templates`, {
        method: "POST",
        body: JSON.stringify(templateCreatePayload(definition)),
      });
    },
  };
}

export type TemplateManager = ReturnType<typeof createTemplateManager>;

export type TemplateSyncResult = { name: string; result: "exists" | "created" | "failed"; status?: string; error?: string };

/**
 * Creates the templates of the given audiences that the account does not have
 * yet. Existing ones are left alone, whatever their status, so it is safe to
 * run on every deploy or every new client.
 */
export async function syncTemplates(
  manager: TemplateManager,
  wabaId: string,
  audiences: TemplateAudience[],
): Promise<TemplateSyncResult[]> {
  const existing = await manager.list(wabaId);
  const results: TemplateSyncResult[] = [];
  for (const definition of TEMPLATE_DEFINITIONS.filter((t) => audiences.includes(t.audience))) {
    const found = existing.find((t) => t.name === definition.name && t.language === definition.language);
    if (found) {
      results.push({ name: definition.name, result: "exists", status: found.status });
      continue;
    }
    try {
      const created = await manager.create(wabaId, definition);
      results.push({ name: definition.name, result: "created", status: created.status });
    } catch (error) {
      results.push({ name: definition.name, result: "failed", error: (error as Error).message });
    }
  }
  return results;
}
