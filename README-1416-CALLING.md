# 1416 Real Estate — Vapi Calling Pipeline Runbook

Outbound AI calling for Pixxi CRM leads via Zapier. No direct Pixxi API — all CRM sync is through two Zaps.

## Architecture

```
Pixxi → Zap 1 (webhook) → POST /api/leads/inbound → Vapi call
Vapi end-of-call → POST /api/vapi/webhook → Zap 2 (catch hook) → Pixxi activity note
```

## 1. Environment variables

Add to `.env.local` (see `.env.example` for placeholders):

| Variable | Required | Description |
|----------|----------|-------------|
| `VAPI_API_KEY` | Yes | Vapi API key |
| `VAPI_ASSISTANT_ID` | Yes | Default assistant (tenant can override) |
| `VAPI_PHONE_NUMBER_ID` | Yes | Default outbound number (tenant can override) |
| `VAPI_WEBHOOK_SECRET` | Yes | Secret Vapi sends in `X-Vapi-Secret` header |
| `LEADS_INBOUND_SECRET` | Yes | Secret Zap 1 sends in `x-leads-secret` header |
| `RESULTS_WEBHOOK_URL` | No | Zap 2 catch-hook URL; skip results POST if unset |
| `CALLS_BUSINESS_HOURS_START` | No | Dubai hour to start dialing (default `9`) |
| `CALLS_BUSINESS_HOURS_END` | No | Dubai hour to stop dialing (default `20`) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key |
| `ANTHROPIC_API_KEY` | Yes | For call qualification when Vapi structuredData absent |

## 2. Database migration

Apply `supabase/migrations/002_calls.sql`:

```bash
# Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD + SUPABASE_URL, then:
node scripts/apply-migration.mjs
```

> Note: update `apply-migration.mjs` path to `002_calls.sql` or run the SQL directly in Supabase SQL editor.

## 3. Seed 1416 tenant

Run in Supabase SQL editor (replace placeholders):

```sql
INSERT INTO tenants (name, slug, vapi_assistant_id, vapi_phone_number_id, phone_number_id, business_token)
VALUES (
  '1416 Real Estate',
  '1416',
  'YOUR_VAPI_ASSISTANT_ID',
  'YOUR_VAPI_PHONE_NUMBER_ID',
  'YOUR_META_PHONE_NUMBER_ID',   -- optional: for agent WhatsApp notifications
  'YOUR_META_BUSINESS_TOKEN'     -- optional: for agent WhatsApp notifications
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  vapi_assistant_id = EXCLUDED.vapi_assistant_id,
  vapi_phone_number_id = EXCLUDED.vapi_phone_number_id;
```

## 4. Vapi dashboard setup

1. **Server URL**: `https://YOUR_DOMAIN/api/vapi/webhook`
2. **Server URL Secret**: same value as `VAPI_WEBHOOK_SECRET`
3. Ensure assistant has variables: `leadName`, `leadSource`, `propertyInterest`
4. Enable end-of-call report / structured data if available

## 5. Zapier Zap 1 — Pixxi → inbound endpoint

**Trigger**: Pixxi new lead (or your chosen trigger)

**Action**: Webhooks by Zapier → POST

| Setting | Value |
|---------|-------|
| URL | `https://YOUR_DOMAIN/api/leads/inbound` |
| Payload type | JSON |
| Header `x-leads-secret` | value of `LEADS_INBOUND_SECRET` |

**JSON body field mapping** (exact field names our endpoint expects):

| Field | Pixxi source |
|-------|--------------|
| `name` | Lead name |
| `phone` | Lead phone |
| `pixxi_lead_id` | Pixxi lead ID |
| `client_source` | Client Source |
| `custom_client_source` | Custom Client Source |
| `house_type` | House Type |
| `rooms` | Rooms |
| `budget` | Budget |
| `community` | Community |
| `agent_name` | Agent Info Name |
| `agent_phone` | Agent Info Phone |

**Response**: `{ "ok": true, "queued": false, "callId": "..." }` or `{ "ok": true, "queued": true }` outside business hours.

## 6. Zapier Zap 2 — results → Pixxi activity note

**Trigger**: Webhooks by Zapier → Catch Hook (copy URL to `RESULTS_WEBHOOK_URL`)

**Flat fields received** (all strings, Zapier-friendly):

| Field | Description |
|-------|-------------|
| `lead_name` | Lead display name |
| `lead_phone` | E.164 phone |
| `pixxi_lead_id` | Pixxi CRM ID |
| `outcome` | `qualified`, `callback`, `not_interested`, `voicemail`, `no_answer` |
| `intent` | `live`, `invest`, `browsing` |
| `budget_aed` | Budget mentioned |
| `areas` | Comma-separated area names |
| `timeline` | Move-in / purchase timeline |
| `callback_time` | Requested callback time |
| `summary` | Call summary text |
| `recording_url` | Vapi recording URL |
| `called_at` | ISO timestamp |

Map these into a Pixxi activity note in Zap 2.

## 7. Batch calling (CSV export from Pixxi)

```bash
# Dry run first
node scripts/run-call-batch.mjs /path/to/pixxi-export.csv --dry-run --limit 5

# Live batch (60s delay between dials)
node scripts/run-call-batch.mjs /path/to/pixxi-export.csv --limit 50 --delay 60
```

CSV headers are matched case-insensitively against `PIXXI_COLUMN_MAP` in the script.

## 8. Queue drainer (cron)

Outside business hours, inbound leads and batch rows are queued. Run every 15 minutes during business hours:

```bash
node scripts/process-call-queue.mjs
```

## 9. Retry failed results sync

```bash
node scripts/retry-results-sync.mjs
```

Re-POSTs completed calls with `results_synced=false` from the last 7 days.

## 10. Phone normalization

Pixxi phones like `9710554229317` (971 + stray 0) are normalized to `+971554229317`.

Test cases:

```bash
node scripts/test-phone-normalize.mjs
```

## 11. QA checklist (10 scenario calls before client data)

Run these manually or via inbound POST before going live:

1. **Valid UAE mobile** (`0554229317`) — call initiates in hours
2. **Pixxi format** (`9710554229317`) — normalizes and dials
3. **E.164** (`+971554229317`) — passes through
4. **Missing phone** — returns `{ ok: false }`, no call
5. **Outside business hours** — `{ queued: true }`, queue row created
6. **Duplicate Zapier retry** — idempotent upsert, no duplicate leads
7. **Qualified call** — agent WhatsApp summary sent (if agent phone + Meta sender configured)
8. **Callback outcome** — agent notification sent
9. **Voicemail / no answer** — results POSTed to Zap 2, no agent notify
10. **Results webhook down** — call saved, `results_synced=false`, retry script recovers

## Troubleshooting

- **401 on inbound**: check `x-leads-secret` header matches `LEADS_INBOUND_SECRET`
- **401 on Vapi webhook**: check `X-Vapi-Secret` matches `VAPI_WEBHOOK_SECRET`
- **No calls placed**: verify tenant `slug='1416'` has `vapi_assistant_id` and `vapi_phone_number_id`
- **No Pixxi note**: check `RESULTS_WEBHOOK_URL` and run `retry-results-sync.mjs`
- **No agent WhatsApp**: tenant needs `phone_number_id` + `business_token`; otherwise message is logged only
