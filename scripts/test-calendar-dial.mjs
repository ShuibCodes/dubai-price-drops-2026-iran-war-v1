import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  applyCalendarVariableValues,
  applyTrustedCalendarMetadata,
  loadCalendarDialContext,
  resolveQueueAgentId,
  trustedAgentId,
} from "../src/lib/calendar/dial-context.js";
import { encryptCalendarTokens } from "../src/lib/calendar/tokens.js";
import { composePrompt, PREAMBLE_VERSION } from "../src/lib/scripts/compose.js";
import {
  calendarToolsForAssistant,
  isNativeGoogleCalendarTool,
  mergeAssistantModelTools,
  mergeServerMessages,
  VAPI_REQUIRED_SERVER_MESSAGES,
} from "../src/lib/vapi/assistant-calendar.js";
import { buildVapiAssistantWriteBody } from "../src/lib/vapi/dial.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "44444444-4444-4444-8444-444444444444";
const AGENT_A = "22222222-2222-4222-8222-222222222222";
const AGENT_B = "55555555-5555-4555-8555-555555555555";
const CONN_A = "33333333-3333-4333-8333-333333333333";
const CONN_B = "66666666-6666-4666-8666-666666666666";
const BATCH_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("hex");
process.env.APP_URL = "https://agentzero.example";
process.env.VAPI_API_KEY = "vapi-test";
process.env.VAPI_ASSISTANT_ID = "asst-test";
process.env.VAPI_PHONE_NUMBER_ID = "phone-test";

