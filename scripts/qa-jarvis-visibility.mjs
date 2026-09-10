/**
 * Jarvis visibility rules — in-memory only, no database writes.
 *
 * node --experimental-loader ./scripts/alias-loader.mjs scripts/qa-jarvis-visibility.mjs
 */
import {
  applyCampaignAgentScope,
  assertJarvisActor,
  getVisibleInboxLead,
  inboxLeadVisible,
  listVisibleInboxLeadIds,
} from "../src/lib/jarvis/visibility.js";
import { recentRelayToPhone } from "../src/lib/jarvis/relay.js";
import { runJarvisTurn } from "../src/lib/jarvis/engine.js";
import { jarvisSenderMatchesScope } from "../src/lib/jarvis/sender-allowlist.js";
import { readFile } from "node:fs/promises";

const T1 = "tenant-1";
const T2 = "tenant-2";
const A1 = "agent-1";
const A2 = "agent-2";

const rows = [
  { id: "a1", tenant_id: T1, assigned_agent_id: A1 },
  { id: "a2", tenant_id: T1, assigned_agent_id: A2 },
  { id: "shared", tenant_id: T1, assigned_agent_id: null },
  { id: "foreign", tenant_id: T2, assigned_agent_id: A1 },
];

function memorySupabase(seed) {
  return {
    from() {
      const filters = [];
      const chain = {
        select() {
          return chain;
        },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return chain;
        },
        or() {
          filters.push(
            (row) => row.assigned_agent_id == null || row.assigned_agent_id === A1
          );
          return chain;
        },
        maybeSingle() {
          const data = seed.filter((row) => filters.every((fn) => fn(row)))[0] || null;
          return Promise.resolve({ data, error: null });
        },
        then(resolve, reject) {
          const data = seed.filter((row) => filters.every((fn) => fn(row)));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

let failures = 0;
function check(name, ok) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
}

check("current agent lead is visible", inboxLeadVisible(rows[0], A1));
check("other agent lead is hidden", !inboxLeadVisible(rows[1], A1));
check("unassigned lead is visible", inboxLeadVisible(rows[2], A1));
check("missing agent fails pure visibility", !inboxLeadVisible(rows[0], null));

const db = memorySupabase(rows);
const ids = await listVisibleInboxLeadIds(db, { tenantId: T1, agentId: A1 });
check("visible query includes current agent", ids.has("a1"));
check("visible query includes unassigned", ids.has("shared"));
check("visible query excludes other agent", !ids.has("a2"));
check("visible query excludes other tenant", !ids.has("foreign"));

const hidden = await getVisibleInboxLead(db, {
  tenantId: T1,
  agentId: A1,
  leadId: "a2",
});
check("direct other-agent lead id is blocked", hidden == null);

let missingAgentFailed = false;
try {
  assertJarvisActor({ tenantId: T1, agentId: "" });
} catch {
  missingAgentFailed = true;
}
check("missing agentId fails closed", missingAgentFailed);

const calls = [];
const query = {
  eq(key, value) {
    calls.push([key, value]);
    return this;
  },
};
applyCampaignAgentScope(query, { tenantId: T1, agentId: A1 });
check(
  "campaign scope requires tenant and assigned agent",
  calls.some(([key, value]) => key === "tenant_id" && value === T1) &&
    calls.some(([key, value]) => key === "assigned_agent_id" && value === A1)
);

const campaignDb = memorySupabase([
  { id: "campaign-a1", tenant_id: T1, assigned_agent_id: A1 },
  { id: "campaign-a2", tenant_id: T1, assigned_agent_id: A2 },
  { id: "campaign-none", tenant_id: T1, assigned_agent_id: null },
  { id: "campaign-foreign", tenant_id: T2, assigned_agent_id: A1 },
]);
const { data: campaignRows } = await applyCampaignAgentScope(
  campaignDb.from("leads").select("id"),
  { tenantId: T1, agentId: A1 }
);
check(
  "campaign query returns only current agent rows",
  campaignRows.length === 1 && campaignRows[0].id === "campaign-a1"
);

const relayFilters = [];
const relayDb = {
  from() {
    const chain = {
      select() {
        return chain;
      },
      eq(key, value) {
        relayFilters.push([key, value]);
        return chain;
      },
      gte() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return Promise.resolve({
          data: [{ id: "relay-t1", tenant_id: T1 }],
          error: null,
        });
      },
    };
    return chain;
  },
};
await recentRelayToPhone(T1, "+971500000000", relayDb);
check(
  "relay cooldown is tenant-scoped",
  relayFilters.some(([key, value]) => key === "tenant_id" && value === T1)
);

let missingTurnAgentFailed = false;
try {
  await runJarvisTurn({
    tenantId: T1,
    messages: [{ role: "user", content: "hello" }],
  });
} catch (error) {
  missingTurnAgentFailed = error.message === "agentId is required";
}
check("Jarvis turn refuses missing agentId", missingTurnAgentFailed);

const resolvedSender = { tenantId: T1, agentId: A1 };
check(
  "resolved sender matches its tenant and agent",
  jarvisSenderMatchesScope(resolvedSender, { tenantId: T1, agentId: A1 })
);
check(
  "resolved sender cannot impersonate another agent",
  !jarvisSenderMatchesScope(resolvedSender, { tenantId: T1, agentId: A2 })
);
check(
  "resolved sender cannot cross tenants",
  !jarvisSenderMatchesScope(resolvedSender, { tenantId: T2, agentId: A1 })
);
check("unknown sender is rejected", !jarvisSenderMatchesScope(null));

const chatRoute = await readFile(
  new URL("../src/app/api/jarvis/chat/route.js", import.meta.url),
  "utf8"
);
check(
  "Jarvis chat route has no default tenant fallback",
  !chatRoute.includes("JARVIS_TENANT_SLUG") &&
    !chatRoute.includes("defaultJarvisSenderPhone")
);
check(
  "Jarvis chat passes the resolved agentId",
  chatRoute.includes("agentId: sender.agentId")
);

const whatsappRoute = await readFile(
  new URL("../src/app/api/whatsapp/route.js", import.meta.url),
  "utf8"
);
check(
  "both Twilio Jarvis paths pass the resolved agentId",
  whatsappRoute.match(/agentId: sender\.agentId/g)?.length === 6
);

const leadTools = await readFile(
  new URL("../src/lib/jarvis/leads-tools.js", import.meta.url),
  "utf8"
);
check(
  "lead story authorizes direct leadId through visible lead helper",
  /getJarvisLeadStory[\s\S]*?getVisibleInboxLead[\s\S]*?if \(!lead\) return null/.test(
    leadTools
  )
);
check(
  "rename applies hybrid scope to lookup and update",
  /setJarvisLeadName[\s\S]*?applyVisibleInboxLeadScope[\s\S]*?applyVisibleInboxLeadScope/.test(
    leadTools
  )
);
check(
  "target call authorizes direct leadId through visible lead helper",
  /startJarvisTargetCall[\s\S]*?getVisibleInboxLead[\s\S]*?if \(!lead\)/.test(
    leadTools
  )
);
check(
  "call detail and callbacks use visible parent lead ids",
  /getJarvisCallDetail[\s\S]*?listVisibleInboxLeadIds[\s\S]*?\.in\("jarvis_lead_id"/.test(
    leadTools
  ) &&
    /getJarvisPendingCallbacks[\s\S]*?listVisibleInboxLeadIds[\s\S]*?\.in\("jarvis_lead_id"/.test(
      leadTools
    )
);

const jarvisEngine = await readFile(
  new URL("../src/lib/jarvis/engine.js", import.meta.url),
  "utf8"
);
const runStatus = await readFile(
  new URL("../src/lib/console/run-status.js", import.meta.url),
  "utf8"
);
check(
  "Jarvis run status passes the current agent",
  /case "get_run_status"[\s\S]*?agentId[\s\S]*?getRunStatus/.test(
    jarvisEngine
  ) ||
    /case "get_run_status"[\s\S]*?getRunStatus[\s\S]*?agentId/.test(
      jarvisEngine
    )
);
check(
  "run status filters call batches by agent when supplied",
  /if \(agentId\) batchQuery = batchQuery\.eq\("agent_id", agentId\)/.test(
    runStatus
  )
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exitCode = failures === 0 ? 0 : 1;
