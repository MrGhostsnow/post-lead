# Post Lead

Keeps leads from going cold. When a lead arrives, the tool sends the first
WhatsApp message within seconds, follows up while nobody answers, and warns the
team only when a person is needed. The client keeps answering from the
WhatsApp Business app they already use (coexistence); only the agency uses a
web panel.

The product spec lives outside this repo (MVP specification doc).

## Layout

```
apps/
  web/        Next.js: webhooks, lead intake API, agency panel, client read-only link
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
   above. Subscribe to `messages` (and later `smb_message_echoes`).

   For Lead Ads, add a second webhook under Webhooks > Page with
   `https://<host>/api/webhooks/meta-leads`, subscribe to `leadgen`, set
   `operations.meta_page_id` for the client and fill `META_LEADS_ACCESS_TOKEN`
   (agency system user with `leads_retrieval` on the client page).

5. **Seed and run**

   ```bash
   npm run seed:dev -w @post-lead/worker -- --phone-number-id <test number id> --seller <your WhatsApp digits>
   npm run dev:web
   npm run dev:worker
   ```

6. **Send a lead**

   ```bash
   curl -X POST http://localhost:3000/api/intake/<operation id> \
     -H "x-intake-key: <key printed by the seed>" \
     -H "content-type: application/json" \
     -d '{"name":"Ana","phone":"77 99999-8888","whatsappConsent":true}'
   ```

   The phone must be one of the test recipients. With the test number, the seed
   uses Meta's approved `hello_world` template as the first contact.

## Tests

```bash
npm test                    # unit tests (core)
TEST_DATABASE_URL=... npm test -w @post-lead/services   # end-to-end flow on a scratch database
```

The end-to-end test needs an empty Postgres with the migrations applied and a
stub `auth.uid()` function (Supabase provides the real one). Never point it at
production.

## Rules the code enforces

- No automatic message without `whatsappConsent` (or the lead writing first).
  Lead Ads consent comes from a `whatsapp_consent` question on the form, or from
  `lead_ads_disclaimer_consent` when the form text says the lead will be
  contacted on WhatsApp.
- A lead who answers "SAIR" is never messaged again.
- Outside business hours, the lead gets the operation's out-of-hours message
  (at most once every 12 hours) and the team's reminders wait for the opening.
- Automatic follow-ups stop the moment the lead replies or a person answers.
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
- **Novo cliente**: creates the operation, its people, cadence and business hours,
  and shows the intake key once.
- **Client page**: leads sorted by urgency (late, waiting, ok, closed), 7-day
  numbers, people, weekly reports, a new intake key, and the client link.
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
