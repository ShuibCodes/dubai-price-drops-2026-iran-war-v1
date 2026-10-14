/**
 * Morning Brief V1 ownership + button flow.
 * No live Supabase or Meta calls.
 *
 * node scripts/qa-morning-brief.mjs
 */
import { register } from "node:module";

// Application source imports Next.js "@/..." aliases. Register the repo's
// existing alias loader so this runs under plain node, then import.
register("./alias-loader.mjs", import.meta.url);

const {
  buildMorningBrief,
  sendMorningBriefNotification,
  sendRequestedMorningBrief,
} = await import("../src/lib/brief/send.js");
const { handleSendBriefButton, isSendBriefButton } = await import(
  "../src/lib/brief/button.js"
);

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const AGENT_OTHER = "agent-other";
const TODAY = new Date("2026-09-03T07:30:00.000Z");

const agentA = {
  id: AGENT_A,
  tenant_id: TENANT_A,
  name: "Agent A",
  wa_id: "971500000001",
  last_brief_sent_on: null,
};

function createMemorySupabase(seed = {}) {
  const store = {
    agents: [...(seed.agents || [])],
    leads: [...(seed.leads || [])],
    "whatsapp-messages": [...(seed["whatsapp-messages"] || [])],
    jarvis_leads: [...(seed.jarvis_leads || [])],
  };

  function from(table) {
    const state = {
      op: "select",
      filters: [],
      orFilter: null,
      payload: null,
      limit: null,
      order: null,
    };

    function matches(row) {
      const exact = state.filters.every(([key, value]) => row[key] === value);
      if (!exact) return false;
      if (!state.orFilter) return true;
      const [nullPart, neqPart] = state.orFilter.split(",");
      const nullColumn = nullPart.split(".")[0];
      const [, , neqValue] = neqPart.split(".");
      return row[nullColumn] == null || String(row[nullColumn]) !== neqValue;
    }

    function execute() {
      let rows = (store[table] || []).filter(matches);
      if (state.op === "insert") {
        const input = Array.isArray(state.payload)
          ? state.payload
          : [state.payload];
        for (const row of input) {
          if (
            table === "whatsapp-messages" &&
            store[table].some(
              (existing) => existing.wa_message_id === row.wa_message_id
            )
          ) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate wa_message_id" },
            };
          }
          store[table].push({ id: `row-${store[table].length + 1}`, ...row });
        }
        return { data: input, error: null };
      }
      if (state.op === "update") {
        for (const row of rows) Object.assign(row, state.payload);
      }
      if (state.op === "delete") {
        store[table] = store[table].filter((row) => !matches(row));
        return { data: rows, error: null };
      }
      if (state.order) {
        const [column, ascending] = state.order;
        rows.sort((a, b) => {
          const result = String(a[column] || "").localeCompare(
            String(b[column] || "")
          );
          return ascending ? result : -result;
        });
      }
      if (state.limit != null) rows = rows.slice(0, state.limit);
      return { data: rows.map((row) => ({ ...row })), error: null };
    }

    const chain = {
      select() {
        return chain;
      },
      eq(key, value) {
        state.filters.push([key, value]);
        return chain;
      },
      or(value) {
        state.orFilter = value;
        return chain;
      },
      order(column, options = {}) {
        state.order = [column, options.ascending !== false];
        return chain;
      },
      limit(value) {
        state.limit = value;
        return chain;
      },
      insert(payload) {
        state.op = "insert";
        state.payload = payload;
        return chain;
      },
      update(payload) {
        state.op = "update";
        state.payload = payload;
        return chain;
      },
      delete() {
        state.op = "delete";
        return chain;
      },
      async maybeSingle() {
        const result = execute();
        return {
          data: result.data?.[0] || null,
          error: result.error,
        };
      },
      then(resolve, reject) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };
    return chain;
  }

  return { from, store };
}

