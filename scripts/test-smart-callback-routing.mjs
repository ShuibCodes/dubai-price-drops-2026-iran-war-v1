/**
 * Smart Callback agent-scoping + routing regression tests (Syed review).
 * Ownership filter: jarvis_leads.assigned_agent_id (not assigned_agent_phone).
 * No live Claude / Vapi / Supabase — exercises production filter helpers and routing.
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/test-smart-callback-routing.mjs
 */
import {
  assertAgentBelongsToTenant,
  buildAssignedLeadIdSet,
  groupMessageRowsIntoAssignedThreads,
  isLeadAssignedToAgentId,
} from "../src/lib/jarvis/batch-callback-search.js";
import { matchSavedList } from "../src/lib/console/lists.js";
import {
  formatSmartCallbackMatches,
  isSmartCallbackRequest,
  maybeHandleSmartCallbackRequest,
  resolveSmartCallbackAgent,
} from "../src/lib/jarvis/smart-callback.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed += 1;
    console.log(`  ok: ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    actual:   ${JSON.stringify(actual)}`);
}

function assertDeepEqual(actual, expected, label) {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

function assertIncludes(actual, expectedSubstring, label) {
  const text = String(actual || "");
  if (text.includes(expectedSubstring)) {
    passed += 1;
    console.log(`  ok: ${label}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL: ${label}`);
  console.error(`    expected substring: ${JSON.stringify(expectedSubstring)}`);
  console.error(`    actual:             ${JSON.stringify(text)}`);
}

function assertTrue(value, label) {
  assertEqual(Boolean(value), true, label);
}

function assertFalse(value, label) {
  assertEqual(Boolean(value), false, label);
}

/** Minimal thenable Supabase query builder for unit tests. */
function fakeSupabase({ agents = [], leads = [] } = {}) {
  return {
    from(table) {
      const state = { table, filters: {} };
      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          state.filters[col] = val;
          return api;
        },
        not() {
          return api;
        },
        in() {
          return api;
        },
        maybeSingle() {
          if (state.table !== "agents") {
            return Promise.resolve({ data: null, error: null });
          }
          const row = agents.find(
            (a) =>
              a.id === state.filters.id &&
              a.tenant_id === state.filters.tenant_id
          );
          return Promise.resolve({ data: row || null, error: null });
        },
        then(resolve, reject) {
          if (state.table === "jarvis_leads") {
            let tenantLeads = leads.filter(
              (l) => l.tenant_id === state.filters.tenant_id
            );
            if (state.filters.assigned_agent_id != null) {
              tenantLeads = tenantLeads.filter(
                (l) =>
                  String(l.assigned_agent_id) ===
                  String(state.filters.assigned_agent_id)
              );
            }
            return Promise.resolve({ data: tenantLeads, error: null }).then(
              resolve,
              reject
            );
          }
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

const AGENT_A_ID = "agent-a";
const AGENT_B_ID = "agent-b";
const AGENT_A_WA = "971500000111";

console.log("isLeadAssignedToAgentId — production assignment predicate");
{
  assertTrue(
    isLeadAssignedToAgentId({ assigned_agent_id: AGENT_A_ID }, AGENT_A_ID),
    "matching assigned_agent_id → included"
  );
  assertFalse(
    isLeadAssignedToAgentId({ assigned_agent_id: AGENT_B_ID }, AGENT_A_ID),
    "other agent's lead → excluded"
  );
  assertFalse(
    isLeadAssignedToAgentId({ assigned_agent_id: null }, AGENT_A_ID),
    "unassigned null → excluded"
  );
  assertFalse(
    isLeadAssignedToAgentId({ assigned_agent_id: "" }, AGENT_A_ID),
    "unassigned empty → excluded"
  );
  assertFalse(
    isLeadAssignedToAgentId({}, AGENT_A_ID),
    "missing assigned_agent_id → excluded"
  );
  assertFalse(
    isLeadAssignedToAgentId({ assigned_agent_id: AGENT_A_ID }, ""),
    "empty requesting agentId → excluded"
  );
}

console.log("\nbuildAssignedLeadIdSet + groupMessageRowsIntoAssignedThreads");
{
  const leads = [
    { id: "mine-1", assigned_agent_id: AGENT_A_ID },
    { id: "other-1", assigned_agent_id: AGENT_B_ID },
    { id: "unassigned-1", assigned_agent_id: null },
    { id: "unassigned-2", assigned_agent_id: "" },
  ];
  const allowed = buildAssignedLeadIdSet(leads, AGENT_A_ID);
  assertDeepEqual(
    [...allowed].sort(),
    ["mine-1"],
    "only requesting agent's assigned lead ids"
  );

  const rows = [
    { jarvis_lead_id: "mine-1", timestamp: "2026-09-04T12:00:00.000Z", body: "budget" },
    { jarvis_lead_id: "other-1", timestamp: "2026-09-04T11:00:00.000Z", body: "budget" },
    { jarvis_lead_id: "unassigned-1", timestamp: "2026-09-04T10:00:00.000Z", body: "budget" },
    { jarvis_lead_id: "mine-1", timestamp: "2026-09-03T12:00:00.000Z", body: "earlier" },
  ];
  const threads = groupMessageRowsIntoAssignedThreads(rows, allowed, {
    maxThreads: 50,
    messagesPerThread: 20,
  });
  assertDeepEqual(
    threads.map((t) => t.jarvisLeadId),
    ["mine-1"],
    "message prefilter keeps only assigned agent's threads"
  );
  assertEqual(threads[0].messages.length, 2, "both messages for assigned lead kept");
}

console.log("\nassertAgentBelongsToTenant — tenant boundary");
{
  const supabase = fakeSupabase({
    agents: [
      { id: AGENT_A_ID, tenant_id: "tenant-a" },
      { id: AGENT_B_ID, tenant_id: "tenant-b" },
    ],
  });

  const ok = await assertAgentBelongsToTenant({
    tenantId: "tenant-a",
    agentId: AGENT_A_ID,
    supabase,
  });
  assertEqual(ok, AGENT_A_ID, "same-tenant agent resolves");

  const mismatch = await assertAgentBelongsToTenant({
    tenantId: "tenant-a",
    agentId: AGENT_B_ID,
    supabase,
  });
  assertEqual(mismatch, null, "tenant mismatch cannot resolve agent");

  const missing = await assertAgentBelongsToTenant({
    tenantId: "tenant-a",
    agentId: "unknown",
    supabase,
  });
  assertEqual(missing, null, "unknown agentId fails closed");
}

console.log("\nresolveSmartCallbackAgent — sender → agentId");
{
  const resolveSender = async (phone) => {
    if (String(phone).replace(/\D/g, "") === "971500000111") {
      return {
        agentId: AGENT_A_ID,
        tenantId: "tenant-a",
        waId: AGENT_A_WA,
      };
    }
    return null;
  };

  const ok = await resolveSmartCallbackAgent({
    tenantId: "tenant-a",
    senderPhone: "+971 50 000 0111",
    resolveSender,
  });
  assertEqual(ok?.agentId, AGENT_A_ID, "known sender resolves agentId");

  const unknown = await resolveSmartCallbackAgent({
    tenantId: "tenant-a",
    senderPhone: "971599999999",
    resolveSender,
  });
  assertEqual(unknown, null, "unknown sender fails closed");

  const crossTenant = await resolveSmartCallbackAgent({
    tenantId: "tenant-b",
    senderPhone: "971500000111",
    resolveSender,
  });
  assertEqual(crossTenant, null, "sender tenant mismatch fails closed");

  const noPhone = await resolveSmartCallbackAgent({
    tenantId: "tenant-a",
    senderPhone: "",
    resolveSender,
  });
  assertEqual(noPhone, null, "missing senderPhone fails closed");
}

console.log("\nisSmartCallbackRequest");
assertEqual(
  isSmartCallbackRequest(
    "Call everyone who mentioned wanting to rent a 2-bedroom in Downtown in the last 3 months."
  ),
  true,
  "detects canonical smart callback request"
);
assertEqual(
  isSmartCallbackRequest("call my downtown list with the cold list script"),
  false,
  "does not treat saved-list command as smart callback"
);
assertEqual(
  isSmartCallbackRequest("call my budget list"),
  false,
  "call my budget list is not smart callback shape"
);
assertEqual(
  isSmartCallbackRequest("what did Ahmed want?"),
  false,
  "normal Jarvis question stays on existing path"
);

console.log("\nmaybeHandleSmartCallbackRequest — agent-scoped search args");
{
  const calls = [];
  const fakeParse = (raw) => ({
    raw,
    intent: "wanted to rent a 2-bedroom in Downtown",
    windowDays: 90,
  });
  const fakeSearch = async (args) => {
    calls.push(args);
    return {
      intent: args.intent,
      windowDays: args.windowDays,
      since: "2026-06-01T00:00:00.000Z",
      threadsEvaluated: 12,
      threadsConsidered: 25,
      matches: [
        {
          jarvis_lead_id: "lead-1",
          display_name: "Sara",
          phone_e164: "+971500000001",
          match_reason: "Asked for Downtown 2BR rental options",
        },
      ],
    };
  };
  const resolveSender = async () => ({
    agentId: AGENT_A_ID,
    tenantId: "tenant-a",
    waId: AGENT_A_WA,
  });

  const result = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "971500000111",
    listMatch: null,
    messages: [
      { role: "assistant", content: "What should I look for?" },
      {
        role: "user",
        content:
          "Call everyone who mentioned wanting to rent a 2-bedroom in Downtown in the last 3 months.",
      },
    ],
    parseCommand: fakeParse,
    searchCandidates: fakeSearch,
    resolveSender,
  });

  assertEqual(Boolean(result?.handled), true, "smart callback request is handled");
  assertEqual(result?.agentId, AGENT_A_ID, "handler surfaces resolved agentId");
  assertDeepEqual(
    calls,
    [
      {
        tenantId: "tenant-a",
        agentId: AGENT_A_ID,
        intent: "wanted to rent a 2-bedroom in Downtown",
        windowDays: 90,
      },
    ],
    "search receives tenantId + agentId + parsed intent/window"
  );
  assertIncludes(result?.text, "Sara (+971500000001)", "response includes matched lead");
  assertIncludes(result?.text, "last 90 days", "response includes parsed window");
}

console.log("\nmaybeHandleSmartCallbackRequest — fail closed (no search)");
{
  let called = false;
  const fakeSearch = async () => {
    called = true;
    return { intent: "x", windowDays: 21, matches: [] };
  };

  const noSender = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "",
    listMatch: null,
    messages: [{ role: "user", content: "call everyone who mentioned budget" }],
    searchCandidates: fakeSearch,
    resolveSender: async () => ({ agentId: "a", tenantId: "tenant-a" }),
  });
  assertEqual(noSender, null, "no senderPhone: do not run smart callback path");
  assertEqual(called, false, "no senderPhone: search not called");

  const unknown = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "971599999999",
    listMatch: null,
    messages: [{ role: "user", content: "call everyone who mentioned budget" }],
    searchCandidates: fakeSearch,
    resolveSender: async () => null,
  });
  assertEqual(Boolean(unknown?.handled), true, "unknown sender: handled with empty result");
  assertEqual(Boolean(unknown?.failClosed), true, "unknown sender: failClosed flag");
  assertEqual(called, false, "unknown sender: search never called");
  assertIncludes(
    unknown?.text,
    "couldn't find any matching leads",
    "unknown sender: safe empty copy (no leads exposed)"
  );

  const crossTenant = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "971500000111",
    listMatch: null,
    messages: [{ role: "user", content: "call everyone who mentioned budget" }],
    searchCandidates: fakeSearch,
    resolveSender: async () => ({
      agentId: AGENT_B_ID,
      tenantId: "tenant-b",
      waId: "971500000222",
    }),
  });
  assertEqual(Boolean(crossTenant?.failClosed), true, "tenant mismatch: failClosed");
  assertEqual(called, false, "tenant mismatch: search never called");
}

