# AgentZero WhatsApp Coexistence Runbook

Meta WhatsApp Cloud API in coexistence mode: your business number stays on your phone, while the API receives inbound lead messages and echoes of your own replies.

## 1. Environment setup

Copy the Meta/Supabase vars from `.env.example` into `.env.local`:

- `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`
- `META_GRAPH_VERSION` (default `v25.0`)
- `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_CONFIG_ID` (config id arrives after Meta verification)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `SKIP_META_SIG=1` for local simulator only
- Optional: `SEED_AGENT_WA_ID` (your WhatsApp number, digits only)

## 2. Run the migration

Apply [`supabase/migrations/001_whatsapp.sql`](supabase/migrations/001_whatsapp.sql) in the Supabase SQL editor (or via Supabase CLI):

```bash
# Option A: Supabase SQL editor (paste migration file)
# Option B: CLI linked project
supabase db push

# Option C: direct Postgres URL
SUPABASE_DB_PASSWORD=your_db_password node scripts/apply-migration.mjs
```

Tables created: `tenants`, `agents`, `leads`, `messages`.

## 3. Seed dev tenant + agent

```bash
node scripts/seed-tenant.mjs
```

This upserts:

- tenant with `phone_number_id=111000111000111`
- agent row linked to that tenant (`SEED_AGENT_WA_ID`, default `971586689688`)

## 4. Start dev server

```bash
npm run dev
```

## 5. Simulate Meta webhooks

```bash
node scripts/simulate-meta.mjs all
```

Optional custom URL:

```bash
node scripts/simulate-meta.mjs all https://your-host/api/meta/webhook
```

Scenarios:

- `inbound1` — Ahmed asks for a 2BR in Dubai Marina under 2M
- `inbound2` — Ahmed adds "ready before September"
- `echo` — your outbound reply from the phone app
- `lead2` — Sara asks about JVC townhouses

## 6. Ask the KB

Message AgentZero (via `/api/whatsapp` or any caller wired to `runKbTurn`):

> what did Ahmed want?

Expected: Ahmed wants a 2BR in Dubai Marina under 2M AED, ideally ready before September. Your echo reply offered Marina options under 2M.

Tenant resolution:

- Webhook resolves tenant by `phone_number_id`
- KB chat resolves tenant by agent `wa_id` when `callerWaId` is provided
- Unknown agent numbers get a polite "not registered" reply (no cross-tenant fallback)
- Dev-only fallback: first tenant row when `callerWaId` is absent (logs `TENANT FALLBACK USED — dev only`)

## 7. Embedded signup (after Meta verification)

1. Create Embedded Signup config in Meta Developer Console
2. Paste the config id into `NEXT_PUBLIC_META_CONFIG_ID`
3. Open `/connect` and click **Connect WhatsApp**
4. The page exchanges the auth code via `/api/meta/exchange` and stores the business token server-side

## 8. Production webhook (after Meta verification)

In Meta Developer Console → WhatsApp → Configuration:

- Callback URL: `https://<your-railway-host>/api/meta/webhook`
- Verify token: same value as `META_VERIFY_TOKEN`
- Subscribe to `messages` (and message echo fields for coexistence)

Remove `SKIP_META_SIG` in production. Signature verification is mandatory.

## Key routes

| Route | Purpose |
|---|---|
| `GET/POST /api/meta/webhook` | Meta verification + signed webhook ingest |
| `POST /api/meta/exchange` | OAuth code → business token (stored, never returned) |
| `/connect` | Embedded signup page |

## Security notes

- Never log `META_APP_SECRET`, business tokens, or service role keys
- Webhook POST rejects invalid/missing `X-Hub-Signature-256` (except dev + `SKIP_META_SIG=1`)