function buttonMessage({
  id = "wamid-button-1",
  from = agentA.wa_id,
  buttonId = "send_brief",
  title,
} = {}) {
  return {
    id,
    from,
    timestamp: "1788420600",
    type: "interactive",
    interactive: {
      type: "button_reply",
      button_reply: {
        id: buttonId,
        title: title || (buttonId === "send_brief" ? "Send brief" : buttonId),
      },
    },
  };
}

function seed() {
  return {
    agents: [
      { ...agentA },
      {
        id: AGENT_B,
        tenant_id: TENANT_A,
        name: "Agent B",
        wa_id: "971500000002",
      },
      {
        id: AGENT_OTHER,
        tenant_id: TENANT_B,
        name: "Other Agent",
        wa_id: "971500000003",
      },
    ],
    leads: [
      {
        id: "lead-a",
        tenant_id: TENANT_A,
        assigned_agent_id: AGENT_A,
        push_name: "Owned Alpha",
        wa_id: "971511111111",
        opted_out: false,
        intent_score: 9,
        last_message_at: "2026-09-03T05:00:00Z",
        areas: ["Marina"],
      },
      {
        id: "lead-b",
        tenant_id: TENANT_A,
        assigned_agent_id: AGENT_B,
        push_name: "Private Beta",
        wa_id: "971522222222",
        opted_out: false,
        intent_score: 10,
        last_message_at: "2026-09-03T06:00:00Z",
      },
      {
        id: "lead-unassigned",
        tenant_id: TENANT_A,
        assigned_agent_id: null,
        push_name: "Unassigned Gamma",
        wa_id: "971533333333",
        opted_out: false,
        intent_score: 10,
        last_message_at: "2026-09-03T07:00:00Z",
      },
      {
        id: "lead-other-tenant",
        tenant_id: TENANT_B,
        assigned_agent_id: AGENT_A,
        push_name: "Other Tenant Delta",
        wa_id: "971544444444",
        opted_out: false,
        intent_score: 10,
        last_message_at: "2026-09-03T08:00:00Z",
      },
    ],
  };
}

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(
    `  ${condition ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`
  );
}

console.log("\nOWNED BRIEF");
{
  const db = createMemorySupabase(seed());
  const result = await buildMorningBrief(db, {
    tenantId: TENANT_A,
    agent: agentA,
  });
  check("Agent A gets Agent A's assigned lead", result.body.includes("Owned Alpha"));
  check("Agent B's lead is excluded", !result.body.includes("Private Beta"));
  check("unassigned lead is excluded", !result.body.includes("Unassigned Gamma"));
  check("another tenant's lead is excluded", !result.body.includes("Other Tenant Delta"));
  check(
    "result contains only the owned lead",
    result.count === 1 && result.leads[0]?.id === "lead-a",
    `count=${result.count}`
  );
}

console.log("\nNOTIFICATION IDEMPOTENCY");
{
  const db = createMemorySupabase(seed());
  let templateSends = 0;
  let lastTemplate = null;
  const sendTemplate = async (payload) => {
    templateSends += 1;
    lastTemplate = payload;
    return { messages: [{ id: "template-message" }] };
  };
  const tenant = { id: TENANT_A, phone_number_id: "phone-a", business_token: "test" };
  const first = await sendMorningBriefNotification({
    supabase: db,
    tenant,
    agent: agentA,
    now: TODAY,
    sendTemplate,
  });
  const second = await sendMorningBriefNotification({
    supabase: db,
    tenant,
    agent: agentA,
    now: TODAY,
    sendTemplate,
  });
  check("first notification is sent as a template", first.sent && first.via === "template");
  check(
    "notification template has no body variables",
    Array.isArray(lastTemplate?.bodyParams) && lastTemplate.bodyParams.length === 0
  );
  check(
    "second notification for agent/day is prevented",
    !second.sent &&
      second.reason === "already_sent_today" &&
      templateSends === 1,
    `sends=${templateSends}`
  );

  const failDb = createMemorySupabase(seed());
  const failing = await sendMorningBriefNotification({
    supabase: failDb,
    tenant,
    agent: { ...agentA },
    now: TODAY,
    sendTemplate: async () => {
      throw new Error("graph fail");
    },
  });
  const recovered = await sendMorningBriefNotification({
    supabase: failDb,
    tenant,
    agent: failDb.store.agents.find((row) => row.id === AGENT_A),
    now: TODAY,
    sendTemplate: async () => ({ messages: [{ id: "retry" }] }),
  });
  check(
    "failed template send releases the daily claim",
    !failing.sent && recovered.sent,
    failing.reason
  );
}

