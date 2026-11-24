import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Every row that belongs to a client carries operation_id. An operation is one
 * client of an agency. Row-level security (see migrations/*_rls.sql) limits the
 * agency panel to its own operations; the worker and webhooks use the service
 * connection and must always filter by operation_id themselves.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const operationMode = pgEnum("operation_mode", ["team", "solo"]);
export const personRole = pgEnum("person_role", ["seller", "manager"]);
export const leadSource = pgEnum("lead_source", ["form", "meta_lead_ads", "whatsapp"]);
export const leadStage = pgEnum("lead_stage", ["new", "in_progress", "won", "lost", "no_reply"]);
export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageSender = pgEnum("message_sender", ["lead", "automation", "business_app"]);
export const actionKind = pgEnum("action_kind", [
  "first_contact",
  "follow_up",
  "notify_owner_new_lead",
  "notify_owner_reply",
  "owner_reminder",
  "manager_alert",
  "stale_check",
  "out_of_hours_reply",
  "weekly_report",
]);
export const actionStatus = pgEnum("action_status", ["pending", "running", "done", "cancelled", "failed"]);

export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

/** Agency staff who log in to the panel (Supabase Auth users). */
export const agencyMembers = pgTable(
  "agency_members",
  {
    agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agency_members_pk").on(t.agencyId, t.userId)],
);

export type CadenceSettings = {
  firstContactTemplate: string;
  followUps: { afterMinutes: number; template: string }[];
  /**
   * Free text sent when a lead writes outside business hours. It is always a
   * reply to the lead's own message, so no template is needed.
   */
  outOfHoursMessage?: string;
  /** Template language; defaults to "pt_BR". */
  languageCode?: string;
  /** Pass the lead's first name as {{1}}. Defaults to true. */
  firstNameParam?: boolean;
};

export type BusinessHoursSettings = {
  timezone: string;
  days: Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", [string, string]>>;
};

export const operations = pgTable("operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  agencyId: uuid("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mode: operationMode("mode").notNull().default("team"),
  /** Client's own number, connected through coexistence. */
  wabaId: text("waba_id"),
  phoneNumberId: text("phone_number_id").unique(),
  displayPhone: text("display_phone"),
  /** Facebook Page whose Lead Ads forms feed this operation. */
  metaPageId: text("meta_page_id").unique(),
  /**
   * Set to true only when the Lead Ads form shows explicit text that the lead
   * will be contacted on WhatsApp. A "whatsapp_consent" question overrides it.
   */
  leadAdsDisclaimerConsent: boolean("lead_ads_disclaimer_consent").notNull().default(false),
  /** sha256 of the key forms use to post leads to /api/intake/:operationId. */
  intakeKeyHash: text("intake_key_hash"),
  firstResponseMinutes: integer("first_response_minutes").notNull().default(5),
  staleDays: integer("stale_days").notNull().default(3),
  cadence: jsonb("cadence").$type<CadenceSettings>().notNull(),
  businessHours: jsonb("business_hours").$type<BusinessHoursSettings>(),
  /** Bump to revoke every client read-only link issued for this operation. */
  clientLinkVersion: integer("client_link_version").notNull().default(1),
  /** In solo mode, optionally warn the agency when the owner does not act. */
  notifyAgencyInSoloMode: boolean("notify_agency_in_solo_mode").notNull().default(false),
  ...timestamps,
});

/** Sellers and managers. They do not log in; they talk to the tool over WhatsApp. */
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    whatsappNumber: text("whatsapp_number").notNull(),
    role: personRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("people_operation_idx").on(t.operationId)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),
    source: leadSource("source").notNull(),
    campaign: text("campaign"),
    ad: text("ad"),
    utm: jsonb("utm").$type<Record<string, string>>(),
    /** Opt-in for WhatsApp contact. Automation never messages a lead without it. */
    whatsappConsent: boolean("whatsapp_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    stage: leadStage("stage").notNull().default("new"),
    lostReason: text("lost_reason"),
    ownerPersonId: uuid("owner_person_id").references(() => people.id, { onDelete: "set null" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
    firstLeadReplyAt: timestamp("first_lead_reply_at", { withTimezone: true }),
    firstBusinessReplyAt: timestamp("first_business_reply_at", { withTimezone: true }),
    /** Last message a person sent from the WhatsApp Business app (not automation). */
    lastBusinessReplyAt: timestamp("last_business_reply_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastOutOfHoursReplyAt: timestamp("last_out_of_hours_reply_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leads_operation_phone_idx").on(t.operationId, t.contactPhone),
    index("leads_operation_stage_idx").on(t.operationId, t.stage),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    waMessageId: text("wa_message_id").notNull().unique(),
    direction: messageDirection("direction").notNull(),
    sender: messageSender("sender").notNull(),
    type: text("type").notNull(),
    body: text("body"),
    status: text("status"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_lead_idx").on(t.leadId, t.sentAt)],
);

/** Work the worker must do at a given time. Cancelling is a status change. */
export const scheduledActions = pgTable(
  "scheduled_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    kind: actionKind("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    status: actionStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [
    index("scheduled_actions_due_idx").on(t.status, t.runAt),
    index("scheduled_actions_lead_idx").on(t.leadId, t.status),
  ],
);

/** Append-only history. The weekly report is computed from here. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id").notNull().references(() => operations.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_operation_created_idx").on(t.operationId, t.createdAt)],
);

/** Raw webhooks, stored before processing so nothing is lost or handled twice. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("webhook_events_pending_idx").on(t.processedAt, t.receivedAt)],
);
