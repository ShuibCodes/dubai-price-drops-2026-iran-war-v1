# Dubizzle email lead ingestion — build checklist

AgentZero: agent forwards Dubizzle enquiry emails to a per-tenant inbound address → Resend webhook → parse → guardrails → outbound call within ~60s (when allowed).

**Dial path (repo):** `upsertInboundLead` + `dialOrQueueLead` / `dialLeadNow` → `startLeadCall` — **not** `startTargetLeadCall()` (demo-only).

---

## Decisions to lock before step 1

| ID | Decision | Recommendation (repo-aligned) |
|---|---|---|
| D1 | Dial entrypoint | `upsertInboundLead` + `dialOrQueueLead` / `dialLeadNow` |
| D2 | Script selection | Add `tenants.dubizzle_script_id` (FK → `scripts`, `status = live`) **or** extend `scriptPointerForSource` with `dubizzle-inbound` seed key |
| D3 | Business hours | Tenant Gulf window (10–19) **vs** lead-local (`isLeadWithinBusinessHours`) — dubizzle likely needs tenant Gulf + optional `immediate` only in dev |
| D4 | 24h cooldown | Rolling 24h on `calls` + normalized phone (mirror `recentRelayToPhone` on `relay_calls`) |
| D5 | Assigned agent | v1: assign to single admin agent on tenant, or `inbound_leads.agent_id` at address generation |
| D6 | Async | Worker `scripts/process-inbound-dubizzle.mjs` polling `inbound_leads`; webhook only enqueues `received` |
| D7 | Guardrail order | `dubizzle_enabled` → `outbound_paused` → parse/skip → `require_approval` → tenant hours → 24h cooldown → `opted_out` → dial |

**Open questions (team):**

- Guardrail precedence when `require_approval` and outside-hours both apply (recommend: approve first, then hours/cooldown on dial).
- SPF/DKIM from Resend payload vs manual header parse (validate in step 3).
- 24h cooldown: rolling window vs calendar day (batch caps use Dubai calendar day; relay uses rolling ms).

---

## Step 1 — Database schema

**Migration:** `supabase/migrations/027_dubizzle_inbound_email.sql` (renumber if 027 taken).

| Change | Detail |
|---|---|
| `tenants` | `inbound_email` (unique), `dubizzle_enabled` (default false), `dubizzle_last_lead_at`, `require_approval` (default true); optional: `dubizzle_script_id`, Gulf call window columns |
| `inbound_leads` | id, tenant_id, resend_email_id (unique), from_address, lead_name, lead_phone, listing_title, listing_url, raw_text, status, skip_reason, call_id, created_at; indexes on tenant/status/created_at |
| `retired_inbound_emails` | email (PK), tenant_id, retired_at — never reassign without check |

**Files**

- [ ] `supabase/migrations/027_dubizzle_inbound_email.sql`

**Done when**

- [ ] Migration applies on fresh + existing DB
- [ ] Unique constraints enforce dedupe + retired email safety

---

## Step 2 — Address generation & retirement

**Lib**

- [ ] `src/lib/dubizzle/inbound-email.js`
  - `generateInboundEmail(slug)` → `{slug}-{6 alnum}@leads.agentzero.ae`
  - `isEmailRetired(supabase, email)`
  - `allocateInboundEmail(supabase, tenantId)`
  - `retireInboundEmail(supabase, tenantId)`

**Provisioning / backfill**

- [ ] Hook tenant creation (`src/lib/copilot/social-auth.js` or DB function in new migration — prefer not rewriting shipped 026)
- [ ] `scripts/backfill-inbound-emails.mjs`

**Console API (minimal; full UI step 8)**

- [ ] `src/app/api/console/dubizzle/address/route.js` — GET
- [ ] `src/app/api/console/dubizzle/address/regenerate/route.js` — POST (admin)

**Tests**

- [ ] `scripts/qa-dubizzle-address.mjs`

**Done when**

- [ ] New tenants get `inbound_email`; regenerate retires old; retired never reused

---

## Step 3 — Resend setup (manual + env)

**Manual (DNS / Resend dashboard with Shuayb)**

- [ ] Inbound domain `leads.agentzero.ae`
- [ ] Webhook → `/api/inbound/dubizzle`
- [ ] Signing secret + Receiving API

**Repo**

- [ ] `.env.example` — `RESEND_WEBHOOK_SECRET`, receiving notes
- [ ] `src/lib/email/resend-receiving.js` — `fetchReceivedEmail`, `verifyResendWebhookSignature`
- [ ] `scripts/fixtures/resend-email-received.json`

**Done when**

- [ ] Fixture payload available for local webhook tests

---

## Step 4 — Webhook `/api/inbound/dubizzle`

- [ ] `src/app/api/inbound/dubizzle/route.js`
  - Verify Resend signature; reject unsigned
  - Only `email.received`
  - Tenant lookup by recipient `inbound_email` — **no default tenant**
  - Dedupe `resend_email_id`; return 200 quickly
  - Insert `inbound_leads` with `status = received`
