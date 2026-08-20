# Build order — paste these into Cursor one at a time

Two tracks. **Track A is the backend prompt (Phases 0–8) and it comes first.**
Track B is the rest of the console, which depends on A's auth, dial path and
schema being settled.

Do not paste more than one phase or step per message. After each: run it, click
it, commit it. If a step produces more than ~4 files, stop and split it.

Every prompt assumes `AGENTS.md`, `docs/backend-scripts-prompt.md` and
`docs/web-console-spec.md` are in the repo and attached to context.

---

## Step 0 — Ground rules (run once, first message of a new session)

> Read `AGENTS.md`, `docs/backend-scripts-prompt.md` and
> `docs/web-console-spec.md` in full before writing anything. Then, without
> writing code, tell me in ten bullets: the governing rule of this product, the
> eleven hard constraints, the authority order between these three documents,
> and where console code lives.
>
> Then audit the repo and tell me what already exists that these documents
> assume or contradict — specifically: the existing console UI under
> `/copilot/[tenant]` and its visual system, the existing `leads` table and
> import path, whether batching is already modelled on `call_queue`, and the
> three dial stacks. Do not write code. I want the contradictions first.

*This step matters more than usual now — the docs were written before the
codebase audit and several assumptions are being corrected by it.*

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

Two places to watch Cursor closely:

**Phase 0.** It will want to leave the old dial paths in place "for safety".
Make it delete them. A fourth stack appears the moment two survive.

**Phase 5, publish order.** Steps 3 and 4 must stay in that order — version row
written first, Vapi call second, transaction third. If it inverts them you get
a live assistant pointing at an unpublished version. Add to the prompt:
*"Walk me through what the database and Vapi look like if step 4 throws."*

---

# TRACK B — the rest of the console

Start after Phase 1 is merged (you need `getSession()`), and ideally after
Phase 8 (you'll reuse its primitives).

## B1 — Audit before adding

> Before building any new console screens: list every component under
> `src/app/copilot/[tenant]/` and `src/components/` that Phase 8 created or that
> already existed, and map them to the primitives table in §2 of
> `docs/web-console-spec.md`. Tell me which of those primitives already exist,
> which need extracting from Phase 8's Scripts UI, and which are genuinely new.
> Do not write components we already have under another name.

**Accept when:** you have a list, not a folder of duplicates.

## B2 — Missing primitives

> Extract and generalise the primitives identified in B1 into
> `src/components/ui/`, one file each, plus an index barrel. `Row` in particular
> is used by six screens — its props must be generic (`title`, `sub`, `right`,
> `leading`, `onClick`) and it must not know what a script or a run is.
> Refactor Phase 8's Scripts UI to consume them. No visual change.

## B3 — Coexistence connect and sync

> Meta Embedded Signup is already done on Meta's side for the live number. Store
> `waba_id`, `phone_number_id` and `coex_status` on the agent, and build the
> webhook that receives the Coexistence history and contact sync.
>
> Up to six months of chat history and the full contact list arrive. Media asset
> IDs resolve only for the last 14 days — handle absence, don't crash. Group
> chats never arrive. Map contacts to leads storing `first_name` and
> `last_initial` only. Set `coex_status` to `connected` and stamp `synced_at`.
>
> Use the existing leads table and the existing KB indexer — do not create a
> second leads path or a second indexing path.

**Accept when:** real conversations from the live number are queryable, history
reaches ~6 months back, and no full surname is stored anywhere.

**Then stop and check** before building screens on top of it:

```sql
select coex_status, synced_at, waba_id from agents;
select count(*), min(last_message_at), max(last_message_at)
  from leads where source = 'whatsapp';
select first_name, last_initial, phone from leads limit 20;
```

## B4 — Home

> Build the home screen per §3 of the console spec. Three status booleans, one
> primary action, recent runs as `Row`s with the script name linking to its
> editor. No charts, no sparklines, no conversion rates.

## B5 — Setup wizard

> Build steps 1, 3 and 4 of `/join` per §3, wrapping the working connect flow
> from B3. Four ticks for progress, one action per screen, no nav. Step 4's
> "Send me one now" builds and pushes a real brief. Final button is a WhatsApp
> deep link.

Then separately:

> Build step 2 of `/join` — the sync screen. Three stats and three named leads
> with the reason each matters, ranked by `intent_score`. Handle 24-hour
> sync-window expiry as an explicit restart offer, not a spinner.

## B6 — Call runs

Two prompts, never one.

> Build the run builder per §3. The match count must show exclusions
> explicitly — opted-out and recently-called leads subtracted visibly. The
> script picker lists **live scripts only**. At enqueue, write `script_id` and
> `script_version_id` onto every `call_queue` row per Phase 6, set once and
> never updated. The confirm card states caller ID, AI disclosure and AED
> estimate directly above the commit button.

> Build the run results page per §3. Read from `calls`, not `call_queue` —
> attribution is copied there at dial time so it survives queue cleanup.
> `extracted` fields render from the script version's `find_out` shape.

## B7 — KB, how-it-works, settings

> Build the remaining three screens per §3.

## B8 — Morning brief

> Build the brief job: overnight pipeline scan, ranked by intent, sent at
> `brief_time` in the agent's `tz`. Both this and the end-of-run summary can
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
dial path, or a Vapi read/sync, it has stopped reading the rules file. Start a
fresh session rather than arguing with it.
