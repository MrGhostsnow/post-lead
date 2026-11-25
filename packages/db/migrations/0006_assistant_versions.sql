CREATE TABLE "assistant_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"settings" jsonb NOT NULL,
	"saved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_versions" ADD CONSTRAINT "assistant_versions_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_versions_operation_idx" ON "assistant_versions" USING btree ("operation_id","created_at");--> statement-breakpoint
alter table assistant_versions enable row level security;
--> statement-breakpoint
create policy assistant_versions_read on assistant_versions for select to authenticated
  using (public.can_see_operation(operation_id));
