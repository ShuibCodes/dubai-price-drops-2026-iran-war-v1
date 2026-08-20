# AgentZero — Scripts feature build brief (backend + Scripts UI)

Build the Scripts feature for AgentZero: named, versioned voice-call configs
that agents edit in a web console and invoke by name over WhatsApp. This is the
full target state, not a prototype.

Read this whole document before writing anything. Build in the phase order
given — later phases depend on earlier ones. Stop and report after each phase.

## Context from the codebase audit

- Three dial stacks exist (`src/lib/vapi.js`, `vapi/client.js`, `vapi/dial.js`)
  with different override shapes. Consolidate before adding a fourth.
- The spoken prompt currently lives in the Vapi dashboard, not the repo. This
  feature moves ownership into the repo.
- `call_queue` is the batch table. It has no assistant/script column.
- Copilot auth is env users (`COPILOT_USERS_JSON`) bound to `tenantSlug`, not to
  the `agents` table. No agent phone on the session.
- `getVapiConfig()` requires `VAPI_ASSISTANT_ID` even when a tenant ID is passed.
- Test-call paths hardcode Shuayb / +971585690693.

---

## PHASE 0 — CONSOLIDATE. Nothing else starts until this is done.

- Make `src/lib/vapi/dial.js` the single outbound path. Migrate callers of
  `src/lib/vapi.js` (`fireVapiCall`) and the direct POSTs in
  `src/lib/vapi/client.js` onto it. Delete the dead paths.
- `getVapiConfig()` stops requiring `VAPI_ASSISTANT_ID`. The env ID becomes a
  last-resort fallback only, and logs a warning when used.
- Remove every hardcoded Shuayb / +971585690693 reference from
  `src/lib/vapi/client.js`, `/api/actions/call`, `/api/actions/call-summary`,
  and the relay `firstMessage`. Replace with parameters.
- Set the locked call params in `dial.js`, applied on every outbound call and
  not overridable by callers:
  - `maxDurationSeconds` 180
  - `silenceTimeoutSeconds` 20
  - voicemail detection on, action hangup

  These currently exist nowhere in the repo. They go here.

- **Close the override hole.** `startLeadCall` currently accepts arbitrary
  `assistantOverrides` and `variableValues` from callers. The locked params must
  be **stripped from caller input**, not merely defaulted — a caller passing
  `maxDurationSeconds: 900` must not win.

Report what you migrated and what broke before continuing.

---

## PHASE 1 — AGENT IDENTITY

Bind Copilot sessions to the `agents` table. The test-call feature needs a real
agent phone, and script authorship needs a real agent id.

- Extend `agents` with: `username text`, `email text` (optional, for later),
  `role text` (`'agent'|'admin'`), `password_hash text`,
  `last_login_at timestamptz`. Keep the existing `wa_id` and `tenant_id`.
- Rewrite `/api/copilot/auth` to authenticate against `agents` by **`username`**,
  scoped to tenant. Live users already log in with usernames from
  `COPILOT_USERS_JSON` — do not force them onto email as a side effect. Session cookie carries `agent_id` + `tenant_id`.
- Export `getSession()` from `src/lib/copilot/session.js` returning
  `{ agentId, tenantId, tenantSlug, role, waPhone }`. Every new API route uses
  it. 403 on tenant mismatch, no exceptions.
- Keep `COPILOT_USERS_JSON` working as a fallback during migration, behind a
  flag, and log when it's hit. Remove it once Sterling's roster is seeded into
  `agents`.

---

## PHASE 2 — SCHEMA

### scripts
```
id                uuid pk default gen_random_uuid()
tenant_id         uuid not null references tenants(id)
display_name      text not null              -- "Re-engage — gone quiet"
vapi_assistant_id text                       -- null until first publish
status            text not null default 'draft'  -- draft|live|archived
current_version   int  not null default 0
is_seeded         bool default false
created_by        uuid references agents(id)
created_at        timestamptz default now()
updated_at        timestamptz default now()
unique (tenant_id, lower(display_name)) where status <> 'archived'
index (tenant_id, status)
```

