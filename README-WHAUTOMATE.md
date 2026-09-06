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

In Whautomate → webhook forwarding settings, set a **per-tenant** URL. The
query `channel` must match that tenant's `tenants.whautomate_channel_id`:

```
https://<railway-domain>/api/whautomate/webhook?channel=<whautomate_channel_id>
```

(Optionally also `&secret=<WHAUTOMATE_WEBHOOK_SECRET>` per above.)

## 4. Send a test message and read the raw log

Send a WhatsApp message to your business number, then check the Railway logs for:

```
WHAUTOMATE RAW: {...full JSON payload...}
```

Every request is logged in full **before** any mapping — this is the source of truth for the real payload shape.

## 5. Enable your tenant

Set `tenants.whautomate_channel_id` to a unique marker (Sterling today uses
`whautomate-default`) and send that same value on the webhook as `?channel=`.

```sql
UPDATE tenants
SET whautomate_channel_id = 'whautomate-default'
WHERE slug = 'sterling';
```

Standard Whautomate message payloads do **not** include a location/account id.
`message.channel` is only the medium (`whatsApp`) and is ignored. If the request
has no channel, or it does not match exactly one tenant, ingestion is skipped
(`missing_channel` / `unknown_channel` / `ambiguous_channel`). There is no
first-tenant fallback.

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
