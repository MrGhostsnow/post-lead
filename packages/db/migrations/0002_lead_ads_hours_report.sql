ALTER TYPE "public"."action_kind" ADD VALUE 'out_of_hours_reply';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'weekly_report';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_out_of_hours_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "meta_page_id" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "lead_ads_disclaimer_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_meta_page_id_unique" UNIQUE("meta_page_id");