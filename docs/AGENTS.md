# AgentZero — agent rules

Read this before every task. It is the standing contract for this repo.

Authority order when documents disagree:
1. `docs/backend-scripts-prompt.md` — the Scripts build brief. Wins on anything
   it covers: dial path, auth, scripts schema, prompt composition, Vapi
   lifecycle, queue attribution, WhatsApp resolution, Scripts UI.
2. This file — repo-wide rules and constraints.
3. `docs/web-console-spec.md` — the console screens Scripts doesn't cover.

## What this product is

AgentZero is an AI copilot for real estate agents, delivered over WhatsApp. The
agent texts it from their own phone. Leads never talk to AgentZero — leads only
ever receive an outbound voice call placed by Vapi, triggered by the agent.

We are adding a **web console**: a small surface for the three things a phone
can't do — connect an account, upload a file, configure something with a form.
It is used roughly once a week.

**The governing rule: every screen ends by sending the user back to WhatsApp.**
If you are unsure whether something belongs in the web app, the answer is no.
It belongs in the chat.

## Stack

- Next.js (App Router), JavaScript — **not TypeScript**
- Tailwind CSS
- Supabase (Postgres + Auth + Storage). **The app queries via the service-role
  client, which bypasses RLS.** Tenant isolation is enforced at the application
  layer by `getSession()` + an explicit `tenant_id` filter on every query. Add
  RLS to new tables as defence in depth, but never rely on it as the control.
- **Vapi** for outbound voice. Not Bland. If you find a reference to Bland,
  `bland_persona_id`, or `/api/bland/*` in any doc, it is stale — flag it.
- Meta WhatsApp Cloud API with Coexistence (already onboarded)
- zod for payload validation — **not currently a dependency, `npm i zod` first**

## Multi-tenancy

This is a **multi-tenant** app. `tenant_id` is the scope key on every table and
in every query, including resolvers and background workers. There is no
`brokerage_id` — if you see one in a doc, read it as `tenant_id`.

Roles exist: `agents.role` is `'agent' | 'admin'`. Publishing a script requires
`'admin'`. The Publish control is hidden entirely for `'agent'`. Do not build
a broader permissions system than this — two roles, one gated action.

Auth today is an HMAC cookie carrying `{ username, tenantSlug }` from
`COPILOT_USERS_JSON`. Phase 1 replaces the identity, not the login habit:
**authenticate by `username`**, which is what live users already have, and add
`email` as an optional column for later. Do not force existing users onto email
logins as a side effect of this work. `COPILOT_USERS_JSON` survives behind a
flag during migration and logs whenever it is hit.

`getSession()` from `src/lib/copilot/session.js` returns
`{ agentId, tenantId, tenantSlug, role, waPhone }`. **Every** new API route uses
it. 403 on tenant mismatch, no exceptions.

## File layout

```
src/lib/vapi/dial.js         → THE single outbound path. Nothing else dials.
src/lib/scripts/compose.js   → the spoken prompt. PREAMBLE + SCRIPT + SCAFFOLD.
src/lib/scripts/resolve.js   → name → script matching for WhatsApp/Copilot
src/lib/copilot/session.js   → getSession()
src/app/copilot/[tenant]/    → the console UI lives here, under existing auth
src/app/api/scripts/         → scripts API
supabase/migrations/         → numbered SQL
```

Do not put console code in `src/components/landing/` (marketing page) or
`src/components/kb/` (the disposable web demo).

## Hard constraints — never violate these

1. **No endpoint and no UI field ever accepts or exposes** a raw prompt, model,
   temperature, `maxDurationSeconds`, `silenceTimeoutSeconds`, transcriber,
   endpointing, or a webhook URL. Those live only in `compose.js` and
   `dial.js`. Not behind a flag, not in an "Advanced" accordion, not in
   settings. The only free-text influence an agent has is the 300-character
   `extra_context` field, appended last and explicitly framed as colour that
   cannot override anything above it.
2. **No modals in the Copilot console.** No dialogs, no overlays. Everything
   expands inline — confirms, history, pickers, errors. *(Scoped to
   `src/app/copilot/**` and `src/components/console/**`. `src/components/dashboard/`
   belongs to DXB Dip, a different product in this repo — leave it alone.)*
3. **No charts, graphs, or analytics in the Copilot console.** If a task seems
   to need one, use three number tiles and flag it. *(Same scope as above.
   DXB Dip ships recharts; that is not our concern.)*
4. **AI disclosure is locked.** The disclosure rule renders non-interactive with
   a Required pill and cannot be untinked. It also lives in the hardcoded
   PREAMBLE, so config cannot remove it.
