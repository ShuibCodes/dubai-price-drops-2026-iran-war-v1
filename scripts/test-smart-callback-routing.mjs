/**
 * Smart Callback WhatsApp routing tests.
 * No live Claude / Vapi / Supabase — mocks search and exercises the detector.
 *
 *   node --experimental-loader ./scripts/alias-loader.mjs scripts/test-smart-callback-routing.mjs
 */
import { matchSavedList } from "../src/lib/console/lists.js";
import {
  formatSmartCallbackMatches,
  isSmartCallbackRequest,
  maybeHandleSmartCallbackRequest,
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

const AGENT_A_ID = "agent-a";

console.log("isSmartCallbackRequest — list-shaped asks");
assertEqual(
  isSmartCallbackRequest(
    "Call everyone who mentioned wanting to rent a 2-bedroom in Downtown in the last 3 months."
  ),
  true,
  "canonical call everyone who …"
);
assertEqual(
  isSmartCallbackRequest("find people who mentioned a budget"),
  true,
  "find people who …"
);
assertEqual(
  isSmartCallbackRequest("list anyone who asked about Palm"),
  true,
  "list anyone who …"
);
assertEqual(
  isSmartCallbackRequest("call all leads who wanted a viewing last week"),
  true,
  "call all leads who …"
);
assertEqual(
  isSmartCallbackRequest("find me everyone who asked about off-plan"),
  true,
  "find me everyone who …"
);
assertEqual(
  isSmartCallbackRequest("show me anyone who wanted a viewing"),
  true,
  "show me anyone who …"
);
assertEqual(
  isSmartCallbackRequest("can you list all of the people who mentioned a budget"),
  true,
  "can you list all of the people who …"
);

console.log("\nisSmartCallbackRequest — stays on existing Jarvis paths");
assertEqual(
  isSmartCallbackRequest("call my downtown list with the cold list script"),
  false,
  "saved-list command is not smart callback"
);
assertEqual(
  isSmartCallbackRequest("call my budget list"),
  false,
  "call my budget list is not smart callback"
);
assertEqual(
  isSmartCallbackRequest("what did Ahmed want?"),
  false,
  "normal question stays on existing path"
);
assertEqual(
  isSmartCallbackRequest("who mentioned a budget?"),
  false,
  "inbox lookup is not a callback list ask"
);
assertEqual(
  isSmartCallbackRequest("who mentioned a budget"),
  false,
  "inbox lookup without ? is still not smart callback"
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

  const result = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    agentId: AGENT_A_ID,
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
  });

  assertEqual(Boolean(result?.handled), true, "smart callback request is handled");
  assertEqual(result?.agentId, AGENT_A_ID, "handler surfaces turn agentId");
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
    "search receives tenantId + turn agentId + parsed intent/window"
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
    agentId: AGENT_A_ID,
    senderPhone: "",
    listMatch: null,
    messages: [{ role: "user", content: "call everyone who mentioned budget" }],
    searchCandidates: fakeSearch,
  });
  assertEqual(noSender, null, "no senderPhone: do not run smart callback path");
  assertEqual(called, false, "no senderPhone: search not called");

  const missingAgent = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    agentId: "",
    senderPhone: "971500000111",
    listMatch: null,
    messages: [{ role: "user", content: "call everyone who mentioned budget" }],
    searchCandidates: fakeSearch,
  });
  assertEqual(Boolean(missingAgent?.handled), true, "missing agentId: handled with empty result");
  assertEqual(Boolean(missingAgent?.failClosed), true, "missing agentId: failClosed flag");
  assertEqual(called, false, "missing agentId: search never called");
  assertIncludes(
    missingAgent?.text,
    "couldn't find any matching leads",
    "missing agentId: safe empty copy (no leads exposed)"
  );
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

  const listCmd = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    agentId: AGENT_A_ID,
    senderPhone: "971500000111",
    listMatch: { name: "budget", count: 12 },
    messages: [{ role: "user", content: "call my budget list" }],
    searchCandidates: fakeSearch,
  });
  assertEqual(listCmd, null, "saved-list 'call my budget list': Smart Callback stands down");
  assertEqual(called, false, "saved-list command: search not called");

  const smart = await maybeHandleSmartCallbackRequest({
    tenantId: "tenant-a",
    agentId: AGENT_A_ID,
    senderPhone: "971500000111",
    listMatch: { name: "budget", count: 12 },
    messages: [
      { role: "user", content: "call everyone who mentioned a budget" },
    ],
    searchCandidates: fakeSearch,
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
    agentId: AGENT_A_ID,
    senderPhone: "971500000111",
    listMatch: null,
    messages: [{ role: "user", content: "who mentioned a budget?" }],
    searchCandidates: async () => {
      called = true;
      return { intent: "x", windowDays: 21, matches: [] };
    },
  });
  assertEqual(result, null, "inbox lookup returns null (existing Jarvis path)");
  assertEqual(called, false, "inbox lookup does not call smart search");
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
