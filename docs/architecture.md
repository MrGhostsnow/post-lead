# Architecture

## Pieces

| Piece | Runs on | Does |
| --- | --- | --- |
| `apps/web` | Vercel | Receives WhatsApp webhooks, answers fast, stores them; agency panel |
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

Leads come only from the client's WhatsApp: the lead always writes first.

1. **A new number writes** (`messages` webhook). `classifyNewNumber` decides:
   ignored number, known contact (history, address book or a chat the client
   started) or a lead from an ad (`referral` in the message) or of unknown
   origin. A lead gets an owner by rotation; `first_contact`,
   `notify_owner_new_lead` (with a "Não é lead" button), `owner_reminder` (X min)
   and `manager_alert` (2X) are scheduled.
2. **First reply** is free text from the client number, inside the 24-hour
   window, or the out-of-hours message when closed. It schedules the follow-ups
   (templates) for a lead who goes quiet.
3. **Lead writes again**: pending follow-ups and resumptions are cancelled, the
   owner is notified, reminders restart unless already running.
4. **A person answers** from the app (`smb_message_echoes`): reminders, alerts
   and follow-ups are cancelled; a `stale_check` is scheduled for Y days later.
5. **Stale check**: a lead who never wrote again and was never answered becomes
   `no_reply`. A conversation that stalled midway gets a resumption: the owner is
   warned with "Cancelar", "Ganhou" and "Perdeu", and `reengagement` sends the
   resumption template 2 hours later unless cancelled (at most twice per lead).
   After that, the owner is asked for the outcome.
6. **Button taps** arrive on the tool number: won (then the sale value is asked
   by free text), lost, still negotiating, cancel resumption, or not a lead
   (deletes the lead and ignores the number for good).

Every step appends to `events`. The weekly report is computed from `leads`
and stored as an event too, so the panel can show the history.

## Business hours

Optional per operation (`operations.business_hours`). Outside them, the first
reply is the out-of-hours text, and the owner notification, reminder, manager
alert and resumptions move to the next opening. The first reply is never
delayed: answering within seconds is the product's promise.

## Activation data

At activation Meta sends, once, 180 days of chats (`history`) and the app's
address book (`smb_app_state_sync`). The history is stored as time and
direction only (`history_messages`) and both feed `contacts`, which decides who
is not a new lead. Meta requires the sync to be requested within 24 hours of
onboarding (still to build, with Embedded Signup).

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

- The `smb_message_echoes` and `history` payload shapes must be confirmed
  against live payloads before going live (`packages/core/src/webhook.ts`).
- The history sync request and Embedded Signup are not built yet; they depend
  on the Tech Provider approval.
- Coexistence does not say which device answered, so per-seller response time
  is not measured.
- Brazilian numbers may arrive with or without the ninth digit; lookups try both
  (`brazilPhoneVariants`).
