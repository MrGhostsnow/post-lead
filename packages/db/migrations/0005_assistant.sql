ALTER TYPE "public"."action_kind" ADD VALUE 'assistant_reply';--> statement-breakpoint
ALTER TYPE "public"."action_kind" ADD VALUE 'assistant_deadline';--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "assistant_state" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "handed_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "handoff_summary" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "assistant" jsonb;