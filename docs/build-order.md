# Build order — paste these into Cursor one at a time

Two tracks. **Track A is the backend prompt (Phases 0–8) and it comes first.**
Track B is the rest of the console, which depends on A's auth, dial path and
schema being settled.

Do not paste more than one phase or step per message. After each: run it, click
it, commit it. If a step produces more than ~4 files, stop and split it.

Every prompt assumes `AGENTS.md`, `docs/backend-scripts-prompt.md` and
`docs/web-console-spec.md` are in the repo and attached to context.

---

## Step 0 — DONE

The audit ran and found nine contradictions. All four docs have been corrected
against it. The decisions taken are recorded under **"Decisions taken after the
codebase audit"** in `AGENTS.md` and override anything else.

Summary of what changed:

| Audit found | Resolution |
|---|---|
| No console design system; DXB Dip palette + slate/emerald chat page | Extend DXB Dip tokens. Primitives get defined in Phase 8. |
| `/copilot/[tenant]` is a live web chat | Remove it. Console home takes the route. Confirm nobody's using it first. |
| Auth is username, not email | Phase 1 authenticates by `username`. Email is an optional column. |
| `opted_out` missing; Copilot needs full phone numbers | Constraint 8 is now scoped — full data to the owning agent, last-initial in KB and Vapi prompts. |
| `zod` not installed | `npm i zod` before Phase 2. |
| Service-role client bypasses RLS | Tenant isolation is application-layer via `getSession()`. RLS is defence in depth only. |
| recharts + modals ship in DXB Dip | Constraints 2 and 3 scoped to `src/app/copilot/**`. |
| WABA is tenant-level | No per-agent connect. Setup wizard drops to two steps. |
| `leads` vs `jarvis_leads` are deliberately split | Never merge. Coexistence contacts stay in `jarvis_leads`. |
| `call_queue` is flat, no `batch_id` | New `call_batches` + `batch_id`, added in Track B. |

---

# TRACK A — the Scripts feature

Run these straight from `docs/backend-scripts-prompt.md`. It is written as a
sequence; use its own phase text as the prompt.

| Phase | What | Notes |
|---|---|---|
| **0** | Consolidate to one dial stack | Blocks everything. Nothing starts until the three Vapi paths are one and the locked params live in `dial.js`. Report what broke. |
| **1** | Agent identity | `getSession()` lands here. Track B's every route depends on it. |
| **2** | Schema | `scripts`, `script_versions`, `call_queue`/`calls` columns, zod shape. |
| **3** | Prompt composer | `compose.js`. The spoken prompt moves into the repo. |
| **4** | Vapi assistant lifecycle | `upsertVapiAssistant` in `dial.js`, write-only. |
| **5** | API routes | Publish order is exact — do not let Cursor reorder it. |
| **6** | Queue and worker | Attribution columns, resolution order, seed migration. |
| **7** | WhatsApp + Copilot resolution | `resolve.js`, both tool loops, mandatory confirmation. |
| **8** | Scripts console UI | List + editor + sticky action bar + version history. |

Three places to watch Cursor closely:

**Phase 0.** It will want to leave the old dial paths in place "for safety".
Make it delete them. A fourth stack appears the moment two survive.

**Phase 5, publish order.** Steps 3 and 4 must stay in that order — version row
written first, Vapi call second, transaction third. If it inverts them you get
a live assistant pointing at an unpublished version. Add to the prompt:
*"Walk me through what the database and Vapi look like if step 4 throws."*

**Phase 8, the design system.** The brief says "match the existing console
visual system" — the audit proved there isn't one. Phase 8 is where the
primitives get invented, and every Track B screen inherits them. Add to the
prompt: *"Extract Button, Pill, Row, Field, Label, Stat, Toggle, Check and Strip
into `src/components/ui/` as you build this, generic enough that a run or a lead
can use them. Do not hardcode script-specific props into Row."*

Before Phase 2: `npm i zod`.

---

# TRACK B — the rest of the console

Start after Phase 8 is merged. You need `getSession()` from Phase 1 and the
primitives from Phase 8.

## B0 — Remove the web chat

> Confirm with me who is using `/copilot/[tenant]` (the ops chat page) before
> touching it. Then remove the chat page and free the route for the console
> home. Keep `/api/copilot/[tenant]/chat` — the tool loop behind it is still
> used by WhatsApp. Only the web UI goes.

**Do not run this until you've actually checked usage.** It's the one
irreversible step in the whole build.

## B1 — Primitives audit

> List every component Phase 8 created under `src/components/` and map them to
> the primitives table in §2 of `docs/web-console-spec.md`. Tell me which exist,
> which need generalising, and which are genuinely new. Do not write components
> we already have under another name.

## B2 — call_batches

> Add `call_batches` and `batch_id` on `call_queue` per §1 of the console spec.
> `queueLeadCalls` creates the batch row and stamps `batch_id` on every queue
> row it inserts, alongside the `script_id` / `script_version_id` from Phase 6.
> The worker rolls counts up onto the batch as rows complete.
>
> Do not build a second queue. This is only the grouping above `call_queue`.

**Accept when:** an existing Copilot cold batch produces one `call_batches` row
with N queue rows pointing at it.

## B3 — Lead enrichment columns

> Add the missing columns to `leads` per §1: `opted_out`, `opted_out_at`,
> `intent_score`, `budget`, `finance_type`, `timeline`, `areas`, `bedrooms`,
> plus the index. Keep `push_name` and full E.164 — constraint 8 is scoped.
>
> Do not touch `jarvis_leads`. The two lead universes stay separate.
>
> Then make every existing call path filter `opted_out`, and capture opt-out
> from call outcomes so it actually gets set.

## B4 — Home

> Build the console home at `/copilot/[tenant]` per §3. Two status booleans,
> one primary action, recent runs as `Row`s reading from `call_batches`, with
> the script name linking to its editor. No charts, no conversion rates.

## B5 — Setup wizard

> Build the two-step `/join` wizard per §3. Profile + KB upload, then the
> morning brief with "Send me one now". No connect step, no sync step —
> WhatsApp is tenant-level and already live.

## B6 — Call runs

Two prompts, never one.

> Build the run builder per §3. Source, filters with a live match count that
> **shows exclusions explicitly**, script picker listing **live scripts only**,
> time window, and a confirm card stating caller ID, AI disclosure and AED
> estimate directly above the commit button. On submit it creates a
> `call_batches` row and enqueues.

> Build the run results page per §3. Read from `calls`, not `call_queue` —
> attribution is copied there at dial time so it survives queue cleanup.
> `extracted` fields render from the script version's `find_out` shape.

## B7 — KB, how-it-works, settings

> Build the remaining three screens per §3.

## B8 — Morning brief

> Build the brief job: overnight pipeline scan, ranked by `intent_score`, sent
> at `brief_time` in the agent's `tz`. Both this and the end-of-run summary can
> land outside WhatsApp's 24-hour service window and need approved templates —
> implement the template path, don't assume free-form will work.

---

## When Cursor goes off the rails

- **"Re-read the hard constraints in AGENTS.md and tell me which one you just
  broke."** Works better than describing the bug.
- **"You're touching more than four files. Stop, and tell me the smallest first
  slice."**
- **"Don't refactor anything I didn't ask you to touch. Show me the file list
  before you write."**

Pin this one: if it generates a modal, a chart, a temperature slider, a second
dial path, a Vapi read/sync, or writes Coexistence contacts into `leads`, it has
stopped reading the rules file. Start a fresh session rather than arguing.