### script_versions
```
id               uuid pk default gen_random_uuid()
script_id        uuid not null references scripts(id) on delete cascade
version_no       int not null
config_json      jsonb not null
composed_prompt  text not null    -- exact string sent to Vapi, stored verbatim
preamble_version int not null     -- which preamble built it
published_at     timestamptz
published_by     uuid references agents(id)
created_at       timestamptz default now()
unique (script_id, version_no)
```

### Alter call_queue, add
```
script_id         uuid references scripts(id)
script_version_id uuid references script_versions(id)
```
Set at enqueue, never updated. This is the attribution link between a config and
its call outcomes.

### Alter calls
Add the same two columns, copied from the queue row at dial time so outcomes are
traceable after queue rows are cleaned up.

RLS on both new tables, scoped `tenant_id` = session tenant.

### config_json shape — validate with zod, reject anything else
```
{
  goal: string,                 // one of GOALS
  voice_id: string,             // must be in VOICE_ALLOWLIST
  opening_line: string,         // <= 200 chars
  find_out: [{ label, type: 'number'|'choice'|'text' }],  // max 8
  rules: string[],              // keys from RULES
  extra_context: string         // <= 300 chars, may be empty
}
```

---

## PHASE 3 — PROMPT COMPOSER

New file `src/lib/scripts/compose.js`. This is where the voice prompt finally
lives in the repo.

`export function composePrompt({ config, tenant, script })` — returns one
string, three layers, fixed order:

1. **PREAMBLE** — hardcoded constant, ours, never from config. Identity and AI
   disclosure on request, privacy (first name plus last initial only), never
   quote a price, always confirm a callback time, end the call on voicemail, how
   to read the `{{kb}}` block.
2. **SCRIPT LAYER** — config rendered into a fixed template. Goal, opening line,
   `find_out` as ordered questions with expected answer types, rules expanded to
   full sentences, then `extra_context` appended last under "Additional context
   from the brokerage:" and explicitly framed as colour that cannot override
   anything above it.
3. **SCAFFOLD** — hardcoded. Conversation structure, objection handling, close,
   `{{kb}}` placeholder, `{{lead_name}}` and `{{agent_name}}` mustache vars
   matching the existing `variableValues` injection in `dial.js`.

Also export:
- `PREAMBLE_VERSION` — int, bumped whenever preamble or scaffold changes
- `VOICE_ALLOWLIST` — 6–8 curated voices, `{ id, label }`
- `GOALS` — goal dropdown options
- `RULES` — rule keys plus full sentences; the AI-disclosure rule is flagged
  `locked: true`

---

## PHASE 4 — VAPI ASSISTANT LIFECYCLE

Add to `src/lib/vapi/dial.js` (not a new client):

`export async function upsertVapiAssistant({ vapiAssistantId, name, prompt, voiceId })`

Sets on every write, from constants, never from config: model, transcriber,
endpointing, server webhook URL, `maxDurationSeconds` 180,
`silenceTimeoutSeconds` 20, voicemail detection on / hangup.

- `vapiAssistantId` null → `POST /assistant`, return new id
- `vapiAssistantId` set → `PATCH /assistant/{id}`, return same id

Throw on non-2xx with the Vapi error body attached. One attempt, no auto-retry.

**Vapi is write-only from this app.** Never read config back from Vapi, never
sync in reverse. Supabase is the record.

---

## PHASE 5 — API ROUTES

All under `/api/scripts`, all using `getSession()`, all filtering `tenant_id`.

