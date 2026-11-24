ALTER TYPE "public"."action_kind" ADD VALUE 'reengagement';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'ask_sale_value';--> statement-breakpoint
ALTER TYPE "public"."lead_source" ADD VALUE 'whatsapp_ad';--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"in_address_book" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone,
	"ignored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"contact_phone" text NOT NULL,
	"wa_message_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "history_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
ALTER TABLE "operations" DROP CONSTRAINT "operations_meta_page_id_unique";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ctwa_clid" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "known_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sale_value_cents" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "reengagements" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "pending_sale_value_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_messages" ADD CONSTRAINT "history_messages_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_operation_phone_idx" ON "contacts" USING btree ("operation_id","phone");--> statement-breakpoint
CREATE INDEX "history_messages_operation_idx" ON "history_messages" USING btree ("operation_id","sent_at");--> statement-breakpoint
ALTER TABLE "operations" DROP COLUMN "meta_page_id";--> statement-breakpoint
ALTER TABLE "operations" DROP COLUMN "lead_ads_disclaimer_consent";--> statement-breakpoint
ALTER TABLE "operations" DROP COLUMN "intake_key_hash";--> statement-breakpoint
alter table contacts enable row level security;
--> statement-breakpoint
alter table history_messages enable row level security;
--> statement-breakpoint
create policy contacts_read on contacts for select to authenticated
  using (public.can_see_operation(operation_id));
--> statement-breakpoint
create policy history_messages_read on history_messages for select to authenticated
  using (public.can_see_operation(operation_id));
