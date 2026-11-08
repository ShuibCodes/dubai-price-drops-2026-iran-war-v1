import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptCalendarTokens } from "../src/lib/calendar/tokens.js";
import {
  processCalendarOrphanEvents,
  processSingleOrphanFailure,
} from "../src/lib/calendar/cleanup.js";

process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("hex");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "22222222-2222-4222-8222-222222222222";
const CONN_A = "33333333-3333-4333-8333-333333333333";
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function cipher(access = "access-aaa", refresh = "refresh-aaa") {
  return encryptCalendarTokens({
    access_token: access,
    refresh_token: refresh,
    expires_at: FUTURE,
  });
}

function createFakeDbForCleanup({
  connections = [],
  failures = [],
} = {}) {
  const tables = {
    calendar_connections: connections.map((r) => ({ ...r })),
    calendar_compensation_failures: failures.map((r) => ({ ...r })),
  };

  return {
    tables,
    from(table) {
      const rows = tables[table] || [];
      const filters = {};
      let inFilters = {};
      let updateFields = null;

      const api = {
        select() {
          return api;
        },
        eq(col, val) {
          filters[col] = val;
          return api;
        },
        in(col, vals) {
          inFilters[col] = vals;
          return api;
        },
        order() {
          return api;
        },
        limit(n) {
          return api;
        },
        update(fields) {
          updateFields = { ...fields };
          return api;
        },
        then(resolve, reject) {
          if (updateFields) {
            const matched = rows.filter((r) =>
              Object.entries(filters).every(([k, v]) => r[k] === v)
            );
            matched.forEach((m) => Object.assign(m, updateFields));
            return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
          }
          let result = rows.filter((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v)
          );
          if (inFilters) {
            Object.entries(inFilters).forEach(([col, vals]) => {
              result = result.filter((r) => vals.includes(r[col]));
            });
          }
          return Promise.resolve({ data: result, error: null }).then(resolve, reject);
        },
        maybeSingle() {
          const found = rows.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v)
          );
          return Promise.resolve({ data: found ? { ...found } : null, error: null });
        },
        single() {
          const found = rows.find((r) =>
            Object.entries(filters).every(([k, v]) => r[k] === v)
          );
          return Promise.resolve({
            data: found ? { ...found } : null,
            error: found ? null : { message: "not found" },
          });
        },
      };

      return api;
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

await test("orphan cleanup resolves pending failure and calls Google delete", async () => {
  const deletedEvents = [];
  const fakeDb = createFakeDbForCleanup({
    connections: [
      {
        id: CONN_A,
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_id: "primary",
        token_ciphertext: cipher(),
        status: "active",
      },
    ],
    failures: [
      {
        id: "fail-1",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_connection_id: CONN_A,
        provider_event_id: "google-evt-123",
        status: "pending",
        retry_count: 0,
        reason: "compensation_delete_failed",
      },
    ],
  });

  const mockGoogle = {
    async deleteEvent(input) {
      deletedEvents.push(input);
      return { deleted: true };
    },
    async refreshAccessToken() {
      return { access_token: "new-access" };
    },
  };

  const summary = await processCalendarOrphanEvents({
    supabase: fakeDb,
    google: mockGoogle,
  });

  assert.equal(summary.total, 1);
  assert.equal(summary.resolved, 1);
  assert.equal(deletedEvents.length, 1);
  assert.equal(deletedEvents[0].eventId, "google-evt-123");

  const row = fakeDb.tables.calendar_compensation_failures[0];
  assert.equal(row.status, "resolved");
  assert.ok(row.resolved_at);
});

await test("orphan cleanup handles alreadyGone (404/410) as resolved", async () => {
  const fakeDb = createFakeDbForCleanup({
    connections: [
      {
        id: CONN_A,
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_id: "primary",
        token_ciphertext: cipher(),
        status: "active",
      },
    ],
    failures: [
      {
        id: "fail-2",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_connection_id: CONN_A,
        provider_event_id: "google-evt-404",
        status: "pending",
        retry_count: 0,
      },
    ],
  });

  const mockGoogle = {
    async deleteEvent() {
      return { deleted: true, alreadyGone: true };
    },
  };

  const summary = await processCalendarOrphanEvents({
    supabase: fakeDb,
    google: mockGoogle,
  });

  assert.equal(summary.resolved, 1);
  assert.equal(fakeDb.tables.calendar_compensation_failures[0].status, "resolved");
});

await test("orphan cleanup marks abandoned after reaching max retries", async () => {
  const fakeDb = createFakeDbForCleanup({
    connections: [
      {
        id: CONN_A,
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_id: "primary",
        token_ciphertext: cipher(),
        status: "active",
      },
    ],
    failures: [
      {
        id: "fail-3",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_connection_id: CONN_A,
        provider_event_id: "google-evt-retry-out",
        status: "pending",
        retry_count: 5, // maxed out
      },
    ],
  });

  const summary = await processCalendarOrphanEvents({
    supabase: fakeDb,
    maxRetries: 5,
  });

  assert.equal(summary.abandoned, 1);
  assert.equal(fakeDb.tables.calendar_compensation_failures[0].status, "abandoned");
});

await test("orphan cleanup marks abandoned when calendar connection no longer exists", async () => {
  const fakeDb = createFakeDbForCleanup({
    connections: [], // missing
    failures: [
      {
        id: "fail-4",
        tenant_id: TENANT_A,
        agent_id: AGENT_A,
        calendar_connection_id: "non-existent-conn",
        provider_event_id: "google-evt-lost",
        status: "pending",
        retry_count: 0,
      },
    ],
  });

  const summary = await processCalendarOrphanEvents({
    supabase: fakeDb,
  });

  assert.equal(summary.abandoned, 1);
  assert.equal(fakeDb.tables.calendar_compensation_failures[0].status, "abandoned");
});

console.log("\nAll calendar orphan cleanup tests passed.");

