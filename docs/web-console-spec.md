# AgentZero web console — spec

Covers the console screens **not** owned by `docs/backend-scripts-prompt.md`.

> **Scripts is out of scope here.** The backend prompt owns the Scripts feature
> end to end — schema, prompt composer, Vapi lifecycle, API routes, queue
> attribution, WhatsApp resolution, and the Scripts list/editor UI including the
> sticky action bar and version history. Build it from that document. Nothing in
> this file overrides it.
>
> This file covers: **setup wizard, home, call runs, run results, KB, settings.**

Everything here inherits the rules in `AGENTS.md`: multi-tenant with `tenant_id`
on every query, `getSession()` on every route, Vapi not Bland, no modals, no
charts, no exposed call parameters.

---

## 1. Data model

The Scripts tables (`scripts`, `script_versions`) and the alterations to
`call_queue` and `calls` are defined in the backend prompt, Phase 2. Do not
redefine them.

These are the console-only additions. Standard columns on all:
`id uuid pk default gen_random_uuid()`, `tenant_id uuid not null references
tenants(id)`, `created_at timestamptz default now()`. RLS scoped to session
tenant.

### agents — additions to the existing table
Phase 1 of the backend prompt adds `email`, `role`, `password_hash`,
`last_login_at`. The console adds only profile and brief preferences:

`areas text[]`, `ticket_min int`, `ticket_max int`, `languages text[]`,
`team text`, `brief_enabled bool default true`,
`brief_time time default '07:30'`, `tz text default 'Asia/Dubai'`

**No `waba_id`, `phone_number_id` or `coex_status` on agents.** WhatsApp is
connected once per tenant and those columns already live on `tenants`. Do not
duplicate them.

### kb_documents
`owner_agent_id fk agents`, `scope text` — `private | tenant`,
`filename text`, `storage_path text`, `bytes int`,
`parsed_at timestamptz`, `index_status text` — `queued | parsing | indexed | failed`

### kb_doc_hidden
`agent_id fk`, `doc_id fk`, unique together. The opt-out for inherited tenant
docs. Absence of a row means visible.

### Two lead universes — keep them separate
`leads` is the campaign/cold universe (portal imports, purchased lists,
`queueLeadCalls`). `jarvis_leads` is the agent's own WhatsApp inbox. Migration
010 split them on purpose. **Never merge them, and never write Coexistence
contacts into `leads`.**

Both currently carry `push_name` + `wa_id`, not the shape this spec originally
assumed. Add only what is missing, to `leads`:

`opted_out bool default false`, `opted_out_at timestamptz`,
`intent_score int`, `budget numeric`, `finance_type text`, `timeline text`,
`areas text[]`, `bedrooms text`

Index `(tenant_id, opted_out, last_message_at desc)`.

Keep `push_name` and full E.164. Per constraint 8, an agent sees full contact
details for their own tenant's leads — the split applies to what gets written
into the KB or sent to Vapi, not to what the agent reads.

### call_batches — genuinely new, and Track A does not provide it
`call_queue` is flat rows with a `source` string. There is no `batch_id` and no
parent. The run results page cannot exist without one.

Add `batch_id uuid references call_batches(id)` to `call_queue`, and:

```
call_batches
  tenant_id fk, agent_id fk, script_id fk, script_version_id fk,
  source_type text, filter jsonb,
  window_start timestamptz, window_end timestamptz,
  status text, est_cost_aed numeric, counts jsonb
```

Do not build a second queue. `call_queue` stays the unit of work; this is only
the grouping above it.

---

## 2. Shared primitives (`src/components/ui/`)

**A console visual system already exists under `/copilot/[tenant]`.** Audit it
first. Only build what is missing, and match what is there.

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost'`, `size`, `as` | ghost = dotted border, primary = filled |
| `Pill` | `tone: 'neutral' \| 'live' \| 'warn' \| 'markup'` | uppercase mono 9.5px |
| `Row` | `title`, `sub`, `right`, `leading`, `onClick` | the universal list row — runs, scripts, leads, KB docs, versions all use it. Must not know what any of those are. |
| `Field` | `label`, `value`, `onClick`, `filled`, `right` | bordered input-looking box |
| `Label` | | uppercase mono section label |
| `Stat` | `n`, `label`, `tone` | tabular number + mono caption. Never more than three. |
| `Drop` | `accept`, `onFiles` | dashed drop zone |
| `Toggle` / `Check` | `checked`, `onChange`, `locked` | |
| `Strip` | `tone`, `children`, `onDismiss` | inline confirm/status bar. **This is what replaces modals.** |

