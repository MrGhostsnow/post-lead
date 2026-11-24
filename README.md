# Post Lead

Keeps leads from going cold. Leads arrive only through the client's WhatsApp
(click-to-WhatsApp ads, bio, organic). When a new number writes, the tool
answers within seconds, tells the right seller, follows up if the lead goes
quiet, and resumes a stalled conversation after Y days unless the seller
cancels. The client keeps answering from the WhatsApp Business app they already
use (coexistence); only the agency uses a web panel.

The product spec lives outside this repo (MVP specification doc).

## Layout

```
apps/
  web/        Next.js: WhatsApp webhook, agency panel, client read-only link
  worker/     Long-running process: applies webhooks, runs scheduled actions
packages/
  core/       Pure logic: phone rules, webhook parsing, cadence, round-robin, API client
  db/         Drizzle schema, Postgres client, SQL migrations (incl. row-level security)
  services/   Use cases shared by web and worker: create lead, process webhook, run actions
docs/
  architecture.md       How a lead moves through the system
  message-templates.md  Drafts of every template to submit to Meta
```

## Getting started

Requirements: Node 20+, a Supabase project, a Meta developer app with the
WhatsApp use case.

1. **Install**

   ```bash
   npm install
   cp .env.example .env
   ```

2. **Database.** Create a Supabase project and fill `DATABASE_URL` (transaction
   pooler, port 6543) and `DATABASE_URL_DIRECT` (port 5432). Then:

   ```bash
   npm run db:migrate
   ```

3. **Meta app and test number.** In the Meta App Dashboard, add the WhatsApp use
   case and open API Setup. Meta creates a test number automatically and lets
   you add up to five recipient numbers. Copy into `.env`:
   - `META_ACCESS_TOKEN` (temporary token is fine for now)
   - `META_APP_SECRET` (App settings > Basic)
   - `TOOL_PHONE_NUMBER_ID` (the test number's phone number id)
   - `META_WEBHOOK_VERIFY_TOKEN` (any random string)

4. **Webhook.** Expose the web app (e.g. `npx ngrok http 3000`) and set the
   callback URL to `https://<host>/api/webhooks/whatsapp` with the verify token
   above. Subscribe to `messages`, and for coexistence also `smb_message_echoes`,
   `history` and `smb_app_state_sync`.

5. **Seed and run**

   ```bash
   npm run seed:dev -w @post-lead/worker -- --phone-number-id <test number id> --seller <your WhatsApp digits>
   npm run dev:web
   npm run dev:worker
   ```

6. **Be a lead.** From a phone registered as a test recipient, write to the
   test number. The first message creates the lead, the tool answers with the
   first reply, and the seller number gets the "lead novo" notice. With the test
   number, follow-ups and resumption use Meta's approved `hello_world` template.

## Tests

```bash
npm test                    # unit tests (core)
TEST_DATABASE_URL=... npm test -w @post-lead/services   # end-to-end flow on a scratch database
```

The end-to-end test needs an empty Postgres with the migrations applied and a
stub `auth.uid()` function (Supabase provides the real one). Never point it at
production.

## Who becomes a lead

When a number with no lead writes to the client's WhatsApp
(`classifyNewNumber` in `packages/core/src/intake.ts`):

| The number | Result |
| --- | --- |
| Was marked "Não é lead" before | Ignored for good, never answered |
| Came from a click-to-WhatsApp ad (referral in the message) | Lead with the campaign; flagged "já era contato" if known |
| Is in the 180-day history, the app's address book, or a chat the client started | Not a lead |
| Anyone else | Lead of unknown origin |

The "lead novo" notice has a "Não é lead" button: it deletes the lead, cancels
everything scheduled for it and ignores the number from then on.

## Activation history

Right after the client connects the number, Meta sends the last 180 days of
chats once (`history` webhook) and the address book (`smb_app_state_sync`).
Only the contact, time and direction of each message are stored
(`history_messages`), never the text. If the client declines to share, a
`history_declined` event is recorded and the panel shows it; the only way to
get the history later is to disconnect and connect the number again.

## Rules the code enforces

- The first reply is free text inside the 24-hour window: no template. Out of
  hours, the out-of-hours message goes instead, so the lead gets one message.
- A lead who answers "SAIR" is never messaged again.
- Outside business hours, the lead gets the operation's out-of-hours message
  (at most once every 12 hours) and the team's reminders wait for the opening.
- Automatic follow-ups stop the moment the lead replies or a person answers.
- A conversation that stalls for Y days is resumed at most twice
  (`MAX_REENGAGEMENTS`). Each time, the owner is warned 2 hours before with
  "Cancelar", "Ganhou" and "Perdeu"; after the last one, the owner is asked for
  the outcome instead.
- After "Ganhou", the owner is asked the sale value by free text; any reply that
  reads as a number ("1500", "R$ 1.500,00") is stored in `sale_value_cents`.
- Outside the 24-hour window only approved templates are sent.
- Webhooks are verified (`X-Hub-Signature-256`), stored once, then processed.
- Server code bypasses row-level security, so every query filters by `operation_id`.

## Agency panel

`/panel` is for the agency team only. Login is a magic link from Supabase Auth;
nobody can sign up from the app.

1. In Supabase: Authentication > URL Configuration, set the Site URL to
   `APP_URL` and add `<APP_URL>/auth/callback` to the redirect URLs.
2. Authentication > Users > Invite user, for each person on the team.
3. Give them access to the agency (creates it the first time):

   ```bash
   npm run add-member -w @post-lead/worker -- --email voce@agencia.com.br --agency "Nome da agência"
   ```

4. Fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `APP_URL` and `CLIENT_LINK_SECRET` in `.env`.

What it does:

- **Clientes**: every client with leads in the last 7 days, open leads and late ones.
- **Novo cliente**: creates the operation, its people, first reply, follow-ups,
  resumption template and business hours.
- **Editar cliente**: the same fields. Removing someone from the people list
  deactivates them (history keeps their name) and hands their open leads to the
  next person in the rotation.
- **Client page**: leads sorted by urgency (late, waiting, ok, closed), origin
  and campaign, sale values, 7-day numbers, people, activation status (history
  received, known contacts, numbers marked "Não é lead"), weekly reports, and
  the client link.
- **Client link** (`/c/<token>`): read-only view for the client, no login.
  "Revogar e gerar outro" invalidates every link sent before.

For local work without Supabase, set `DEV_AUTH_USER_ID` to a user id that is a
member of an agency; login is skipped (never in production builds).

## Weekly report

Every Monday at 08:00 (operation timezone) the worker computes the last 7 days
(leads by source and campaign, share contacted within a minute, median time for
a person to answer, leads left without an answer, outcomes), stores it as a
`weekly_report` event and sends a summary to the managers (or the owner in solo
mode) using the `weekly_report` template.

## Not built yet

- Coexistence onboarding (Embedded Signup): needs Tech Provider approval.
- Editing a client after creation (people, cadence, hours) in the panel.
- Running more than one worker instance (no job lease yet).

`npm audit` reports a moderate esbuild advisory through `drizzle-kit`. It only
affects the local dev tooling, not the deployed app.