console.log("\nBUTTON FLOW");
{
  const db = createMemorySupabase(seed());
  const tenant = { id: TENANT_A, phone_number_id: "phone-a", business_token: "test" };
  let textSends = 0;
  let sentBody = "";
  const sendBrief = (args) =>
    sendRequestedMorningBrief({
      ...args,
      sendText: async ({ body }) => {
        textSends += 1;
        sentBody = body;
      },
    });

  const first = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: buttonMessage(),
    sendBrief,
  });
  check("Agent A button sends Agent A's brief", first.sent && textSends === 1);
  check("button brief includes Agent A's lead", sentBody.includes("Owned Alpha"));
  check("button brief excludes Agent B's lead", !sentBody.includes("Private Beta"));
  check(
    "button event does not create a Jarvis lead",
    db.store.jarvis_leads.length === 0
  );

  const duplicate = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: buttonMessage(),
    sendBrief,
  });
  check(
    "duplicate webhook does not send twice",
    duplicate.reason === "duplicate" && textSends === 1,
    `sends=${textSends}`
  );

  const unknown = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: buttonMessage({ id: "unknown", from: "971599999999" }),
    sendBrief,
  });
  check(
    "unknown WhatsApp number cannot request a brief",
    unknown.reason === "unknown_agent" && textSends === 1
  );

  const crossTenant = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: buttonMessage({
      id: "other-tenant",
      from: "971500000003",
    }),
    sendBrief,
  });
  check(
    "agent from another tenant cannot request this tenant's brief",
    crossTenant.reason === "unknown_agent" && textSends === 1
  );

  const titlePayload = buttonMessage({
    id: "wamid-title",
    buttonId: "Send brief",
    title: "Send brief",
  });
  check(
    "Meta quick-reply title Send brief is accepted",
    isSendBriefButton(titlePayload)
  );

  const otherInteractive = buttonMessage({
    id: "other-button",
    buttonId: "different_action",
    title: "Something else",
  });
  check(
    "other interactive events are not intercepted",
    !isSendBriefButton(otherInteractive)
  );
  const untouched = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: otherInteractive,
    sendBrief,
  });
  check("other interactive handler result remains unhandled", !untouched.handled);

  const pending = buttonMessage({ id: "wamid-crash" });
  db.store["whatsapp-messages"].push({
    id: "lock-pending",
    tenant_id: TENANT_A,
    lead_id: null,
    jarvis_lead_id: null,
    wa_message_id: pending.id,
    direction: "inbound",
    body: "send_brief",
    msg_type: "interactive",
    raw: pending,
    sent_by_bot: false,
  });
  const retry = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: pending,
    sendBrief,
  });
  const lock = db.store["whatsapp-messages"].find(
    (row) => row.wa_message_id === pending.id
  );
  check(
    "undelivered lock is retried then marked delivered",
    retry.sent && textSends === 2 && lock?.raw?.brief_delivered === true,
    `sends=${textSends}`
  );
  const retryAgain = await handleSendBriefButton({
    supabase: db,
    tenant,
    message: pending,
    sendBrief,
  });
  check(
    "delivered lock is not sent again",
    retryAgain.reason === "duplicate" && textSends === 2,
    `sends=${textSends}`
  );
}

if (failures) {
  console.error(`\nFAILED ${failures} check(s)`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
