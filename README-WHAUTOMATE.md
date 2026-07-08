# Whautomate → AgentZero Adapter

Forwards Whautomate message events (coexistence-connected WhatsApp Business number) into the existing Supabase `tenants`/`leads`/`messages` pipeline. The Meta webhook and KB code are untouched — this is a parallel ingest path.

## 1. Apply migration

Run `supabase/migrations/003_whautomate.sql` in the Supabase SQL editor (adds `tenants.whautomate_channel_id`).

## 2. Env var

```
WHAUTOMATE_WEBHOOK_SECRET=          # optional; leave unset while mapping (dev mode, accepts all)
```

If Whautomate's UI supports a custom header, use `x-whautomate-secret: <value>`. If it only supports URL config, append `?secret=<value>` to the webhook URL instead.

## 3. Point Whautomate at the endpoint

In Whautomate → webhook forwarding settings, set the URL to:

```
https://<railway-domain>/api/whautomate/webhook
```

(Optionally `...?secret=<WHAUTOMATE_WEBHOOK_SECRET>` per above.)

## 4. Send a test message and read the raw log

Send a WhatsApp message to your business number, then check the Railway logs for:

```
WHAUTOMATE RAW: {...full JSON payload...}
```

Every request is logged in full **before** any mapping — this is the source of truth for the real payload shape.

## 5. Seed your tenant's channel id

Read the channel/account id from the raw log (look for `channelId`, `channel_id`, `accountId`, or similar), then run:

```sql
UPDATE tenants
SET whautomate_channel_id = 'CHANNEL_ID_FROM_RAW_LOG'
WHERE id = 'YOUR_TENANT_UUID';
```

Until this is set, ingestion is skipped with a `no_tenant` reason in the response. If the payload's channel id doesn't match any tenant, the route falls back to the first tenant that has `whautomate_channel_id` set (with a logged warning).

## 6. Tighten the mapping

The route does best-effort mapping in `mapWhautomatePayload()` (`src/app/api/whautomate/webhook/route.js`) across common field conventions:

- contact phone → `wa_id` (tries `contact.phone`, `contact.phoneNumber`, `message.from`, ...)
- contact/profile name → `push_name`
- text → `body` (tries `message.text`, `message.body`, `message.content`, ...)
- direction → inbound vs outbound (checks `direction`, `type`, `fromMe`, `sender`, echo/agent keywords)
- message id → idempotent insert key (falls back to `whautomate-{wa_id}-{timestamp}`)
- timestamp → accepts unix seconds, milliseconds, or ISO strings

Once real payloads are in the logs, replace the guesswork in `mapWhautomatePayload()` with the actual field names.

## 7. Verify rows

```sql
SELECT l.push_name, l.wa_id, m.direction, m.body, m.timestamp
FROM messages m
JOIN leads l ON l.id = m.lead_id
ORDER BY m.created_at DESC
LIMIT 10;
```

You should see the test message with the correct direction. The KB live-conversations layer reads from these same tables, so ingested messages are immediately available to it.

## Notes

- The endpoint always returns 200 to Whautomate (except bad secret → 401) so their retries don't pile up; unmapped events are logged and skipped.
- Duplicate deliveries are idempotent via `wa_message_id` uniqueness.
- Ingest uses the same `upsertLead`/`insertMessageIfNew` helpers as the Meta webhook (shared in `src/lib/ingest/message-ingest.js`).