console.log("\nsaved-list vs smart-callback routing (budget ambiguity)");
{
  const budgetList = [{ name: "budget", count: 12 }];
  assertEqual(
    matchSavedList(budgetList, "call everyone who mentioned a budget")?.name,
    "budget",
    "matchSavedList still substring-matches list 'budget' (known ambiguity)"
  );
  assertEqual(
    matchSavedList(budgetList, "call my budget list")?.name,
    "budget",
    "explicit saved-list 'budget' still matches"
  );

  let called = false;
  const fakeSearch = async () => {
    called = true;
    return { intent: "mentioned a budget", windowDays: 21, matches: [] };
  };
  const resolveSender = async () => ({
    agentId: AGENT_A_ID,
    tenantId: "tenant-a",
    waId: AGENT_A_WA,
  });

  const listCmd = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "971500000111",
    listMatch: { name: "budget", count: 12 },
    messages: [{ role: "user", content: "call my budget list" }],
    searchCandidates: fakeSearch,
    resolveSender,
  });
  assertEqual(listCmd, null, "saved-list 'call my budget list': Smart Callback stands down");
  assertEqual(called, false, "saved-list command: search not called");

  const smart = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "971500000111",
    listMatch: { name: "budget", count: 12 },
    messages: [
      { role: "user", content: "call everyone who mentioned a budget" },
    ],
    searchCandidates: fakeSearch,
    resolveSender,
  });
  assertEqual(Boolean(smart?.handled), true, "smart phrasing still handled despite listMatch 'budget'");
  assertEqual(called, true, "smart phrasing: search is called (not blocked by list name)");
  assertEqual(smart?.failClosed, undefined, "known agent: not failClosed");
}

