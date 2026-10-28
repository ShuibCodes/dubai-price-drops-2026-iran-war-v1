import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  parseAllowedToolArguments,
  resolveTrustedCalendarContext,
  handleVapiCalendarToolCalls,
  CALENDAR_TOOL_NAMES,
  VAPI_CALENDAR_TOOL_DEFINITIONS,
} from "../src/lib/calendar/tools.js";
import { encryptCalendarTokens } from "../src/lib/calendar/tokens.js";
import {
  extractVapiToolCalls,
  extractVapiToolCallContext,
  isVapiToolCallsMessage,
  vapiToolCallsResponse,
} from "../src/lib/vapi/tool-calls.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "44444444-4444-4444-8444-444444444444";
const AGENT_A = "22222222-2222-4222-8222-222222222222";
const AGENT_B = "55555555-5555-4555-8555-555555555555";
const CONN_A = "33333333-3333-4333-8333-333333333333";
const CONN_B = "66666666-6666-4666-8666-666666666666";
const CONN_A2 = "77777777-7777-4777-8777-777777777777";
const LEAD_A = "88888888-8888-4888-8888-888888888888";
const LEAD_B = "99999999-9999-4999-8999-999999999999";
const CALL_ROW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("hex");
process.env.GOOGLE_CALENDAR_CLIENT_ID = "client.apps.googleusercontent.com";
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret";
process.env.GOOGLE_CALENDAR_REDIRECT_URI =
  "https://example.com/api/console/calendar/callback";

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

function hasSecret(value) {
  return /access_token|refresh_token|token_ciphertext|"token":|ya29\.|1\/\/|google-secret/i.test(
    typeof value === "string" ? value : JSON.stringify(value)
  );
}

function cipher(access = "access-aaa", refresh = "refresh-aaa", expiresAt = FUTURE) {
  return encryptCalendarTokens({
    access_token: access,
    refresh_token: refresh,
    expires_at: expiresAt,
  });
}

function activeConnection({
  id = CONN_A,
  tenantId = TENANT_A,
  agentId = AGENT_A,
  status = "active",
  expiresAt = FUTURE,
  access = "access-aaa",
} = {}) {
  return {
    id,
    tenant_id: tenantId,
    agent_id: agentId,
    provider: "google",
    google_account_email: "agent-a@example.com",
    calendar_id: "primary",
    calendar_summary: "Agent A",
    calendar_timezone: "Asia/Dubai",
    token_ciphertext: status === "active" ? cipher(access, "refresh-aaa", expiresAt) : null,
    token_expires_at: expiresAt,
    scopes: [],
    status,
  };
}

function createFakeDb({
  connections = [],
  appointments = [],
  leads = [],
  jarvisLeads = [],
  calls = [],
  appointmentInsertError = null,
  // B2: set to true to simulate the unique-index violation on second insert
  appointmentDuplicateOnSecondInsert = false,
} = {}) {
  const tables = {
    calendar_connections: connections.map((row) => ({ ...row })),
    appointments: appointments.map((row) => ({ ...row })),
    leads: leads.map((row) => ({ ...row })),
    jarvis_leads: jarvisLeads.map((row) => ({ ...row })),
    calls: calls.map((row) => ({ ...row })),
    // B1: compensation failures log
    calendar_compensation_failures: [],
  };
  let appointmentInsertCount = 0;
  return {
    tables,
    from(table) {
      if (!tables[table]) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          insert() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: null,
              error: { message: `schema cache: ${table}` },
            });
          },
          single() {
            return Promise.resolve({
              data: null,
              error: { message: `schema cache: ${table}` },
            });
          },
        };
      }
      const rows = tables[table];
      const filters = {};
      let pendingInsert = null;
      let pendingUpdate = null;
      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        insert(row) {
          pendingInsert = { ...row };
          return api;
        },
        then(resolve, reject) {
          if (pendingInsert) {
            const saved = { id: `row-${rows.length + 1}`, ...pendingInsert };
            rows.push(saved);
            pendingInsert = null;
            return Promise.resolve({ data: [saved], error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
        update(row) {
          pendingUpdate = { ...row };
          return api;
        },
        maybeSingle() {
          if (pendingUpdate) {
            const found = rows.find((row) =>
              Object.entries(filters).every(([key, value]) => row[key] === value)
            );
            if (found) Object.assign(found, pendingUpdate);
            return Promise.resolve({
              data: found ? { ...found } : null,
              error: found ? null : { message: "not found" },
            });
          }
          const found = rows.find((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value)
          );
          return Promise.resolve({ data: found ? { ...found } : null, error: null });
        },
        single() {
          if (pendingInsert) {
            if (table === "appointments") {
              appointmentInsertCount += 1;
              // B2: simulate unique-index violation on the second concurrent insert
              if (
                appointmentInsertError ||
                (appointmentDuplicateOnSecondInsert && appointmentInsertCount > 1)
              ) {
                return Promise.resolve({
                  data: null,
                  error: { message: appointmentInsertError || "duplicate key value violates unique constraint appointments_agent_start_booked_idx" },
                });
              }
            }
            // calendar_compensation_failures has no error path by default
            const saved = { id: `row-${rows.length + 1}`, ...pendingInsert };
            rows.push(saved);
            return Promise.resolve({ data: { ...saved }, error: null });
          }
          const found = rows.find((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value)
          );
          if (!found) {
            return Promise.resolve({ data: null, error: { message: "not found" } });
          }
          return Promise.resolve({ data: { ...found }, error: null });
        },
      };
      return api;
    },
  };
}

