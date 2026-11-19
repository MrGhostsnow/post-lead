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
  web/        Next.js: WhatsApp webhook, lead intake API, agency panel (to do)
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
- Automatic follow-ups stop the moment the lead replies or a person answers.
- Outside the 24-hour window only approved templates are sent.
- Webhooks are verified (`X-Hub-Signature-256`), stored once, then processed.
- Server code bypasses row-level security, so every query filters by `operation_id`.

## Not built yet

- Coexistence onboarding (Embedded Signup): needs Tech Provider approval.
- Meta Lead Ads intake.
- Out-of-hours reply and weekly report.
- Agency panel and the manager's read-only link.
- Running more than one worker instance (no job lease yet).

`npm audit` reports a moderate esbuild advisory through `drizzle-kit`. It only
affects the local dev tooling, not the deployed app.
