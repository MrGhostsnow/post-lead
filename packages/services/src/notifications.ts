/**
 * Templates sent from the tool's own number to sellers and managers.
 * Each one must be created and approved in WhatsApp Manager under these names,
 * in Portuguese (pt_BR), with the body variables and buttons listed here.
 */
export const NOTIFICATION_TEMPLATES = {
  /**
   * {{1}} lead name, {{2}} lead phone, {{3}} origin ("anúncio Clareamento",
   * "origem não identificada"), {{4}} assistant summary or "sem pré-atendimento".
   * One quick-reply button: "Não é lead".
   */
  newLead: "notify_new_lead",
  /** {{1}} lead name. */
  leadReplied: "notify_lead_replied",
  /** {{1}} lead name, {{2}} minutes waiting. */
  ownerReminder: "notify_owner_reminder",
  /** {{1}} lead name, {{2}} owner name, {{3}} minutes waiting. */
  managerAlert: "notify_manager_alert",
  /**
   * {{1}} lead name, {{2}} days stalled, {{3}} when the message goes out
   * ("hoje às 15h"). Three quick-reply buttons, in this order:
   * "Cancelar", "Ganhou", "Perdeu".
   */
  reengagementNotice: "notify_reengagement",
  /**
   * {{1}} lead name. Three quick-reply buttons, in this order:
   * "Ganhou", "Perdeu", "Segue negociando".
   */
  askOutcome: "ask_lead_outcome",
  /**
   * {{1}} client name, {{2}} leads received, {{3}} % contacted within 1 minute,
   * {{4}} leads that wrote, {{5}} median minutes for a person to answer,
   * {{6}} wrote but nobody answered, {{7}} won.
   */
  weeklyReport: "weekly_report",
} as const;

export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[keyof typeof NOTIFICATION_TEMPLATES];

/** Button titles, in the same order as the template's quick-reply buttons. */
export const NOTIFICATION_BUTTON_TITLES: Partial<Record<NotificationTemplate, string[]>> = {
  notify_new_lead: ["Não é lead"],
  notify_reengagement: ["Cancelar", "Ganhou", "Perdeu"],
  ask_lead_outcome: ["Ganhou", "Perdeu", "Segue negociando"],
};

/**
 * The same notice as free text, used when the person wrote to the tool's
 * number in the last 24 hours. Keep in step with the approved templates.
 */
export function notificationText(template: NotificationTemplate, p: string[]): string {
  switch (template) {
    case "notify_new_lead":
      return `Novo lead: ${p[0]} (${p[1]}), ${p[2]}. Resumo: ${p[3]}. Abra o WhatsApp Business para continuar.`;
    case "notify_lead_replied":
      return `${p[0]} respondeu. Abra o WhatsApp Business para continuar o atendimento.`;
    case "notify_owner_reminder":
      return `${p[0]} está esperando resposta há ${p[1]} minutos.`;
    case "notify_manager_alert":
      return `Atenção: ${p[0]} está sem resposta. Responsável: ${p[1]}. Tempo de espera: ${p[2]} minutos.`;
    case "notify_reengagement":
      return `A conversa com ${p[0]} está parada há ${p[1]} dias. Vou retomar o contato ${p[2]}. Se você combinou algo com o cliente, toque em Cancelar.`;
    case "ask_lead_outcome":
      return `Como ficou o atendimento de ${p[0]}?`;
    case "weekly_report":
      return [
        `Resumo da semana — ${p[0]}`,
        `Leads recebidos: ${p[1]}`,
        `Contatados em até 1 minuto: ${p[2]}`,
        `Escreveram: ${p[3]}`,
        `Tempo para a equipe responder (mediana): ${p[4]}`,
        `Responderam e ficaram sem resposta da equipe: ${p[5]}`,
        `Vendas fechadas: ${p[6]}`,
      ].join("\n");
  }
}

/** What a button in a notification does. The lead id travels in the payload. */
export type ButtonAction = "won" | "lost" | "open" | "not_lead" | "cancel_reengagement";

const ACTIONS: ButtonAction[] = ["won", "lost", "open", "not_lead", "cancel_reengagement"];
const PREFIX = "pl";

export function buttonPayload(action: ButtonAction, leadId: string): string {
  return `${PREFIX}:${action}:${leadId}`;
}

export function parseButtonPayload(payload: string): { action: ButtonAction; leadId: string } | null {
  const [prefix, action, leadId] = payload.split(":");
  if (prefix !== PREFIX || !leadId || !ACTIONS.includes(action as ButtonAction)) return null;
  return { action: action as ButtonAction, leadId };
}
