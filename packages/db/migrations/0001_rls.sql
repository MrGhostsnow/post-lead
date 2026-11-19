-- Row-level security for the agency panel (Supabase Auth).
-- The worker and webhooks connect with the service credentials and bypass RLS.
-- No policy here allows writes from the browser; writes go through server code.

create or replace function public.is_agency_member(target_agency uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from agency_members m
     where m.agency_id = target_agency and m.user_id = auth.uid()
  );
$$;
--> statement-breakpoint

create or replace function public.can_see_operation(target_operation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from operations o
      join agency_members m on m.agency_id = o.agency_id
     where o.id = target_operation and m.user_id = auth.uid()
  );
$$;
--> statement-breakpoint

alter table agencies enable row level security;
--> statement-breakpoint
alter table agency_members enable row level security;
--> statement-breakpoint
alter table operations enable row level security;
--> statement-breakpoint
alter table people enable row level security;
--> statement-breakpoint
alter table leads enable row level security;
--> statement-breakpoint
alter table messages enable row level security;
--> statement-breakpoint
alter table scheduled_actions enable row level security;
--> statement-breakpoint
alter table events enable row level security;
--> statement-breakpoint
-- No policies: only the service connection can read raw webhooks.
alter table webhook_events enable row level security;
--> statement-breakpoint

create policy agencies_read on agencies for select to authenticated
  using (public.is_agency_member(id));
--> statement-breakpoint
create policy agency_members_read on agency_members for select to authenticated
  using (public.is_agency_member(agency_id));
--> statement-breakpoint
create policy operations_read on operations for select to authenticated
  using (public.is_agency_member(agency_id));
--> statement-breakpoint
create policy people_read on people for select to authenticated
  using (public.can_see_operation(operation_id));
--> statement-breakpoint
create policy leads_read on leads for select to authenticated
  using (public.can_see_operation(operation_id));
--> statement-breakpoint
create policy messages_read on messages for select to authenticated
  using (public.can_see_operation(operation_id));
--> statement-breakpoint
create policy scheduled_actions_read on scheduled_actions for select to authenticated
  using (public.can_see_operation(operation_id));
--> statement-breakpoint
create policy events_read on events for select to authenticated
  using (public.can_see_operation(operation_id));