console.log("\nmaybeHandleSmartCallbackRequest — normal requests unaffected");
{
  let called = false;
  const result = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    senderPhone: "971500000111",
    listMatch: null,
    messages: [{ role: "user", content: "what did Ahmed want?" }],
    searchCandidates: async () => {
      called = true;
      return { intent: "x", windowDays: 21, matches: [] };
    },
    resolveSender: async () => ({
      agentId: AGENT_A_ID,
      tenantId: "tenant-a",
    }),
  });
  assertEqual(result, null, "normal message returns null (existing Jarvis path)");
  assertEqual(called, false, "normal message does not call smart search");
}

console.log("\nformatSmartCallbackMatches");
{
  const none = formatSmartCallbackMatches({
    intent: "mentioned budget",
    windowDays: 21,
    since: "2026-08-01T00:00:00.000Z",
    threadsEvaluated: 0,
    threadsConsidered: 18,
    matches: [],
  });
  assertIncludes(none, "couldn't find any matching leads", "empty match copy");

  const many = formatSmartCallbackMatches({
    intent: "asked about renting",
    windowDays: 90,
    threadsEvaluated: 30,
    threadsConsidered: 90,
    matches: Array.from({ length: 22 }, (_, i) => ({
      display_name: `Lead ${i + 1}`,
      phone_e164: `+9715000000${String(i + 1).padStart(2, "0")}`,
      match_reason: "Matched intent",
    })),
  });
  assertIncludes(many, "…and 2 more matches.", "truncation tail when over 20 matches");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
