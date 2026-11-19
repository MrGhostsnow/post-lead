/**
 * Cadence rules: when the tool contacts a lead on its own, and when it stops.
 * Pure functions only; the worker turns the plans into scheduled actions.
 */

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type FollowUpStep = {
  /** Minutes after the first contact. */
  afterMinutes: number;
  /** Name of an approved message template. */
  template: string;
};

export type CadenceConfig = {
  firstContactTemplate: string;
  followUps: FollowUpStep[];
  /** X: minutes the business has to answer a lead that replied. */
  firstResponseMinutes: number;
  /** Y: days without any message before asking the owner for the outcome. */
  staleDays: number;
};

export type PlannedAction =
  | { kind: "follow_up"; step: number; template: string; runAt: Date }
  | { kind: "owner_reminder"; runAt: Date }
  | { kind: "manager_alert"; runAt: Date }
  | { kind: "stale_check"; runAt: Date };

const minutes = (n: number) => n * 60 * 1000;
const days = (n: number) => n * 24 * 60 * 60 * 1000;

/** Follow-ups scheduled right after the first automatic contact. */
export function planFollowUps(firstContactAt: Date, config: CadenceConfig): PlannedAction[] {
  return config.followUps.map((step, index) => ({
    kind: "follow_up" as const,
    step: index + 1,
    template: step.template,
    runAt: new Date(firstContactAt.getTime() + minutes(step.afterMinutes)),
  }));
}

/**
 * When the lead replies, the business has X minutes. The owner gets a reminder
 * at X and the manager an alert at 2X, unless someone answers first.
 */
export function planResponseEscalation(leadRepliedAt: Date, config: CadenceConfig): PlannedAction[] {
  const x = minutes(config.firstResponseMinutes);
  return [
    { kind: "owner_reminder", runAt: new Date(leadRepliedAt.getTime() + x) },
    { kind: "manager_alert", runAt: new Date(leadRepliedAt.getTime() + 2 * x) },
  ];
}

/** After any message, check again in Y days whether the conversation stalled. */
export function planStaleCheck(lastMessageAt: Date, config: CadenceConfig): PlannedAction {
  return { kind: "stale_check", runAt: new Date(lastMessageAt.getTime() + days(config.staleDays)) };
}

/**
 * Free-form text is only allowed within 24 hours of the lead's last message.
 * Outside the window, only approved templates can be sent.
 */
export function canSendFreeform(lastInboundAt: Date | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type BusinessHours = {
  timezone: string;
  /** "HH:MM" start and end per day; a missing day means closed. */
  days: Partial<Record<Weekday, [string, string]>>;
};

const WEEKDAYS: Record<string, Weekday> = {
  Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun",
};

export function isWithinBusinessHours(at: Date, hours: BusinessHours): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAYS[get("weekday")];
  if (!weekday) return false;

  const range = hours.days[weekday];
  if (!range) return false;

  const current = `${get("hour")}:${get("minute")}`;
  const [start, end] = range;
  return current >= start && current < end;
}
