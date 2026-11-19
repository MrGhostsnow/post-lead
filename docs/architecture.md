# Architecture

## Pieces

| Piece | Runs on | Does |
| --- | --- | --- |
| `apps/web` | Vercel | Receives webhooks and leads, answers fast, stores them |
| `apps/worker` | Any always-on host (Railway, Fly.io, a VPS) | Processes stored webhooks, runs scheduled actions |
| Postgres | Supabase | All state; row-level security for the panel |
| WhatsApp Cloud API | Meta | Client's number (coexistence) and the tool's own number |

The worker is a separate process because cadences depend on time, not on a
request arriving. Serverless functions are a poor fit for that.

## Two WhatsApp numbers

- **Client number** (one per operation, coexistence): talks to leads. The client
  keeps using the WhatsApp Business app on it.
- **Tool number** (one for the whole product): sends notifications to sellers
  and managers and receives their button taps.

## Lead lifecycle

1. **Lead arrives** via `/api/intake/:operationId` (forms), a Lead Ads
   submission (`/api/webhooks/meta-leads`, fetched from the Graph API by the
   worker) or a first message on the client number. `createLead` assigns an owner by rotation and schedules
   `notify_owner_new_lead` and, with consent, `first_contact`.
2. **First contact** is a template sent from the client number. It schedules the
   follow-ups from the operation's cadence.
3. **Lead replies** (`messages` webhook): pending follow-ups are cancelled, the
   owner is notified, and `owner_reminder` (X min) and `manager_alert` (2X) are
   scheduled.
4. **A person answers** from the app (`smb_message_echoes` webhook): reminders and
   alerts are cancelled; a `stale_check` is scheduled for Y days later.
5. **Stale check**: if the lead never answered, stage becomes `no_reply`.
   Otherwise the owner gets a template with three buttons (won, lost, still
   negotiating).
6. **Button tap** arrives on the tool number and updates the stage.

Every step appends to `events`. The weekly report is computed from `leads`
and stored as an event too, so the panel can show the history.

## Business hours

Optional per operation (`operations.business_hours`). Outside them, a lead's
message gets the out-of-hours text and the owner notification, reminder and
manager alert move to the next opening. The first contact is never delayed:
answering within seconds is the product's promise.

## Scheduling model

`scheduled_actions` is the queue. The worker claims due rows with
`FOR UPDATE SKIP LOCKED`, runs them, and marks them `done`, `failed` (after 3
attempts) or back to `pending` with a delay. Cancelling is a status change.
Each action re-checks the lead before sending, so a cancelled race never
messages a lead who already replied.

## Known gaps

- Meta can deliver webhooks out of order. A lead message older than the last
  answer from the app does not start reminders, and every reminder re-checks
  before sending.

- The `smb_message_echoes` payload shape must be confirmed against Meta's
  coexistence docs before going live (`packages/core/src/webhook.ts`).
- Coexistence does not say which device answered, so per-seller response time
  is not measured.
- Brazilian numbers may arrive with or without the ninth digit; lookups try both
  (`brazilPhoneVariants`).