---

## 3. Screens

### `/copilot/[tenant]/join` — setup wizard
Linear, no nav chrome, resumable. WhatsApp is **one number per tenant**.
If the tenant is not connected, **step 0 is Connect WhatsApp** — Meta
Embedded Signup, with copy first: AgentZero sits on the existing business
number; we are an official Meta tech provider; messages go through Meta’s
Cloud API; the app is Meta-verified. Then the button. Already-connected
tenants skip this step. There is no per-agent connect and no sync screen.

Progress ticks: connect (if needed) → profile → brief.

**About you, and your material.** Profile: name, team, areas covered,
typical ticket range, languages. Every field must change what AgentZero says or
it doesn't belong. Then tenant material upload — price lists, payment plans,
brochures — with inherited `scope: 'tenant'` docs shown pre-ticked and
untickable-to-hide. Skippable.

**Morning brief.** Prose explaining the overnight pipeline scan. One
toggle, one time. Then **"Send me one now →"**, which builds a real brief from
real pipeline data and pushes it to their WhatsApp. This is the activation
moment — an agent who receives one live brief during setup is a retained agent.
Final button is a WhatsApp deep link. There is no "go to dashboard".

### `/copilot/[tenant]` — home
**This route currently serves the web ops chat, which is being removed.** The
console home replaces it. Confirm nobody is actively using the chat before
deleting it, then take the route.

Status strip: two booleans (tenant WhatsApp healthy / brief on), amber if
degraded. If WhatsApp is not connected, the primary action is Connect WhatsApp
(join). There is no per-agent connection state to show.
One primary action: New call run. Secondary: Add material to your KB. Muted text
link: Edit your scripts →. Then recent runs as `Row`s, with the script name in
each sub-line linking to that script's editor. Persistent footer link back to
WhatsApp. **No charts.**

### `/copilot/[tenant]/runs/new` — call run builder
Target 90 seconds. Source (upload / from your WhatsApp / saved segment — default
the middle) → filter chips with a live match count that **shows exclusions
explicitly** ("3 excluded (opted out), 1 excluded (called Tuesday)") → script
picker, defaulted from source type, listing live scripts only → time window →
confirm card stating caller ID, AI disclosure and AED estimate, directly above
the commit button. Secondary: "Test on my own number first".

At enqueue, write `script_id` and `script_version_id` onto every `call_queue`
row per Phase 6. Set once, never updated.

### `/copilot/[tenant]/runs/[id]` — results
Three stats, qualified in `live` green. Rows, worth-your-time first. Expanding a
row shows one quoted sentence from the lead, then recording and transcript.
`extracted` fields render as the sub-line — the shape comes from the script
version's `find_out`, which is why it is typed. Footer: Export CSV + "Send the N
to my WhatsApp".

Results are already pushed to WhatsApp on run completion. This page is the
archive, not the notification. Mind the 24-hour service window — a run finishing
more than 24h after the agent's last message needs an approved template.

### `/copilot/[tenant]/kb`
Upload + list. Inherited tenant docs get a `live` "Inherited" pill and a hide
control. Own docs get "Share with tenant" flipping `scope`.

### `/copilot/[tenant]/how-it-works`
Static. A styled chat transcript of a real morning, not a feature list. Four
commands: ask about a lead · `call <name>` · `summary` · `call my <list> with
the <script> script`. **The same four must be returned by typing `help` in
WhatsApp** — an agent who needs the cheat sheet is on their phone.

### `/copilot/[tenant]/settings`
Number, brief time and timezone, data export, disconnect. Minimal.

---

## 4. Two things the console must not get wrong

**Script selection in the run builder lists live scripts only.** A draft cannot
be dialled. If an agent picks a script that gets archived before the window
opens, the run fails loudly rather than falling back to a default — same rule as
the WhatsApp resolver in Phase 7.

**Attribution is set at enqueue and never updated.** `script_id` and
`script_version_id` are copied onto the `calls` row at dial time so outcomes stay
traceable after queue rows are cleaned up. The results page reads from `calls`,
not `call_queue`.
