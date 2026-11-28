ALTER TABLE "operations" ADD COLUMN "access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "coexistence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "whatsapp_connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operations" ADD COLUMN "history_sync_requested_at" timestamp with time zone;