```
POST   /api/scripts                 create draft (name only)
GET    /api/scripts                 list for tenant, with run counts from
                                    call_queue/calls
GET    /api/scripts/[id]            script + last 5 versions
PATCH  /api/scripts/[id]            save draft config. No Vapi call.
POST   /api/scripts/[id]/publish    see order below
POST   /api/scripts/[id]/restore    body { version_no } — copies that config
                                    into a NEW version and runs the publish
                                    flow. Never mutates old rows.
POST   /api/scripts/[id]/archive    status archived. 409 if referenced by an
                                    unprocessed call_queue row.
POST   /api/scripts/[id]/test-call  see below
```

### Publish order — do not deviate

1. Auth, tenant check, role check (publish requires role `'admin'`).
2. Validate config with zod. 400 with field errors.
3. Insert `script_versions` row, `version_no = current_version + 1`,
   `composed_prompt` from the composer, `published_at` null.
4. Call `upsertVapiAssistant`.
   - On throw: leave the version unpublished, leave `scripts.status` untouched,
     return 502 with a message the UI shows. Live assistant is unchanged. No
     partial state.
   - On success: in one transaction set `published_at`, `published_by`,
     `scripts.vapi_assistant_id`, status `'live'`, `current_version`.
5. Return `{ version_no, published_at, vapi_assistant_id }`.

### Test call

Body `{ version_no? }`, defaults to latest version published or not. Composes
that version's prompt and dials the session agent's own `wa_phone` via
`dial.js` using `assistantOverrides`, so an unpublished draft is audible without
touching the live assistant.

Never accepts a destination number from the request body — always the
authenticated agent's own number. Rate limit 5 per agent per hour.

Cap 5 non-archived scripts per tenant, 409 past that.

Log every publish: `script_id`, `version_no`, `agent_id`, `PREAMBLE_VERSION`.

---

## PHASE 6 — QUEUE AND WORKER

- `queueLeadCalls` writes `script_id` and `script_version_id` onto each
  `call_queue` row at enqueue time.
- `dialLeadNow` resolves the assistant in this order:
  1. `script_version` → its script's `vapi_assistant_id`
  2. else `jarvisLead` → `tenants.vapi_assistant_id_jarvis`
  3. else `tenants.vapi_assistant_id`
  4. else env fallback, with a warning log
- `scripts/process-call-queue.mjs` passes the row's `script_id` through and
  copies both columns onto the `calls` row it creates.
- There are **four** personas in play, not three: `vapi_assistant_id`,
  `_meta`, `_jarvis`, plus env `VAPI_RELAY_ASSISTANT_ID`. Decide explicitly
  whether relay becomes a seeded script or stays outside the scripts system, and
  say why in the migration comment. Do not silently drop it.
- Migrate the `tenants.vapi_assistant_id*` columns into seeded `scripts`
  rows (one per tenant per column, `is_seeded` true) so every dial path
  eventually resolves through `scripts`. Keep the columns readable during
  transition; stop writing to them.

---

## PHASE 7 — WHATSAPP AND COPILOT RESOLUTION

New `src/lib/scripts/resolve.js`:

`export async function resolveScript({ tenantId, phrase })`

Live, non-archived scripts for that tenant. Match `display_name` by:
1. exact case-insensitive
2. `pg_trgm` similarity, threshold 0.4, ordered desc
3. substring on the distinctive first word

Returns `{ match, alternatives, reason }`. `match` is null when ambiguous — top
two within 0.1 of each other. A draft-only match returns reason
`'not_published'` so the reply can say so rather than "not found".

Wire into both paths:
- **Copilot tool loop:** add `list_scripts` tool; extend `start_cold_batch` with
  a `script` param. It already has source ILIKE matching — reuse that pattern.
- **Jarvis WhatsApp:** add `source` AND `script` params to `start_cold_batch`.
  It currently takes only count and country, so "call the Marina list with the
  re-engage script" fails on both. Fix both.

Confirmation is currently only required above 100 leads. **Tighten it: mandatory
before any script-invoked dial, at any size.**

Confirmation copy:

