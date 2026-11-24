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
  followUps: FollowUpStep[];
  /** X: minutes the business has to answer a lead that replied. */
  firstResponseMinutes: number;
  /** Y: days without any message before the conversation counts as stalled. */
  staleDays: number;
};

export type PlannedAction =
  | { kind: "follow_up"; step: number; template: string; runAt: Date }
  | { kind: "owner_reminder"; runAt: Date }
  | { kind: "manager_alert"; runAt: Date }
  | { kind: "stale_check"; runAt: Date };

const minutes = (n: number) => n * 60 * 1000;
const days = (n: number) => n * 24 * 60 * 60 * 1000;

/** Follow-ups scheduled right after the automatic first reply. */
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
 * With business hours set, the clock only starts at the next opening, so
 * nobody is woken up at night for a lead that wrote at 2 a.m.
 */
export function planResponseEscalation(
  leadRepliedAt: Date,
  config: CadenceConfig,
  hours?: BusinessHours | null,
): PlannedAction[] {
  const x = minutes(config.firstResponseMinutes);
  const start = (hours && nextOpening(leadRepliedAt, hours)) || leadRepliedAt;
  return [
    { kind: "owner_reminder", runAt: new Date(start.getTime() + x) },
    { kind: "manager_alert", runAt: new Date(start.getTime() + 2 * x) },
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

const STEP_MS = 15 * 60 * 1000;
const SEARCH_LIMIT_MS = 8 * 24 * 60 * 60 * 1000;

/**
 * The given instant if it is inside business hours, otherwise the start of
 * the next opening (to 15-minute precision). Null when the schedule has no
 * open slot in the next 8 days.
 */
export function nextOpening(at: Date, hours: BusinessHours): Date | null {
  if (isWithinBusinessHours(at, hours)) return at;

  let t = Math.ceil(at.getTime() / STEP_MS) * STEP_MS;
  const limit = at.getTime() + SEARCH_LIMIT_MS;
  for (; t <= limit; t += STEP_MS) {
    const candidate = new Date(t);
    if (isWithinBusinessHours(candidate, hours)) return candidate;
  }
  return null;
}

/** Next Monday 08:00 in the given timezone, strictly after `after`. */
export function nextWeeklyReportAt(after: Date, timezone: string): Date {
  const window: BusinessHours = { timezone, days: { mon: ["08:00", "08:15"] } };
  // Start after the current window so a run at 08:05 does not schedule 08:05 again.
  const from = new Date(after.getTime() + STEP_MS);
  return nextOpening(from, window) ?? new Date(after.getTime() + 7 * 24 * 60 * 60 * 1000);
}