5. **Never auto-message a lead.** AgentZero sits on the agent's real WhatsApp
   number via Coexistence. Any outbound to a lead requires explicit agent
   confirmation. There is no code path that skips it.
6. **Never fire an unconfirmed batch, and never fall back to a default script
   on a failed match.** Ambiguous → offer the top two. No match → list live
   script names and ask.
7. **Respect `opted_out` everywhere.** Every call query filters it, and
   exclusions are shown to the user, never silently applied.
8. **Privacy is scoped, not blanket.** An agent sees full name and full E.164
   for **their own tenant's leads** — they need the number to place a call, and
   the Copilot system prompt legitimately requires it. FirstName + last initial
   applies to: content written into the KB, prompts composed and sent to Vapi,
   and anything surfaced across agents or tenants. Never send a full surname to
   a third-party model or store one in indexed KB content.
9. **Vapi is write-only.** Never read config back from Vapi, never sync in
   reverse. Supabase is the record.
10. **One dial stack.** Everything goes through `src/lib/vapi/dial.js`. Do not
    create a fourth. Locked params live there and callers cannot override them.
11. **Phone test calls only ever dial the authenticated agent's own `wa_phone`.**
    Never a destination from the request body. In-tab **Talk here** is a WebRTC
    test on the same locked firstMessage / prompt / voice; it is not a live
    lead call and still must not accept a destination number.

## Design tokens

`globals.css` holds the **DXB Dip** palette (`--hot`, `--cyan`, `--amber`).
**Extend it — do not start a second system.**

Before writing any component: audit `globals.css`, map the semantic roles below
onto tokens that already exist, and add only what is genuinely missing, using
the same naming convention as the tokens already there.

| Role | Meaning | Likely source |
|---|---|---|
| surface / surface-2 | card and raised backgrounds | existing |
| ink / ink-2 / ink-3 | primary, secondary, muted text | existing |
| rule / rule-2 | borders and dividers | existing |
| **live** | connected, qualified, **published**, healthy | *probably missing — a green does not exist in DXB Dip. Add one.* |
| **warn** | draft, scheduled, unsaved, needs attention | `--amber` |
| **markup** | destructive, opted-out, error | `--hot` |

Never hardcode a hex in a component. The chat page's `slate-950` / `emerald-500`
utilities are not a system — do not propagate them.

Type: DM Sans is already the root font; keep it. IBM Plex Mono is already loaded
globally — use it for uppercase section labels (9.5–10px, `.16em` tracking),
data, and counters. Do not add Archivo or Source Serif 4.

Secondary buttons are dotted-border; primary is filled.

## Conventions

- Server Components by default. `'use client'` only for real interaction state.
- Every list query is scoped by `tenant_id`. Assume a hostile client.
- Skeleton rows matching real row height, not spinners, for anything over 2s.
- Empty states name the next action.
- Money in AED, times in the agent's timezone (default `Asia/Dubai`).
- Phone numbers stored and compared in E.164.
- Publishes are logged: `script_id`, `version_no`, `agent_id`, `PREAMBLE_VERSION`.

## Decisions taken after the codebase audit — these override the other docs

- **One WhatsApp number per tenant.** Coexistence lives at tenant
  level (`waba_id` on `tenants`). There is no per-agent `waba_id`. Agents
  are identified by who is texting the tenant number. **Join starts with
  Connect WhatsApp** (Meta Embedded Signup) when the tenant is not yet
  connected, with copy that we are a Meta tech provider and traffic goes
  through Meta. Already-connected tenants skip that step. No per-agent
  sync screen. Do not put `waba_id` on agents.
- **The web chat at `/copilot/[tenant]` is being removed.** A web chat duplicates
  WhatsApp and violates the governing rule. The console home takes that route.
  Confirm nobody is actively using it before deleting.
- **Keep the two lead universes separate.** `leads` is campaign/cold; `jarvis_leads`
  is the agent's personal WhatsApp inbox. Migration 010 split them deliberately.
  Never merge them or write Coexistence contacts into `leads`.
- **A "call run" needs a parent.** `call_queue` is flat rows with no `batch_id`.
  The console's run results page cannot exist without one — add `batch_id` to
  `call_queue` plus a thin `call_batches` table. Do not build a second queue.
- **`startLeadCall` currently accepts arbitrary `assistantOverrides` and
  `variableValues`.** Phase 0 must close that: locked params are stripped from
  caller input, not merely defaulted.
- **Batch confirmation is currently only required above 100 leads.** Constraint 6
  makes it mandatory for every script-invoked batch. Tighten it in Phase 7.
