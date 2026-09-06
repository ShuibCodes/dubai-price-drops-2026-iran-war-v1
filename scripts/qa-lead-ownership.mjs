/**
 * Lead ownership foundation for Smart Callback Lists V1.
 * In-memory Supabase stand-in — no live database writes.
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-lead-ownership.mjs
 */
import { upsertListContacts } from "../src/lib/console/lists.js";
import { upsertJarvisLead } from "../src/lib/ingest/jarvis-ingest.js";
import {
  getOwnedCallbackLead,
  listOwnedJarvisLeadIds,
  loadOwnedLeadsById,
  requireCallbackScope,
} from "../src/lib/jarvis/batch-callback-search.js";
import { upsertCallableJarvisContact } from "../src/lib/jarvis/contacts.js";
import { nextAssignedAgentId } from "../src/lib/leads/assigned-agent.js";
import { upsertInboundLead } from "../src/lib/leads/inbound.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const AGENT_OTHER_TENANT = "agent-other-tenant";

function createMemorySupabase(seed = {}) {
  const store = {
    leads: [...(seed.leads || [])],
    jarvis_leads: [...(seed.jarvis_leads || [])],
    agents: [...(seed.agents || [])],
    messages: [...(seed.messages || [])],
  };
  let seq = 0;

  function pick(row, cols) {
    if (!cols || cols.trim() === "*") return { ...row };
    const out = {};
    for (const col of cols.split(",").map((c) => c.trim())) {
      out[col] = row[col];
    }
    return out;
  }

  function from(table) {
    const state = {
      op: "select",
      cols: "*",
      filters: [],
      ins: null,
      patch: null,
    };

    function rows() {
      return (store[table] || []).filter((row) =>
        state.filters.every((f) => {
          if (f.type === "eq") return row[f.k] === f.v;
          if (f.type === "in") return f.v.includes(row[f.k]);
          if (f.type === "not-null") return row[f.k] != null;
          if (f.type === "gte") return String(row[f.k] || "") >= f.v;
          return true;
        })
      );
    }

    async function exec(single) {
      if (state.op === "insert") {
        seq += 1;
        const row = {
          assigned_agent_id: null,
          ...state.ins,
          id: state.ins.id || `gen-${seq}`,
        };
        store[table].push(row);
        const data = pick(row, state.cols);
        return { data: single ? data : [data], error: null };
      }
      const matched = rows();
      if (state.op === "update") {
        for (const row of matched) Object.assign(row, state.patch);
        const data = matched.map((r) => pick(r, state.cols));
        return { data: single ? data[0] || null : data, error: null };
      }
      const data = matched.map((r) => pick(r, state.cols));
      return { data: single ? data[0] || null : data, error: null };
    }

    const chain = {
      select(cols) {
        state.cols = cols;
        return chain;
      },
      insert(row) {
        state.op = "insert";
        state.ins = row;
        return chain;
      },
      update(patch) {
        state.op = "update";
        state.patch = patch;
        return chain;
      },
      eq(k, v) {
        state.filters.push({ type: "eq", k, v });
        return chain;
      },
      in(k, v) {
        state.filters.push({ type: "in", k, v });
        return chain;
      },
      not(k, op, v) {
        if (op === "is" && v === null) {
          state.filters.push({ type: "not-null", k });
        }
        return chain;
      },
      gte(k, v) {
        state.filters.push({ type: "gte", k, v });
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return exec(true);
      },
      single() {
        return exec(true);
      },
      then(resolve, reject) {
        return exec(false).then(resolve, reject);
      },
    };
    return chain;
  }

  return { from, store };
}