function hasSecret(value) {
  return /access_token|refresh_token|token_ciphertext|"token":|ya29\.|1\/\//i.test(
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

function cipher() {
  return encryptCalendarTokens({
    access_token: "access-aaa",
    refresh_token: "refresh-aaa",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
}

function createFakeDb({ connections = [], batches = [], agents = [] } = {}) {
  const tables = {
    calendar_connections: connections.map((row) => ({ ...row })),
    call_batches: batches.map((row) => ({ ...row })),
    agents: agents.map((row) => ({ ...row })),
  };
  return {
    tables,
    from(table) {
      const rows = tables[table] || [];
      const filters = {};
      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        maybeSingle() {
          if (!tables[table]) {
            return Promise.resolve({
              data: null,
              error: { message: `schema cache: ${table}` },
            });
          }
          const found = rows.find((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value)
          );
          return Promise.resolve({ data: found ? { ...found } : null, error: null });
        },
      };
      return api;
    },
  };
}

function activeConnection({
  id = CONN_A,
  tenantId = TENANT_A,
  agentId = AGENT_A,
} = {}) {
  return {
    id,
    tenant_id: tenantId,
    agent_id: agentId,
    provider: "google",
    google_account_email: "agent-a@example.com",
    calendar_id: "primary",
    calendar_summary: "Layla diary",
    calendar_timezone: "Asia/Dubai",
    token_ciphertext: cipher(),
    status: "active",
  };
}

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok  ${name}`);
    });
}

await test("trustedAgentId rejects names and empty values", () => {
  assert.equal(trustedAgentId("Allan"), null);
  assert.equal(trustedAgentId(""), null);
  assert.equal(trustedAgentId(null), null);
  assert.equal(trustedAgentId(AGENT_A), AGENT_A);
});

await test("missing agent identity fails closed — call can still proceed", async () => {
  const calendar = await loadCalendarDialContext(
    createFakeDb({ connections: [activeConnection()] }),
    { tenantId: TENANT_A, agentId: null }
  );
  assert.equal(calendar.connected, false);
  assert.equal(calendar.reason, "missing_agent");
  assert.equal(calendar.variableValues.calendarConnected, "false");
  assert.equal("agentId" in calendar.metadata, false);
  assert.equal("calendarConnectionId" in calendar.metadata, false);
  assert.equal(calendar.metadata.tenantId, TENANT_A);
});

await test("display-name requestedBy is not an agent id", async () => {
  const id = await resolveQueueAgentId(
    createFakeDb({
      connections: [activeConnection()],
      agents: [{ id: AGENT_A, tenant_id: TENANT_A, tz: "Asia/Dubai" }],
    }),
    { tenantId: TENANT_A, requestedBy: "Allan" }
  );
  assert.equal(id, null);
});

await test("connected agent gets tenant/agent/connection metadata and speech vars", async () => {
  const calendar = await loadCalendarDialContext(
    createFakeDb({
      connections: [activeConnection()],
      agents: [{ id: AGENT_A, tenant_id: TENANT_A, tz: "Asia/Dubai" }],
    }),
    { tenantId: TENANT_A, agentId: AGENT_A }
  );
  assert.equal(calendar.connected, true);
  assert.deepEqual(calendar.metadata, {
    tenantId: TENANT_A,
    agentId: AGENT_A,
    calendarConnectionId: CONN_A,
  });
  assert.equal(calendar.variableValues.calendarConnected, "true");
  assert.equal(calendar.variableValues.calendarLabel, "Layla diary");
  assert.equal(calendar.variableValues.calendarTimezone, "Asia/Dubai");
  assert.equal(calendar.variableValues.appointmentDurationMinutes, "30");
  assert.equal(hasSecret(calendar), false);
});

await test("no calendar connection still dials with calendarConnected=false", async () => {
  const calendar = await loadCalendarDialContext(
    createFakeDb({ agents: [{ id: AGENT_A, tenant_id: TENANT_A, tz: "Asia/Dubai" }] }),
    { tenantId: TENANT_A, agentId: AGENT_A }
  );
  assert.equal(calendar.connected, false);
  assert.equal(calendar.metadata.agentId, AGENT_A);
  assert.equal(calendar.metadata.calendarConnectionId, null);
  assert.equal(calendar.variableValues.calendarConnected, "false");
});

await test("trusted metadata overwrites a stuffed foreign connection id", () => {
  const merged = applyTrustedCalendarMetadata(
    {
      tenantId: TENANT_A,
      agentId: AGENT_B,
      calendarConnectionId: CONN_B,
    },
    {
      metadata: {
        tenantId: TENANT_A,
        agentId: AGENT_A,
        calendarConnectionId: CONN_A,
      },
    }
  );
  assert.equal(merged.tenantId, TENANT_A);
  assert.equal(merged.agentId, AGENT_A);
  assert.equal(merged.calendarConnectionId, CONN_A);
});

await test("missing agent strips untrusted agentId and connection from caller metadata", () => {
  const merged = applyTrustedCalendarMetadata(
    {
      tenantId: TENANT_A,
      agentId: AGENT_A,
      calendarConnectionId: CONN_A,
    },
    {
      metadata: { tenantId: TENANT_A },
      variableValues: { calendarConnected: "false" },
    }
  );
  assert.equal(merged.tenantId, TENANT_A);
  assert.equal("agentId" in merged, false);
  assert.equal("calendarConnectionId" in merged, false);
});

await test("speech variables never include routing ids or tokens", () => {
  const values = applyCalendarVariableValues(
    { leadName: "Sam", access_token: "nope" },
    {
      variableValues: {
        calendarConnected: "true",
        calendarLabel: "Work",
        calendarTimezone: "Asia/Dubai",
        appointmentDurationMinutes: "30",
      },
    }
  );
  assert.equal(values.leadName, "Sam");
  assert.equal(values.calendarConnected, "true");
  assert.equal("access_token" in values, false);
  assert.equal("calendarConnectionId" in values, false);
});

await test("Tenant A cannot load Tenant B's connection via agent lookup", async () => {
  const calendar = await loadCalendarDialContext(
    createFakeDb({
      connections: [
        activeConnection({ id: CONN_B, tenantId: TENANT_B, agentId: AGENT_B }),
      ],
      agents: [{ id: AGENT_A, tenant_id: TENANT_A, tz: "Asia/Dubai" }],
    }),
    { tenantId: TENANT_A, agentId: AGENT_A }
  );
  assert.equal(calendar.connected, false);
  assert.equal(calendar.metadata.calendarConnectionId, null);
  assert.equal(calendar.metadata.agentId, AGENT_A);
});

await test("Agent A cannot load Agent B's connection on the same tenant", async () => {
  const calendar = await loadCalendarDialContext(
    createFakeDb({
      connections: [
        activeConnection({ id: CONN_B, tenantId: TENANT_A, agentId: AGENT_B }),
      ],
      agents: [{ id: AGENT_A, tenant_id: TENANT_A, tz: "Asia/Dubai" }],
    }),
    { tenantId: TENANT_A, agentId: AGENT_A }
  );
  assert.equal(calendar.connected, false);
  assert.equal(calendar.metadata.calendarConnectionId, null);
});

await test("batch calls use the batch owner, not another tenant agent", async () => {
  const db = createFakeDb({
    batches: [{ id: BATCH_A, tenant_id: TENANT_A, agent_id: AGENT_A }],
    agents: [
      { id: AGENT_A, tenant_id: TENANT_A },
      { id: AGENT_B, tenant_id: TENANT_A },
    ],
  });
  const id = await resolveQueueAgentId(db, {
    tenantId: TENANT_A,
    batchId: BATCH_A,
    requestedBy: AGENT_B,
  });
  assert.equal(id, AGENT_A);
});

await test("queue requested_by UUID is accepted only for the same tenant", async () => {
  const db = createFakeDb({
    agents: [{ id: AGENT_A, tenant_id: TENANT_A }],
  });
  assert.equal(
    await resolveQueueAgentId(db, { tenantId: TENANT_A, requestedBy: AGENT_A }),
    AGENT_A
  );
  assert.equal(
    await resolveQueueAgentId(db, { tenantId: TENANT_A, requestedBy: AGENT_B }),
    null
  );
  assert.equal(
    await resolveQueueAgentId(db, { tenantId: TENANT_B, requestedBy: AGENT_A }),
    null
  );
});

await test("published assistant includes calendar tools and tool-calls serverMessages", () => {
  const body = buildVapiAssistantWriteBody({
    name: "1416 — Cold list",
    prompt: "You are Allan.",
    voiceId: "Elliot",
  });
  const names = body.model.tools.map((tool) => tool.function.name).sort();
  assert.deepEqual(names, ["book_appointment", "check_availability"]);
  assert.equal(
    body.model.tools.every((tool) => tool.type === "function"),
    true
  );
  assert.equal(
    body.model.tools.some((tool) => isNativeGoogleCalendarTool(tool)),
    false
  );
  assert.ok(body.serverMessages.includes("tool-calls"));
  for (const required of VAPI_REQUIRED_SERVER_MESSAGES) {
    assert.ok(body.serverMessages.includes(required));
  }
  assert.equal(body.server.url, "https://agentzero.example/api/vapi/webhook");
  assert.equal(body.model.provider, "groq");
  assert.equal(body.firstMessageMode, "assistant-waits-for-user");
  assert.equal(hasSecret(body), false);
});

await test("publish merge preserves existing tools and serverMessages", () => {
  const existing = {
    serverMessages: ["end-of-call-report", "hang", "status-update"],
    model: {
      tools: [
        { type: "function", function: { name: "send_sms" } },
        { type: "google.calendar.availability.check", function: { name: "google_freebusy" } },
      ],
      toolIds: ["tool-keep-me"],
    },
  };
  const body = buildVapiAssistantWriteBody({
    name: "1416 — Cold list",
    prompt: "You are Allan.",
    voiceId: "Elliot",
    existingAssistant: existing,
  });
  const names = body.model.tools.map((tool) => tool.function?.name || tool.name);
  assert.ok(names.includes("send_sms"));
  assert.ok(names.includes("check_availability"));
  assert.ok(names.includes("book_appointment"));
  assert.equal(names.includes("google_freebusy"), false);
  assert.deepEqual(body.model.toolIds, ["tool-keep-me"]);
  assert.ok(body.serverMessages.includes("hang"));
  assert.ok(body.serverMessages.includes("tool-calls"));
  assert.ok(body.serverMessages.includes("end-of-call-report"));
});

await test("merge helpers drop native Google Calendar tools", () => {
  const merged = mergeAssistantModelTools(
    [{ type: "google.calendar.event.create" }, { type: "function", function: { name: "other" } }],
    calendarToolsForAssistant("https://example.com/api/vapi/webhook")
  );
  assert.equal(merged.some(isNativeGoogleCalendarTool), false);
  assert.equal(
    merged.filter((tool) => tool.function?.name === "other").length,
    1
  );
});

await test("serverMessages merge never drops existing events", () => {
  const merged = mergeServerMessages(["conversation-update", "end-of-call-report"]);
  assert.ok(merged.includes("conversation-update"));
  assert.ok(merged.includes("end-of-call-report"));
  assert.ok(merged.includes("tool-calls"));
  assert.ok(merged.includes("status-update"));
});

await test("composed prompt mentions calendarConnected true/false without hard-coded ids", () => {
  assert.equal(PREAMBLE_VERSION, 5);
  const prompt = composePrompt({
    config: { goal: "book_viewing", find_out: [], rules: [], opening_line: "Hi." },
    tenant: { slug: "1416", name: "1416", persona_name: "Allan" },
    script: { display_name: "Book a viewing" },
  });
  assert.match(prompt, /calendarConnected/);
  assert.match(prompt, /check_availability/);
  assert.match(prompt, /book_appointment/);
  assert.match(prompt, /do not call calendar tools/i);
  assert.match(prompt, /Sunday to Thursday/);
  assert.doesNotMatch(prompt, /11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(prompt, /calendarConnectionId/);
});

console.log("\nAll calendar Phase 4 dial tests passed.");