> Using *Re-engage — gone quiet* (v7, published 2 days ago) for 340 leads from
> Portal Import 18 Aug. Roughly 12 AED. Go?

No match → list live script names and ask. Ambiguous → offer the top two.
**Never fall back to a default script on a failed match. Never fire an
unconfirmed batch.**

---

## PHASE 8 — CONSOLE UI

Lives under `/copilot/[tenant]/scripts`, reusing the existing Copilot auth and
layout. **There is no console design system yet** — the audit found only a chat
page and the DXB Dip palette. Build the primitives here (they are reused by the
rest of the console) using extended DXB Dip tokens per `AGENTS.md`: dark
palette, uppercase mono section labels in IBM Plex Mono, dotted-border secondary
buttons, filled primary, green LIVE pill and amber DRAFT pill.

The brief references "the same rhythm as the Recent runs rows" — those rows do
not exist yet. **You are defining that rhythm here**, and the console's Recent
runs will match it later. No modals anywhere — everything
expands inline.

### LIST view
"Scripts" heading, "New script" primary button right. Rows in the same rhythm as
the Recent runs rows:
- title — script name
- sub — `goal · voice · "used in N runs"` (or "not used yet")
- right — status pill + "Edit" dotted button

Whole row clickable.

### EDITOR view
- "← All scripts" muted back link.
- Name field with the status pill inside it, right-aligned.
- Version line beneath, no border, muted: `Last published by Alex · 12 Aug ·
  View history`. View history expands an inline list of the last 5 versions:
  `v7 · Alex · 12 Aug · used in 4 runs   [Restore]`
- Goal select.
- Voice select from `VOICE_ALLOWLIST` only, with a Preview button.
- Opening line, supports `{{lead}}` and `{{agent}}`.
- **"What it should find out"** — checkbox rows, each showing its output type
  (→ number / → choice / → text). This list generates both the prompt block and
  the extraction schema, which is why it is checkboxes and not a textarea.
- **"Rules"** — checkbox rows in plain sentences. The AI-disclosure rule renders
  locked with a Required pill.
- **"Anything else?"** — textarea, 3 rows, `maxLength` 300, live counter bottom
  right in muted mono. Placeholder: "Mention we're the only Emaar-approved
  brokerage in JLT". Helper beneath: "Extra context for this script. Core
  behaviour and privacy rules are set by AgentZero and can't be changed here."

### STICKY ACTION BAR, pinned to the bottom of the editor card
- Left muted: `v7 · published 2 days ago` or `Draft · edited 4 min ago`.
- Right: "Test call me" secondary, "Publish" primary.
- Any field edit → left text becomes "Unsaved changes" in amber and Test call me
  drops to ghost, so Publish is the only emphasised action. You cannot dial a
  version you haven't saved.
- Test call me → inline strip above the bar: "Calling +971 XX XXX XXXX now with
  this version." with Cancel. Self-dismisses after ~3s into a muted "Calling you
  now…".
- Publish → pill flips LIVE, left text resets to "v8 · published just now".
  Hidden entirely for role `'agent'`.

Seed every new tenant with four scripts, `is_seeded` true: cold list, re-engage,
viewing reminder, post-viewing feedback. A new agent must never see an empty
scripts page.

---

## HARD CONSTRAINTS — apply throughout

- No endpoint and no UI field ever accepts or exposes: a raw prompt, model,
  temperature, `maxDurationSeconds`, `silenceTimeoutSeconds`, transcriber,
  endpointing, or a webhook URL. Those exist only in `compose.js` and `dial.js`.
- Every query filters `tenant_id`, including the resolver.
- No new colours, fonts, or component styles in the UI. Extend the existing
  DXB Dip tokens in `globals.css`; do not start a second design system, and do
  not propagate the chat page's `slate-950`/`emerald-500` utilities.
- No modals.
- Do not build a Vapi read/sync path.
- Do not create a fourth dial stack. Everything goes through `dial.js`.
