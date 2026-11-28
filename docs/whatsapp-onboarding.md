# Connecting a client's WhatsApp (Embedded Signup)

The client clicks **Conectar WhatsApp** on their page in the panel. Meta's
Embedded Signup opens; the client logs in with Facebook, picks or creates the
business portfolio and enters their number.

- **Number already on the WhatsApp Business app (coexistence):** Meta detects it
  and the client confirms in the app by scanning a QR code. The number keeps
  working in the app. Requires app version 2.24.17 or later.
- **Number not on WhatsApp:** verified by SMS or call, then registered on Cloud API.

## What the server does (`services/whatsappConnection.ts`)

1. Exchanges the `code` from `FB.login` for the client's business token
   (`GET /oauth/access_token`) and stores it encrypted (`operations.access_token_encrypted`,
   AES-256-GCM with `TOKEN_ENCRYPTION_KEY`).
2. Subscribes our app to the client's account (`POST /{waba}/subscribed_apps`), so
   its messages reach the webhook.
3. Picks the number (`GET /{waba}/phone_numbers`). Coexistence when `is_on_biz_app` is true.
4. Not coexistence: registers the number (`POST /{phone}/register`, random PIN).
5. Coexistence: asks for contacts, then history (`POST /{phone}/smb_app_data`,
   `smb_app_state_sync` then `history`). **Only within 24 hours of onboarding, once each.**
6. Creates the lead templates on the client's account (`follow_up_1`, `follow_up_2`, `reengage_1`).

The worker sends from each client's number with that client's token
(`createTokenResolver`), and from the tool's number with `META_ACCESS_TOKEN`.

## Meta requirements

- The app must be a **Tech Provider** (or Solution Partner) for coexistence:
  business verification (done) and App Review with advanced access to
  `whatsapp_business_messaging` and `whatsapp_business_management`. App Review asks
  for two videos: a message sent from the app arriving on WhatsApp, and a template
  created through the API.
- A **Facebook Login for Business configuration** for WhatsApp Embedded Signup
  (App Dashboard → Facebook Login for Business → Configurations). Its id is
  `NEXT_PUBLIC_META_ES_CONFIG_ID`.
- The panel's domain in the app's allowed domains for the JavaScript SDK.
- Webhook fields: `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes`, `account_update`.

## Environment

| Where | Variable | |
|---|---|---|
| Vercel | `NEXT_PUBLIC_META_APP_ID` | app id, public |
| Vercel | `NEXT_PUBLIC_META_ES_CONFIG_ID` | Login for Business configuration id, public |
| Vercel | `META_APP_SECRET` | already set |
| Vercel | `GRAPH_API_VERSION` | e.g. `v25.0` |
| Vercel and Railway | `TOKEN_ENCRYPTION_KEY` | same value in both; 32 random bytes, base64 |

Generate the key once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Changing it later makes the stored tokens unreadable: clients would have to reconnect.