function officialToolCallsPayload({
  toolCallId = "toolu_01DTPAzUm5Gk3zxrpJ969oMF",
  name = "check_availability",
  args = {
    startDateTime: "2026-09-21T10:00:00+04:00",
    endDateTime: "2026-09-21T10:30:00+04:00",
    timeZone: "Asia/Dubai",
  },
  metadata = {
    tenantId: TENANT_A,
    agentId: AGENT_A,
    calendarConnectionId: CONN_A,
  },
  argKey = "arguments",
  includeToolWithList = true,
} = {}) {
  const toolCallListItem = { id: toolCallId, name, [argKey]: args };
  return {
    message: {
      timestamp: 1678901234567,
      type: "tool-calls",
      toolCallList: [toolCallListItem],
      toolWithToolCallList: includeToolWithList
        ? [
            {
              type: "function",
              name,
              parameters: { type: "object", properties: {} },
              toolCall: {
                id: toolCallId,
                type: "function",
                function: { name, parameters: args },
              },
            },
          ]
        : [],
      call: {
        id: "call-uuid",
        orgId: "org-uuid",
        type: "webCall",
        metadata,
      },
    },
  };
}

function mockGoogle({
  busy = [],
  eventId = "evt-1",
  onFreeBusy,
  onCreate,
  onDelete,
  onRefresh,
  deleteError = null,
} = {}) {
  return {
    async checkFreeBusy(input) {
      if (onFreeBusy) onFreeBusy(input);
      return {
        calendarId: input.calendarId,
        timeMin: input.startDateTime,
        timeMax: input.endDateTime,
        busy,
      };
    },
    async createEvent(input) {
      if (onCreate) onCreate(input);
      return {
        eventId,
        htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
        start: { dateTime: input.startDateTime },
        end: { dateTime: input.endDateTime },
        status: "confirmed",
      };
    },
    async deleteEvent(input) {
      if (onDelete) onDelete(input);
      if (deleteError) throw deleteError;
      return { deleted: true };
    },
    async refreshAccessToken(refreshToken) {
      if (onRefresh) return onRefresh(refreshToken);
      throw new Error("refresh should not run");
    },
  };
}

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok  ${name}`);
    });
}

await test("official custom-tools payload uses toolCallList.id/name/arguments", () => {
  const payload = officialToolCallsPayload();
  assert.equal(isVapiToolCallsMessage(payload), true);
  const calls = extractVapiToolCalls(payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "toolu_01DTPAzUm5Gk3zxrpJ969oMF");
  assert.equal(calls[0].name, "check_availability");
  assert.equal(calls[0].arguments.startDateTime, "2026-09-21T10:00:00+04:00");
  const ctx = extractVapiToolCallContext(payload);
  assert.equal(ctx.callId, "call-uuid");
  assert.equal(ctx.metadata.tenantId, TENANT_A);
});

await test("official server-events payload uses toolCallList.parameters", () => {
  const payload = officialToolCallsPayload({ argKey: "parameters" });
  const calls = extractVapiToolCalls(payload);
  assert.equal(calls[0].arguments.timeZone, "Asia/Dubai");
});

await test("toolWithToolCallList fallback when toolCallList is empty", () => {
  const payload = officialToolCallsPayload();
  payload.message.toolCallList = [];
  const calls = extractVapiToolCalls(payload);
  assert.equal(calls[0].id, "toolu_01DTPAzUm5Gk3zxrpJ969oMF");
  assert.equal(calls[0].arguments.startDateTime, "2026-09-21T10:00:00+04:00");
});

await test("response shape is { results: [{ toolCallId, result }] } single-line", () => {
  const body = vapiToolCallsResponse([
    { toolCallId: "toolu_01", result: "Available. The requested slot is free." },
  ]);
  assert.deepEqual(Object.keys(body), ["results"]);
  assert.equal(body.results[0].toolCallId, "toolu_01");
  assert.equal(typeof body.results[0].result, "string");
  assert.equal(body.results[0].result.includes("\n"), false);
});

await test("tool definitions never expose routing or token fields", () => {
  assert.equal(CALENDAR_TOOL_NAMES.has("check_availability"), true);
  assert.equal(CALENDAR_TOOL_NAMES.has("book_appointment"), true);
  const json = JSON.stringify(VAPI_CALENDAR_TOOL_DEFINITIONS);
  assert.doesNotMatch(json, /tenantId|agentId|calendarConnectionId|calendarId|access_token|refresh_token/);
});

await test("metadata validation requires tenant + agent + connection", () => {
  assert.equal(resolveTrustedCalendarContext(null).ok, false);
  assert.equal(resolveTrustedCalendarContext({}).ok, false);
  assert.match(resolveTrustedCalendarContext({ tenantId: TENANT_A }).error, /tenant or agent/);
  assert.match(
    resolveTrustedCalendarContext({ tenantId: TENANT_A, agentId: AGENT_A }).error,
    /No calendar is connected/
  );
  const ok = resolveTrustedCalendarContext({
    tenantId: TENANT_A,
    agentId: AGENT_A,
    calendarConnectionId: CONN_A,
    leadId: LEAD_A,
    source: "outbound",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.tenantId, TENANT_A);
  assert.equal(ok.data.leadId, LEAD_A);
});

await test("model-supplied calendar identifiers and tokens are rejected", () => {
  const calendarId = parseAllowedToolArguments("check_availability", {
    startDateTime: "2026-09-21T10:00:00+04:00",
    endDateTime: "2026-09-21T10:30:00+04:00",
    calendarId: "someone-else@example.com",
  });
  assert.equal(calendarId.ok, false);
  assert.match(calendarId.error, /cannot include/);

  const tokens = parseAllowedToolArguments("book_appointment", {
    startDateTime: "2026-09-21T10:00:00+04:00",
    access_token: "ya29.leak",
    refresh_token: "1//leak",
  });
  assert.equal(tokens.ok, false);

  const routing = parseAllowedToolArguments("check_availability", {
    startDateTime: "2026-09-21T10:00:00+04:00",
    tenantId: TENANT_B,
    agentId: AGENT_B,
    calendarConnectionId: CONN_B,
  });
  assert.equal(routing.ok, false);
});

await test("invalid tool names fail safely", async () => {
  const google = mockGoogle({
    onFreeBusy() {
      throw new Error("Google must not be called");
    },
  });
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "delete_calendar" }),
    { supabase: createFakeDb({ connections: [activeConnection()] }), google }
  );
  assert.equal(results[0].error.includes("Unknown tool"), true);
  assert.equal(results[0].toolCallId, "toolu_01DTPAzUm5Gk3zxrpJ969oMF");
  assert.equal(hasSecret(results), false);
});

await test("missing metadata fails closed without Google", async () => {
  let called = false;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ metadata: {} }),
    {
      supabase: createFakeDb({ connections: [activeConnection()] }),
      google: mockGoogle({
        onFreeBusy() {
          called = true;
        },
      }),
    }
  );
  assert.equal(called, false);
  assert.match(results[0].error, /metadata/i);
});

await test("check_availability uses the connected calendar FreeBusy window", async () => {
  const seen = [];
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: createFakeDb({ connections: [activeConnection()] }),
    google: mockGoogle({
      onFreeBusy(input) {
        seen.push(input);
      },
    }),
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].calendarId, "primary");
  assert.equal(seen[0].accessToken, "access-aaa");
  assert.equal(seen[0].startDateTime, "2026-09-21T10:00:00+04:00");
  assert.match(results[0].result, /Available/);
  assert.equal(hasSecret(results), false);
});

await test("check_availability reports busy slots without tokens", async () => {
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: createFakeDb({ connections: [activeConnection()] }),
    google: mockGoogle({
      busy: [{ start: "2026-09-21T10:00:00+04:00", end: "2026-09-21T11:00:00+04:00" }],
    }),
  });
  assert.match(results[0].result, /Unavailable/);
  assert.equal(hasSecret(results), false);
});

await test("Tenant A cannot use Tenant B calendarConnectionId", async () => {
  let called = false;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      metadata: {
        tenantId: TENANT_A,
        agentId: AGENT_A,
        calendarConnectionId: CONN_B,
      },
    }),
    {
      supabase: createFakeDb({
        connections: [
          activeConnection(),
          activeConnection({ id: CONN_B, tenantId: TENANT_B, agentId: AGENT_B }),
        ],
      }),
      google: mockGoogle({
        onFreeBusy() {
          called = true;
        },
      }),
    }
  );
  assert.equal(called, false);
  assert.match(results[0].error, /No matching calendar/);
});

await test("Agent A cannot use Agent B connection on the same tenant", async () => {
  let called = false;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      metadata: {
        tenantId: TENANT_A,
        agentId: AGENT_A,
        calendarConnectionId: CONN_A2,
      },
    }),
    {
      supabase: createFakeDb({
        connections: [
          activeConnection(),
          activeConnection({ id: CONN_A2, tenantId: TENANT_A, agentId: AGENT_B }),
        ],
      }),
      google: mockGoogle({
        onFreeBusy() {
          called = true;
        },
      }),
    }
  );
  assert.equal(called, false);
  assert.match(results[0].error, /No matching calendar/);
});

await test("revoked connections cannot be used", async () => {
  let called = false;
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: createFakeDb({
      connections: [activeConnection({ status: "revoked" })],
    }),
    google: mockGoogle({
      onFreeBusy() {
        called = true;
      },
    }),
  });
  assert.equal(called, false);
  assert.match(results[0].error, /no longer active/);
});

await test("book_appointment re-checks availability then persists after Google success", async () => {
  const db = createFakeDb({
    connections: [activeConnection()],
    leads: [{ id: LEAD_A, tenant_id: TENANT_A }],
    calls: [{ id: CALL_ROW, tenant_id: TENANT_A, vapi_call_id: "call-uuid" }],
  });
  const created = [];
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      name: "book_appointment",
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        durationMinutes: 30,
        summary: "Marina viewing",
        timeZone: "Asia/Dubai",
      },
      metadata: {
        tenantId: TENANT_A,
        agentId: AGENT_A,
        calendarConnectionId: CONN_A,
        leadId: LEAD_A,
      },
    }),
    {
      supabase: db,
      google: mockGoogle({
        onCreate(input) {
          created.push(input);
        },
      }),
    }
  );
  assert.equal(created.length, 1);
  assert.equal(created[0].calendarId, "primary");
  assert.equal(created[0].summary, "Marina viewing");
  assert.equal(created[0].accessToken, "access-aaa");
  assert.match(results[0].result, /Booked/);
  assert.equal(hasSecret(results), false);
  assert.equal(db.tables.appointments.length, 1);
  const row = db.tables.appointments[0];
  assert.equal(row.tenant_id, TENANT_A);
  assert.equal(row.agent_id, AGENT_A);
  assert.equal(row.calendar_connection_id, CONN_A);
  assert.equal(row.lead_id, LEAD_A);
  assert.equal(row.call_id, CALL_ROW);
  assert.equal(row.vapi_call_id, "call-uuid");
  assert.equal(row.summary, "Marina viewing");
  assert.equal(row.provider_event_id, "evt-1");
  assert.equal(row.status, "booked");
  assert.equal(row.timezone, "Asia/Dubai");
  assert.equal(hasSecret(row), false);
});

await test("book_appointment does not confirm when appointment persist fails and Google event is deleted", async () => {
  const deleted = [];
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentInsertError: "insert failed",
  });
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      name: "book_appointment",
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        durationMinutes: 30,
        summary: "Marina viewing",
      },
    }),
    {
      supabase: db,
      google: mockGoogle({
        onDelete(input) {
          deleted.push(input);
        },
      }),
    }
  );
  assert.equal(db.tables.appointments.length, 0);
  assert.equal(results[0].result, undefined);
  assert.doesNotMatch(JSON.stringify(results), /Booked/);
  assert.match(results[0].error, /Could not book/);
  assert.match(results[0].error, /not confirmed/);
  assert.match(results[0].error, /released/);
  assert.doesNotMatch(results[0].error, /evt-1/);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].eventId, "evt-1");
  assert.equal(deleted[0].calendarId, "primary");
  assert.equal(deleted[0].accessToken, "access-aaa");
  assert.equal(hasSecret(results), false);
});

await test("book_appointment does not claim the Google event was deleted when compensation fails", async () => {
  const deleted = [];
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentInsertError: "insert failed",
  });
  const deleteErr = new Error("Google Calendar: backendError");
  deleteErr.status = 500;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    {
      supabase: db,
      google: mockGoogle({
        onDelete(input) {
          deleted.push(input);
        },
        deleteError: deleteErr,
      }),
    }
  );
  assert.equal(db.tables.appointments.length, 0);
  assert.equal(deleted.length, 1);
  assert.equal(results[0].result, undefined);
  assert.doesNotMatch(JSON.stringify(results), /Booked/);
  assert.match(results[0].error, /Could not book/);
  assert.match(results[0].error, /not confirmed/);
  assert.doesNotMatch(results[0].error, /released/);
  assert.doesNotMatch(results[0].error, /deleted/);
  assert.equal(hasSecret(results), false);
});

await test("book_appointment persist failure without a delete helper does not confirm or claim deletion", async () => {
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentInsertError: "insert failed",
  });
  const google = mockGoogle();
  delete google.deleteEvent;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    { supabase: db, google }
  );
  assert.equal(db.tables.appointments.length, 0);
  assert.equal(results[0].result, undefined);
  assert.doesNotMatch(JSON.stringify(results), /Booked/);
  assert.match(results[0].error, /Could not book/);
  assert.doesNotMatch(results[0].error, /released/);
  assert.equal(hasSecret(results), false);
});

await test("book_appointment persist failure retries event delete after a 401", async () => {
  let deleteCalls = 0;
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentInsertError: "insert failed",
  });
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    {
      supabase: db,
      google: {
        ...mockGoogle({
          onRefresh() {
            return {
              access_token: "fresh-access",
              refresh_token: "refresh-aaa",
              expires_at: FUTURE,
            };
          },
        }),
        async deleteEvent(input) {
          deleteCalls += 1;
          if (deleteCalls === 1) {
            const error = new Error("Google Calendar: Invalid Credentials");
            error.status = 401;
            throw error;
          }
          assert.equal(input.accessToken, "fresh-access");
          assert.equal(input.eventId, "evt-1");
          return { deleted: true };
        },
      },
    }
  );
  assert.equal(deleteCalls, 2);
  assert.equal(db.tables.appointments.length, 0);
  assert.match(results[0].error, /released/);
  assert.doesNotMatch(JSON.stringify(results), /Booked/);
});

await test("book_appointment does not persist when the slot is no longer free", async () => {
  const db = createFakeDb({ connections: [activeConnection()] });
  let created = false;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    {
      supabase: db,
      google: mockGoogle({
        busy: [{ start: "2026-09-21T10:00:00+04:00", end: "2026-09-21T10:30:00+04:00" }],
        onCreate() {
          created = true;
        },
      }),
    }
  );
  assert.equal(created, false);
  assert.equal(db.tables.appointments.length, 0);
  assert.match(results[0].result, /Could not book/);
});

await test("book_appointment ignores a lead id that belongs to another tenant", async () => {
  const db = createFakeDb({
    connections: [activeConnection()],
    leads: [{ id: LEAD_B, tenant_id: TENANT_B }],
  });
  await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      name: "book_appointment",
      metadata: {
        tenantId: TENANT_A,
        agentId: AGENT_A,
        calendarConnectionId: CONN_A,
        leadId: LEAD_B,
      },
    }),
    { supabase: db, google: mockGoogle() }
  );
  assert.equal(db.tables.appointments[0].lead_id, null);
});

await test("expired access token is refreshed server-side only", async () => {
  let refreshed = false;
  const db = createFakeDb({
    connections: [activeConnection({ expiresAt: PAST, access: "stale-access" })],
  });
  const before = db.tables.calendar_connections[0].token_ciphertext;
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: db,
    google: mockGoogle({
      onFreeBusy(input) {
        assert.equal(input.accessToken, "fresh-access");
      },
      onRefresh(refreshToken) {
        refreshed = true;
        assert.equal(refreshToken, "refresh-aaa");
        return {
          access_token: "fresh-access",
          refresh_token: "refresh-aaa",
          expires_at: FUTURE,
        };
      },
    }),
  });
  assert.equal(refreshed, true);
  assert.match(results[0].result, /Available/);
  assert.equal(hasSecret(results), false);
  assert.notEqual(db.tables.calendar_connections[0].token_ciphertext, before);
  assert.equal(db.tables.calendar_connections[0].status, "active");
});

await test("invalid_grant marks the connection error and does not leak tokens", async () => {
  const db = createFakeDb({
    connections: [activeConnection({ expiresAt: PAST, access: "stale-access" })],
  });
  let called = false;
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: db,
    google: mockGoogle({
      onFreeBusy() {
        called = true;
      },
      onRefresh() {
        const error = new Error("Google Calendar: Token has been expired or revoked.");
        error.status = 400;
        error.body = {
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        };
        throw error;
      },
    }),
  });
  assert.equal(called, false);
  assert.match(results[0].error, /no longer valid/);
  assert.equal(db.tables.calendar_connections[0].status, "error");
  assert.equal(hasSecret(results), false);
  assert.equal(hasSecret(db.tables.calendar_connections[0].last_error), false);
});

await test("401 from Google retries after a forced refresh", async () => {
  let freeBusyCalls = 0;
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: createFakeDb({ connections: [activeConnection()] }),
    google: {
      async checkFreeBusy(input) {
        freeBusyCalls += 1;
        if (freeBusyCalls === 1) {
          const error = new Error("Google Calendar: Invalid Credentials");
          error.status = 401;
          throw error;
        }
        assert.equal(input.accessToken, "fresh-access");
        return { calendarId: "primary", busy: [] };
      },
      async createEvent() {
        throw new Error("create should not run");
      },
      async refreshAccessToken() {
        return { access_token: "fresh-access", refresh_token: "refresh-aaa", expires_at: FUTURE };
      },
    },
  });
  assert.equal(freeBusyCalls, 2);
  assert.match(results[0].result, /Available/);
});

await test("default duration keeps the original timezone offset", async () => {
  const created = [];
  const db = createFakeDb({ connections: [activeConnection()] });
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      name: "book_appointment",
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        summary: "Marina viewing",
      },
    }),
    {
      supabase: db,
      google: mockGoogle({
        onCreate(input) {
          created.push(input);
        },
      }),
    }
  );
  assert.equal(created[0].endDateTime, "2026-09-21T10:30:00+04:00");
  assert.equal(created[0].timeZone, "Asia/Dubai");
  assert.equal(db.tables.appointments[0].end_at, "2026-09-21T10:30:00+04:00");
  assert.match(results[0].result, /\+04:00/);
  assert.doesNotMatch(results[0].result, /10:30:00\.000Z/);
});

await test("stored calendar timezone wins over a model-supplied timezone", async () => {
  const seen = [];
  await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        endDateTime: "2026-09-21T10:30:00+04:00",
        timeZone: "Europe/London",
      },
    }),
    {
      supabase: createFakeDb({ connections: [activeConnection()] }),
      google: mockGoogle({
        onFreeBusy(input) {
          seen.push(input);
        },
      }),
    }
  );
  assert.equal(seen[0].timeZone, "Asia/Dubai");
});

await test("15-minute busy buffer rejects a slot that only looks free", async () => {
  const results = await handleVapiCalendarToolCalls(officialToolCallsPayload(), {
    supabase: createFakeDb({ connections: [activeConnection()] }),
    google: mockGoogle({
      busy: [{ start: "2026-09-21T10:35:00+04:00", end: "2026-09-21T11:00:00+04:00" }],
    }),
  });
  assert.match(results[0].result, /Unavailable/);
});

await test("slots outside the viewing window never call Google", async () => {
  let called = false;
  const friday = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      args: {
        startDateTime: "2026-09-25T10:00:00+04:00",
        endDateTime: "2026-09-25T10:30:00+04:00",
      },
    }),
    {
      supabase: createFakeDb({ connections: [activeConnection()] }),
      google: mockGoogle({
        onFreeBusy() {
          called = true;
        },
      }),
    }
  );
  assert.equal(called, false);
  assert.match(friday[0].result, /Sunday to Thursday/);

  const late = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      args: {
        startDateTime: "2026-09-21T18:00:00+04:00",
        endDateTime: "2026-09-21T18:30:00+04:00",
      },
    }),
    {
      supabase: createFakeDb({ connections: [activeConnection()] }),
      google: mockGoogle({
        onFreeBusy() {
          called = true;
        },
      }),
    }
  );
  assert.equal(called, false);
  assert.match(late[0].result, /10:00 to 18:00/);
});

await test("model-supplied calendarId never reaches Google", async () => {
  let called = false;
  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        calendarId: "tenant-b@example.com",
      },
    }),
    {
      supabase: createFakeDb({ connections: [activeConnection()] }),
      google: mockGoogle({
        onFreeBusy() {
          called = true;
        },
      }),
    }
  );
  assert.equal(called, false);
  assert.match(results[0].error, /cannot include/);
});

await test("empty toolCallList returns empty results, not a 500 shape", async () => {
  const results = await handleVapiCalendarToolCalls(
    { message: { type: "tool-calls", toolCallList: [], call: { id: "x", metadata: {} } } },
    { supabase: createFakeDb(), google: mockGoogle() }
  );
  assert.deepEqual(results, []);
  assert.deepEqual(vapiToolCallsResponse(results), { results: [] });
});

// ── B1: orphan event is persisted when compensation delete also fails ────────

await test("[B1] orphan Google event is logged to calendar_compensation_failures when compensation delete fails", async () => {
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentInsertError: "insert failed",
  });
  const deleteErr = new Error("Google Calendar: backendError");
  deleteErr.status = 500;

  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    {
      supabase: db,
      google: mockGoogle({ deleteError: deleteErr }),
    }
  );

  // LLM still hears "not confirmed" (orphan, not compensated)
  assert.match(results[0].error, /Could not book/);
  assert.doesNotMatch(JSON.stringify(results), /Booked/);
  assert.equal(hasSecret(results), false);

  // B1: The orphan record must be persisted
  const failures = db.tables.calendar_compensation_failures;
  assert.equal(failures.length, 1, "Expected one compensation failure record");
  assert.equal(failures[0].provider_event_id, "evt-1");
  assert.equal(failures[0].agent_id, AGENT_A);
  assert.equal(failures[0].tenant_id, TENANT_A);
  assert.match(failures[0].reason, /compensation_delete_failed/);
  assert.equal(hasSecret(failures[0]), false);
});

await test("[B1] successful delete does NOT write a compensation failure record", async () => {
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentInsertError: "insert failed",
  });

  await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    { supabase: db, google: mockGoogle() }
  );

  // compensation succeeded (event deleted) — no orphan record needed
  assert.equal(db.tables.calendar_compensation_failures.length, 0);
});

// ── B2: unique partial index blocks concurrent double-booking ───────────────

await test("[B2] second concurrent booking is rejected by unique-index constraint and compensated", async () => {
  const db = createFakeDb({
    connections: [activeConnection()],
    appointmentDuplicateOnSecondInsert: true,
  });
  const deleted = [];

  // First booking succeeds
  const result1 = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      name: "book_appointment",
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        durationMinutes: 30,
        summary: "First booking",
      },
    }),
    { supabase: db, google: mockGoogle({ eventId: "evt-first" }) }
  );
  assert.match(result1[0].result, /Booked/);
  assert.equal(db.tables.appointments.length, 1);

  // Second booking at the same time hits the unique constraint
  const result2 = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({
      name: "book_appointment",
      args: {
        startDateTime: "2026-09-21T10:00:00+04:00",
        durationMinutes: 30,
        summary: "Second booking (concurrent)",
      },
    }),
    {
      supabase: db,
      google: mockGoogle({
        eventId: "evt-second",
        onDelete(input) { deleted.push(input); },
      }),
    }
  );

  // Must NOT confirm the second booking
  assert.doesNotMatch(JSON.stringify(result2), /Booked/);
  assert.match(result2[0].error, /Could not book/);
  assert.match(result2[0].error, /not confirmed/);
  assert.equal(hasSecret(result2), false);

  // The second Google event must be deleted (compensation)
  assert.equal(deleted.length, 1, "Compensation delete must run for second booking");
  assert.equal(deleted[0].eventId, "evt-second");

  // Only the first appointment persisted
  assert.equal(db.tables.appointments.length, 1);
  assert.equal(db.tables.appointments[0].summary, "First booking");
});

// ── P1: single connection lookup per book_appointment ──────────────────────

await test("[P1] book_appointment performs exactly one DB connection lookup, not two", async () => {
  let connectionLookups = 0;
  const realDb = createFakeDb({ connections: [activeConnection()] });

  // Intercept calendar_connections queries to count lookups
  const countingDb = {
    tables: realDb.tables,
    from(table) {
      const api = realDb.from(table);
      if (table === "calendar_connections") {
        const origMaybeSingle = api.maybeSingle.bind(api);
        api.maybeSingle = () => {
          connectionLookups += 1;
          return origMaybeSingle();
        };
      }
      return api;
    },
  };

  const results = await handleVapiCalendarToolCalls(
    officialToolCallsPayload({ name: "book_appointment" }),
    { supabase: countingDb, google: mockGoogle() }
  );

  assert.match(results[0].result, /Booked/);
  // P1 fix: exactly 1 lookup (from executeCalendarTool), not 2
  assert.equal(connectionLookups, 1, `Expected 1 connection lookup but got ${connectionLookups}`);
});

// ── S4: token patterns are redacted from error messages ────────────────────

await test("[S4] markCalendarConnectionError redacts token patterns including URL query tokens", async () => {
  const { markCalendarConnectionError } = await import("../src/lib/calendar/store.js");
  const db = createFakeDb({
    connections: [activeConnection()],
  });
  const conn = db.tables.calendar_connections[0];

  // Messages with various token leak patterns
  const messages = [
    "Error: access_token expired",
    "Error: refresh_token invalid for ya29.some_token",
    "URL error: ?access_token=ya29.abc123&refresh_token=1//xyz",
    "token_ciphertext decode failed",
    "\"token\": \"secret_value\"",
  ];

  for (const msg of messages) {
    await markCalendarConnectionError(db, conn, msg);
    const stored = db.tables.calendar_connections[0].last_error;
    assert.doesNotMatch(stored, /ya29\.|1\/\//, `Raw Google token prefix leaked in: "${stored}"`);
    assert.doesNotMatch(stored, /access_token.*=.*[a-zA-Z0-9]/, `Inline token value leaked in: "${stored}"`);
  }
});

// ── P3: Google API calls include AbortSignal.timeout(8000) ──────────────────

await test("[P3] Google API calls include an AbortSignal timeout", async () => {
  const {
    fetchPrimaryCalendar,
    checkGoogleFreeBusy,
    createGoogleCalendarEvent,
    deleteGoogleCalendarEvent,
    revokeGoogleToken,
  } = await import("../src/lib/calendar/google.js");

  const originalFetch = globalThis.fetch;
  const capturedSignals = [];

  globalThis.fetch = async (url, options = {}) => {
    capturedSignals.push({ url: String(url), signal: options?.signal });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "primary", items: [] }),
    };
  };

  try {
    await fetchPrimaryCalendar("test-access-token");
    assert.equal(capturedSignals.length, 1);
    assert.ok(capturedSignals[0].signal instanceof AbortSignal, "fetchPrimaryCalendar missing AbortSignal");

    await checkGoogleFreeBusy({
      accessToken: "test-access-token",
      startDateTime: "2026-09-21T10:00:00+04:00",
      endDateTime: "2026-09-21T10:30:00+04:00",
    });
    assert.equal(capturedSignals.length, 2);
    assert.ok(capturedSignals[1].signal instanceof AbortSignal, "checkGoogleFreeBusy missing AbortSignal");

    await createGoogleCalendarEvent({
      accessToken: "test-access-token",
      summary: "Viewing",
      startDateTime: "2026-09-21T10:00:00+04:00",
      endDateTime: "2026-09-21T10:30:00+04:00",
    });
    assert.equal(capturedSignals.length, 3);
    assert.ok(capturedSignals[2].signal instanceof AbortSignal, "createGoogleCalendarEvent missing AbortSignal");

    await deleteGoogleCalendarEvent({
      accessToken: "test-access-token",
      eventId: "evt-123",
    });
    assert.equal(capturedSignals.length, 4);
    assert.ok(capturedSignals[3].signal instanceof AbortSignal, "deleteGoogleCalendarEvent missing AbortSignal");

    await revokeGoogleToken("test-token");
    assert.equal(capturedSignals.length, 5);
    assert.ok(capturedSignals[4].signal instanceof AbortSignal, "revokeGoogleToken missing AbortSignal");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log("\nAll calendar Phase 3 tool-call tests passed.");
