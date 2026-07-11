# Whautomate WhatsApp Auto-Reply Bot (1416)

LLM replies to inbound WhatsApp messages on the Whautomate-connected number. **Default OFF** until you flip the kill switches below.

## Architecture

```
Lead WhatsApp → Whautomate → POST /api/whautomate/webhook
  → ingest (leads/messages)
  → (async) LLM reply → Whautomate sendtext API → lead
  → outbound row with sent_by_bot=true
```

## 1. Env vars

Set in `.env.local` / Railway (never commit real keys):

| Variable | Default | Description |
|----------|---------|-------------|
| `WHAUTOMATE_API_KEY` | — | Whautomate REST API key |
| `WHAUTOMATE_API_BASE` | — | e.g. `https://api.whautomate.com` |
| `WHAUTOMATE_AUTOREPLY` | `false` | **Global kill switch** — must be exactly `true` to enable |
| `ANTHROPIC_API_KEY` | — | Claude for reply generation |
| `WHAUTOMATE_WEBHOOK_SECRET` | optional | Existing webhook auth |

## 2. Migration

Apply `supabase/migrations/005_whautomate_bot.sql`:

- `tenants.autoreply_enabled` (default false)
- `tenants.reply_prompt` (optional custom persona)
- `leads.whautomate_contact_id`
- `leads.bot_paused_until`
- `messages.sent_by_bot`

## 3. Enable for your tenant

```sql
-- Turn on auto-reply for the Whautomate tenant (after global env is true)
UPDATE tenants
SET autoreply_enabled = true
-- optional custom persona; leave null to use the built-in 1416 default
-- , reply_prompt = 'Your custom system prompt...'
WHERE whautomate_channel_id IS NOT NULL;
```

## 4. Live send test (no LLM)

```bash
node scripts/test-whautomate-send.mjs 9715XXXXXXXX "Hello from AgentZero"
```

Uses `recepient.phoneNumber` addressing. Confirm delivery on WhatsApp before enabling auto-reply.

## 5. Live auto-reply test

1. Set `WHAUTOMATE_AUTOREPLY=true` on Railway and redeploy.
2. Flip `tenants.autoreply_enabled = true` (SQL above).
3. Message the business number from your personal phone.
4. Expect a short reply (<=75 words). Check Railway logs for errors; check `messages` for `sent_by_bot = true`.

## 6. Kill switches (all three)

| Switch | How to stop replies |
|--------|---------------------|
| Global | `WHAUTOMATE_AUTOREPLY=false` (or unset) |
| Tenant | `UPDATE tenants SET autoreply_enabled = false WHERE …` |
| Per-lead | `UPDATE leads SET bot_paused_until = now() + interval '24 hours' WHERE wa_id = '…'` |

Also automatic:

- **Human-active gate**: if any outbound message for that lead in the last 10 minutes has `sent_by_bot = false` (team member replied from their phone / Whautomate), the bot stays silent.
- **Debounce**: max 1 bot reply per lead per 60 seconds.
- **Handoff**: if the lead asks for a human (or the model is unsure), the bot says a team member will follow up and sets `bot_paused_until = now() + 24h`.

## 7. Addressing

Send prefers `message.contact.id` stored on `leads.whautomate_contact_id`. Falls back to Whautomate's `recepient` object with digits-only phone (no `+`) + name.

## Notes

- Webhook always returns 200 quickly; LLM + send run async (fire-and-forget).
- Outbound Whautomate echoes of our own bot messages are deduped against recent `sent_by_bot = true` rows with the same body.
- Meta webhook / Vapi / Zap 2 paths are untouched.