- **Relay is a fourth persona** (`VAPI_RELAY_ASSISTANT_ID`) that Phase 6's seed
  list does not name. Either seed it as a fifth script or explicitly exclude it
  and say why.

## Already decided — don't redesign

- Cap of **5 non-archived scripts per tenant**. 409 past that.
- Every tenant seeds **4 scripts** (`is_seeded: true`): cold list, re-engage,
  viewing reminder, post-viewing feedback. A new agent never sees an empty page.
- **Restore creates a new version and republishes.** It never mutates an old
  version row and never silently edits the draft.
- Scripts are tenant-shared. Editing is never private. That is why versioning
  with authorship exists.

## WhatsApp live-ingestion recovery — 2026-09-04 incident

Keep the three independent connections straight:

- **Agent → AgentZero chat:** Twilio `/api/whatsapp`.
- **Reasoning and calls:** Anthropic + Vapi.
- **Business inbox memory:** Meta Coexistence → `/api/meta/webhook` → Supabase.

Calls working does not prove inbox ingestion is working. Stored history can also
make recall appear healthy after the live feed has stopped.

### Symptoms and diagnosis

The Sterling inbox stopped ingesting after 2026-08-29 while AgentZero could
still reply and place calls. The connection popup then showed:

> Facebook Login is currently unavailable for this app, since we are updating
> additional details for this app.

The frontend popup was not broken. It loaded the Meta SDK and called Embedded
Signup with public App ID `1570152774498547` and configuration ID
`876480732206183`. Meta rejected the app before returning an authorization code.

In Meta's **Connect with customers through WhatsApp** use-case testing,
`whatsapp_business_management` and `whatsapp_business_messaging` were complete,
but `business_management` showed `0 of 1 API call(s) required`.

### Exact Meta test that unblocked signup

1. Open **Tools → Graph API Explorer** and select the **AgentZero** app.
2. Under permissions, add **`business_management`**. This is not
   `whatsapp_business_management` or `whatsapp_business_messaging`.
3. Generate a new **User Access Token** and approve AgentZero's access to the
   relevant current and future Businesses and WhatsApp accounts.
4. In the request field enter exactly `me/businesses`. The method dropdown
   already says `GET`; entering `GET /me/businesses` produces OAuth error 2500.
5. Submit the request. A successful response containing a `data` array counts,
   including an empty array. During this incident it returned the accessible
   business portfolios and satisfied the missing test.
6. Return to the WhatsApp use-case testing page and refresh. Meta says test
   completion can take up to 24 hours to register.
7. Retry **Connect WhatsApp** in AgentZero and complete Embedded Signup. Success
   must end with **“WhatsApp connected and webhooks subscribed.”**

An access token is a secret. Never paste it into chat, screenshots, logs, docs,
or commits. If exposed, revoke it and generate a replacement.

### Safe production verification

Check that onboarding stored all three Meta values without selecting the values:

```sql
select
  (waba_id is not null) as waba_stored,
  (phone_number_id is not null) as phone_id_stored,
  (business_token is not null) as token_stored
from tenants
where slug = 'sterling';
```

All three must be true. Then send one message in each direction and verify fresh
rows arrive:

```sql
select
  max(timestamp) as latest_message_at,
  max(created_at) as latest_ingested_at,
  count(*) filter (
    where created_at >= now() - interval '1 hour'
  ) as ingested_1h
from "whatsapp-messages"
where tenant_id = (select id from tenants where slug = 'sterling');
```

After the fix, an inbound and outbound message sent at about 09:15 Dubai time
were stored within roughly three seconds. That proved live ingestion was back.

### Do not confuse recall windows with connection health

At verification time Sterling had 4,941 searchable messages across 183 inbox
threads, dating back to 2026-07-09. A claim that AgentZero only knows the last
“4–5 days” was therefore not a connection failure. Recent-activity tools are
bounded: `get_inbox_activity` defaults to 72 hours and inbox-window queries clamp
to 14 days, while person/story and text searches can read older stored history.

Use database ingestion timestamps—not an LLM statement about its context
window—to decide whether Meta is connected.

## Development & test identity

- **`test-auth` on tenant `az-test` is the permanent development agent — not
  ephemeral test data.** Do not delete it, and never confuse it with the
  production client agents or tenants. Its email is `ejlalshah312@gmail.com`,
  and the Google/Supabase Auth user behind that address is the account used
  for development sign-in testing (`agents.auth_user_id` links the two).
- `az-test` stays disconnected from WhatsApp and Vapi, and never holds
  production data, seeds, or leads.
- Future auth testing uses this account by default. Create a fresh test user
  only when a task specifically requires one (e.g. first-time link flows),
  via `scripts/create-test-agent.mjs` — never by editing production rows.
