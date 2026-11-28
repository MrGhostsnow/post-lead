CREATE TABLE "sandbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number_id" text NOT NULL,
	"to" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"template" text,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_messages_created_idx" ON "sandbox_messages" USING btree ("created_at");--> statement-breakpoint
alter table sandbox_messages enable row level security;
