import { renderTemplate, TEMPLATE_DEFINITIONS, templateDefinition } from "@post-lead/core";
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
export const NOTIFICATION_BUTTON_TITLES: Partial<Record<NotificationTemplate, string[]>> = Object.fromEntries(
  TEMPLATE_DEFINITIONS.filter((t) => t.buttons?.length).map((t) => [t.name, t.buttons!]),
);

/**
 * The same notice as free text, used when the person wrote to the tool's
 * number in the last 24 hours. Rendered from the template definition, so it
 * always matches what Meta approved.
 */
export function notificationText(template: NotificationTemplate, p: string[]): string {
  const definition = templateDefinition(template);
  if (!definition) throw new Error(`No template definition for ${template}`);
  return renderTemplate(definition, p);
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