- [ ] `src/lib/dubizzle/webhook.js`
- [ ] `src/lib/dubizzle/tenant-by-inbound-email.js`
- [ ] `scripts/qa-dubizzle-webhook.mjs`

**Done when**

- [ ] Webhook never dials; unknown recipient logged; idempotent dedupe

---

## Step 5 — Gmail verification handling

- [ ] `src/lib/dubizzle/gmail-forwarding.js` — `forwarding-noreply@google.com`, extract code
- [ ] Tenant fields or migration: e.g. `dubizzle_gmail_verify_code`, `dubizzle_gmail_verify_at`
- [ ] Worker branch before Haiku — not a lead, no dial
- [ ] `scripts/qa-dubizzle-gmail-verify.mjs`

**Done when**

- [ ] Verification emails never upsert `leads` or trigger calls

---

## Step 6 — Filtering + Haiku parse

- [ ] `src/lib/dubizzle/parse-enquiry.js` — SPF/DKIM checks, Haiku JSON schema
- [ ] Reuse `normalizePhone` from `src/lib/leads/normalize.js`
- [ ] Map to `buildPropertyInterest` fields where possible
- [ ] `scripts/fixtures/dubizzle-email-*.txt`
- [ ] `scripts/qa-dubizzle-parse.mjs`

**Done when**

- [ ] `is_enquiry: false` → skipped; bad phone → skipped + reason

---

## Step 7 — Call trigger & guardrails

- [ ] `src/lib/dubizzle/process-inbound-lead.js` — single path for worker + Console approve
- [ ] `src/lib/dubizzle/guardrails.js`
- [ ] `src/lib/dubizzle/cooldown.js` — `recentCallToPhone` on `calls`
- [ ] `upsertInboundLead` with `source` dubizzle / `client_source` for `enquiry-source.js`
- [ ] `dialOrQueueLead` or `dialLeadNow` with explicit script from D2
- [ ] `scripts/process-inbound-dubizzle.mjs` (Railway cron)
- [ ] `src/app/api/console/dubizzle/leads/[id]/approve/route.js`
- [ ] `src/app/api/console/dubizzle/leads/[id]/skip/route.js`
- [ ] Optional: `src/lib/scripts/pointers.js`, `src/lib/leads/inbound.js` source mapping
- [ ] `scripts/qa-dubizzle-guardrails.mjs`

**Done when**

- [ ] Mock emails dial only allowlisted test numbers; approve/skip/cooldown/opt-out behave; `inbound_leads.call_id` set

---

## Step 8 — Console panel (Settings)

- [ ] `src/components/console/dubizzle-settings.jsx`
- [ ] Wire `src/components/console/settings-page.jsx` (replace “not wired up yet”)
- [ ] `src/app/api/console/dubizzle/route.js` — GET/PATCH flags + recent leads

**Done when**

- [ ] Copy address, Gmail code, toggle, approve/skip work for admin

---

## Cross-cutting

| Item | Notes |
|---|---|
| Logging | Prefix `[dubizzle]` |
| Idempotency | Unique `resend_email_id`; worker retries safe |
| Middleware | `/api/inbound/dubizzle` is public (not under copilot matcher) |
| Real E2E | Manual sign-off on real Dubizzle emails (Alex) — not mocks alone |

---

## Suggested PR sequence

1. **PR1** — Migration + address lib + backfill + qa-address  
2. **PR2** — Resend verify + webhook + fixtures + qa-webhook  
3. **PR3** — Gmail verify + parse + qa-parse  
4. **PR4** — Guardrails + process-inbound-lead + worker + qa-guardrails  
5. **PR5** — Console API + dubizzle-settings UI  
6. **PR6** — Production Resend + real agent validation  

---

## New files (summary)

```
supabase/migrations/027_dubizzle_inbound_email.sql
src/lib/dubizzle/inbound-email.js
src/lib/dubizzle/webhook.js
src/lib/dubizzle/tenant-by-inbound-email.js
src/lib/dubizzle/gmail-forwarding.js
src/lib/dubizzle/parse-enquiry.js
src/lib/dubizzle/guardrails.js
src/lib/dubizzle/cooldown.js
src/lib/dubizzle/process-inbound-lead.js
src/lib/email/resend-receiving.js
src/app/api/inbound/dubizzle/route.js
src/app/api/console/dubizzle/route.js
src/app/api/console/dubizzle/address/route.js
src/app/api/console/dubizzle/address/regenerate/route.js
src/app/api/console/dubizzle/leads/[id]/approve/route.js
src/app/api/console/dubizzle/leads/[id]/skip/route.js
src/components/console/dubizzle-settings.jsx
scripts/backfill-inbound-emails.mjs
scripts/process-inbound-dubizzle.mjs
scripts/qa-dubizzle-address.mjs
scripts/qa-dubizzle-webhook.mjs
scripts/qa-dubizzle-gmail-verify.mjs
scripts/qa-dubizzle-parse.mjs
scripts/qa-dubizzle-guardrails.mjs
scripts/fixtures/...
```

## Likely touch existing

```
.env.example
src/components/console/settings-page.jsx
src/lib/scripts/pointers.js
src/lib/leads/inbound.js
src/lib/copilot/social-auth.js
```