function seedAgents(extraLeads = []) {
  return createMemorySupabase({
    agents: [
      { id: AGENT_A, tenant_id: TENANT_A, wa_id: "971501111111" },
      { id: AGENT_B, tenant_id: TENANT_A, wa_id: "971502222222" },
      { id: AGENT_OTHER_TENANT, tenant_id: TENANT_B, wa_id: "971503333333" },
    ],
    jarvis_leads: extraLeads,
  });
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${detail || ""}`);
}

console.log("\nOWNERSHIP HELPER");
check(
  "incoming null keeps existing owner",
  nextAssignedAgentId(AGENT_A, null) === AGENT_A
);
check(
  "existing null takes incoming owner",
  nextAssignedAgentId(null, AGENT_A) === AGENT_A
);
check(
  "does not steal from another agent",
  nextAssignedAgentId(AGENT_A, AGENT_B) === AGENT_A
);

console.log("\nCONSOLE LIST UPLOAD");
{
  const db = createMemorySupabase();
  const saved = await upsertListContacts(db, TENANT_A, {
    name: "Morning list",
    contacts: [{ name: "Sara", phone: "+971504000001" }],
    agentId: AGENT_A,
  });
  const row = db.store.leads[0];
  check("console-created lead is stamped with agent", row?.assigned_agent_id === AGENT_A, row?.assigned_agent_id);
  check("console insert returns the new lead id", saved.saved === 1 && saved.leadIds[0] === row.id);

  db.store.leads.push({
    id: "owned-by-b",
    tenant_id: TENANT_A,
    wa_id: "971504000002",
    opted_out: false,
    push_name: "Other",
    assigned_agent_id: AGENT_B,
  });
  const skipped = await upsertListContacts(db, TENANT_A, {
    name: "Morning list",
    contacts: [{ name: "Taken", phone: "+971504000002" }],
    agentId: AGENT_A,
  });
  const stillB = db.store.leads.find((l) => l.id === "owned-by-b");
  check(
    "console upload skips another agent's lead",
    skipped.saved === 0 && stillB.assigned_agent_id === AGENT_B
  );
}

console.log("\nINBOUND CRM MATCH");
{
  const db = seedAgents();
  const matched = await upsertInboundLead(
    TENANT_A,
    { name: "Inbound", phone: "+971504000010", agent_phone: "+971501111111" },
    db
  );
  check(
    "inbound assigns when agent_phone matches tenant wa_id",
    matched.assigned_agent_id === AGENT_A,
    matched.assigned_agent_id
  );

  const unmatched = await upsertInboundLead(
    TENANT_A,
    { name: "Orphan", phone: "+971504000011", agent_phone: "+971509999999" },
    db
  );
  check(
    "inbound stays unassigned when phone is not a tenant agent",
    unmatched.assigned_agent_id == null
  );

  const otherTenant = await upsertInboundLead(
    TENANT_A,
    { name: "Cross", phone: "+971504000012", agent_phone: "+971503333333" },
    db
  );
  check(
    "inbound does not assign an agent from another tenant",
    otherTenant.assigned_agent_id == null
  );
}

console.log("\nJARVIS SAVE vs SHARED INBOX");
{
  const db = seedAgents();
  const inbox = await upsertJarvisLead({
    supabase: db,
    tenantId: TENANT_A,
    waId: "971504000020",
    pushName: "Inbox contact",
  });
  check(
    "shared inbox ingest leaves assigned_agent_id null",
    inbox.assigned_agent_id == null,
    inbox.assigned_agent_id
  );

  const saved = await upsertCallableJarvisContact({
    tenantId: TENANT_A,
    name: "Explicit save",
    phoneE164: "+971504000021",
    waId: "971504000021",
    senderPhone: "+971501111111",
    supabase: db,
  });
  const savedRow = db.store.jarvis_leads.find((l) => l.id === saved.id);
  check(
    "explicit Jarvis save stamps the saving agent",
    savedRow?.assigned_agent_id === AGENT_A,
    savedRow?.assigned_agent_id
  );
}

console.log("\nSMART CALLBACK SCOPE");
{
  const own = {
    id: "lead-own",
    tenant_id: TENANT_A,
    assigned_agent_id: AGENT_A,
    wa_id: "971504000030",
    push_name: "Mine",
  };
  const other = {
    id: "lead-other",
    tenant_id: TENANT_A,
    assigned_agent_id: AGENT_B,
    wa_id: "971504000031",
    push_name: "Theirs",
  };
  const unassigned = {
    id: "lead-none",
    tenant_id: TENANT_A,
    assigned_agent_id: null,
    wa_id: "971504000032",
    push_name: "Nobody",
  };
  const foreign = {
    id: "lead-foreign",
    tenant_id: TENANT_B,
    assigned_agent_id: AGENT_OTHER_TENANT,
    wa_id: "971504000033",
    push_name: "Other tenant",
  };
  const db = seedAgents([own, other, unassigned, foreign]);

  const seen = await getOwnedCallbackLead({
    supabase: db,
    tenantId: TENANT_A,
    agentId: AGENT_A,
    leadId: own.id,
  });
  check("agent can see their own lead", seen?.id === own.id);

  const hiddenOther = await getOwnedCallbackLead({
    supabase: db,
    tenantId: TENANT_A,
    agentId: AGENT_A,
    leadId: other.id,
  });
  check("agent cannot see another agent's lead", hiddenOther == null);

  const hiddenNone = await getOwnedCallbackLead({
    supabase: db,
    tenantId: TENANT_A,
    agentId: AGENT_A,
    leadId: unassigned.id,
  });
  check("agent cannot see an unassigned lead", hiddenNone == null);

  const hiddenCross = await getOwnedCallbackLead({
    supabase: db,
    tenantId: TENANT_A,
    agentId: AGENT_A,
    leadId: foreign.id,
  });
  check("cross-tenant lead id is blocked", hiddenCross == null);

  const ownedIds = await listOwnedJarvisLeadIds({
    supabase: db,
    tenantId: TENANT_A,
    agentId: AGENT_A,
  });
  check(
    "owned-id list is only this agent",
    ownedIds.size === 1 && ownedIds.has(own.id)
  );

  const loaded = await loadOwnedLeadsById({
    supabase: db,
    tenantId: TENANT_A,
    agentId: AGENT_A,
    leadIds: [own.id, other.id, unassigned.id, foreign.id],
  });
  check(
    "bulk load by id still enforces ownership",
    loaded.size === 1 && loaded.has(own.id)
  );

  let threw = false;
  try {
    requireCallbackScope({ tenantId: TENANT_A, agentId: "" });
  } catch {
    threw = true;
  }
  check("callback search refuses to run without agentId", threw);
}

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;
