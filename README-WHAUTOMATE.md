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

## 5. Enable your tenant

Whautomate payloads carry **no channel identifier**, so the route ingests into the first (single) tenant that has `whautomate_channel_id` set — the value just acts as an on-switch. Set any marker value:

```sql
UPDATE tenants
SET whautomate_channel_id = 'whautomate'
WHERE id = 'YOUR_TENANT_UUID';
```

Until this is set, ingestion is skipped with a `no_tenant` reason in the response.

## 6. Payload mapping (confirmed shape)

`mapWhautomatePayload()` in `src/app/api/whautomate/webhook/route.js` maps the confirmed Whautomate event shape:

| Our field | Whautomate path |
|-----------|-----------------|
| event filter | `event.type` = `incoming_whatsapp_message` or `outgoing_whatsapp_message` |
| direction | `message.isIncoming` → `true` = inbound, `false` = outbound |
| `wa_id` | `message.contact.phoneNumber` (no plus prefix — normalized to digits) |
| `push_name` | `message.from` (inbound only; outbound `sentBy` is our side and is ignored) |
| `body` | `message.text` |
| `wa_message_id` | `message.id` |
| `timestamp` | `message.timestamp` (ISO) |
| thread anchor | `message.contact.id` (kept in `raw`) |

Other `event.type` values are acknowledged with 200 and skipped (`not_a_message_event`).

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
