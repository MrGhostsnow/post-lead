# Deploy

Three services. Each one gets its own variables; nothing secret goes in the repo.

| Piece | Service | What runs there |
| --- | --- | --- |
| Database and login | Supabase | Postgres and Auth (magic link) |
| Worker | Railway | `Dockerfile` at the repo root: applies migrations, then runs the worker |
| Panel and webhooks | Vercel | `apps/web` (Next.js) |

Do them in this order: the worker creates the tables, and the panel needs them.

## 1. Supabase

1. Create a project. Region: **South America (São Paulo)**. Keep the database
   password in a password manager.
2. **Connect** (top bar) > **Connection string**:
   - **Transaction pooler** (port 6543) → `DATABASE_URL`
   - **Session pooler** (port 5432) → `DATABASE_URL_DIRECT`
   Do not use the "Direct connection" host: it is IPv6-only.
3. **Project Settings > API**: project URL → `NEXT_PUBLIC_SUPABASE_URL`,
   publishable key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. **Authentication > Sign In / Providers**: turn off "Allow new users to sign
   up". Only invited people get in.
5. **Authentication > URL Configuration**: Site URL = the panel address
   (`APP_URL`), and add `<APP_URL>/auth/callback` to the redirect URLs. Do this
   after step 3 gives you the address.

## 2. Railway (worker)

1. New project > **Deploy from GitHub repo** > `post-lead`. Railway finds the
   `Dockerfile` and builds it.
2. **Variables** (service > Variables):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction pooler |
   | `DATABASE_URL_DIRECT` | Supabase session pooler |
   | `GRAPH_API_VERSION` | e.g. `v24.0` (App Dashboard > WhatsApp > API Setup) |
   | `META_ACCESS_TOKEN` | System user token (permanent), not the 24-hour test token |
   | `TOOL_PHONE_NUMBER_ID` | Phone number id that sends notices to sellers |
   | `ANTHROPIC_API_KEY` | Claude API key (optional: without it, the fixed reply is used) |
   | `ANTHROPIC_MODEL` | `claude-haiku-5-5` |

3. **Settings > Deploy**: one replica only (two workers would compete for the
   same jobs), restart policy "On failure".
4. The deploy log should end with `[migrate] database is up to date` and
   `[worker] started`.

## 3. Vercel (panel and webhooks)

1. Add New > Project > import `post-lead`. **Root Directory: `apps/web`**.
2. Environment variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Supabase transaction pooler |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
   | `APP_URL` | The panel address, e.g. `https://app.snowtechsoftwares.com.br` |
   | `CLIENT_LINK_SECRET` | Long random string (changing it revokes every client link) |
   | `META_APP_SECRET` | App Dashboard > App settings > Basic |
   | `META_WEBHOOK_VERIFY_TOKEN` | Any random string, repeated in the Meta webhook setup |
   | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Same as Railway, for "Testar conversa" |

   Never set `DEV_AUTH_USER_ID` here.
3. Optional: a subdomain such as `app.snowtechsoftwares.com.br` (Vercel shows
   the CNAME to add in Registro.br).

## 4. Meta webhook

App Dashboard > WhatsApp > Configuration:

- Callback URL: `<APP_URL>/api/webhooks/whatsapp`
- Verify token: the same `META_WEBHOOK_VERIFY_TOKEN`
- Fields: `messages`. With coexistence, also `smb_message_echoes`, `history`
  and `smb_app_state_sync`.

## 5. First access

1. Supabase > Authentication > Users > **Invite user** for each team member.
2. Give them the agency (creates it the first time). With the Railway CLI, the
   service variables are injected into the command:

   ```bash
   railway run npm run add-member -w @post-lead/worker -- --email voce@agencia.com.br --agency "Nome da agência"
   ```

## Testing with the Meta test number

**The app must be subscribed to each WhatsApp Business Account** it serves,
the test account included, or Meta never sends that account's messages to the
webhook (the "Test" button in the dashboard still works, which hides the
problem). Check and fix in the Graph API Explorer, app "Post Lead Dev":
`GET <WABA_ID>/subscribed_apps` must list the app; if not,
`POST <WABA_ID>/subscribed_apps`.

Before any client number exists, one test number can be both the client's
number and the tool's number:

1. Set `TOOL_PHONE_NUMBER_ID` to the test number's id.
2. In the panel, create a client with that same id in "ID do número do WhatsApp
   do cliente", and your own phone as a seller.
3. In Meta's API Setup, add as test recipients both the seller's phone and the
   phone that will play the lead (the test number only sends to registered
   recipients).
4. Write to the test number from the lead's phone. Messages from a registered
   seller or manager are treated as button taps and replies; anyone else is a
   lead.

Business verification must be approved first: before it, Meta blocks sending
with error 131031.
