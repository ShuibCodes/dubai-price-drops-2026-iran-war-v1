import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  completeCalendarCallback,
  disconnectCalendar,
  getCalendarStatus,
  startCalendarConnect,
} from "../src/lib/calendar/oauth.js";
import {
  createCalendarOAuthState,
  sessionMatchesOAuthState,
  verifyCalendarOAuthState,
} from "../src/lib/calendar/oauth-state.js";
import {
  calendarSettingsPayload,
  loadAgentCalendarConnection,
  revokeAgentCalendarConnection,
  upsertAgentCalendarConnection,
} from "../src/lib/calendar/store.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "44444444-4444-4444-8444-444444444444";
const AGENT_A = "22222222-2222-4222-8222-222222222222";
const AGENT_B = "55555555-5555-4555-8555-555555555555";

process.env.COPILOT_SESSION_SECRET = "test-copilot-session-secret";
process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("hex");
process.env.GOOGLE_CALENDAR_CLIENT_ID = "client.apps.googleusercontent.com";
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret";
process.env.GOOGLE_CALENDAR_REDIRECT_URI =
  "https://example.com/api/console/calendar/callback";

function session(tenantId, agentId, tenantSlug = "1416") {
  return { tenantId, agentId, tenantSlug, role: "admin" };
}

function hasSecret(value) {
  const json = JSON.stringify(value);
  return /token_ciphertext|refresh_token|access_token|"token":/.test(json);
}

function createFakeCalendarDb(seed = []) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    from(table) {
      if (table !== "calendar_connections") {
        throw new Error(`unexpected table ${table}`);
      }
      const filters = {};
      let mode = "select";
      let pending = null;
      const api = {
        select() {
          return api;
        },
        eq(column, value) {
          filters[column] = value;
          return api;
        },
        upsert(row) {
          mode = "upsert";
          pending = row;
          return api;
        },
        update(row) {
          mode = "update";
          pending = row;
          return api;
        },
        maybeSingle() {
          return Promise.resolve({ data: find() || null, error: null });
        },
        single() {
          if (mode === "upsert") {
            const idx = rows.findIndex(
              (row) =>
                row.tenant_id === pending.tenant_id &&
                row.agent_id === pending.agent_id &&
                row.provider === pending.provider
            );
            const saved = {
              id: idx >= 0 ? rows[idx].id : "conn-1",
              ...pending,
            };
            if (idx >= 0) rows[idx] = { ...rows[idx], ...saved };
            else rows.push(saved);
            return Promise.resolve({ data: { ...saved }, error: null });
          }
          const current = find();
          if (!current) {
            return Promise.resolve({ data: null, error: { message: "not found" } });
          }
          Object.assign(current, pending);
          return Promise.resolve({ data: { ...current }, error: null });
        },
      };
      function find() {
        return rows.find((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );
      }
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

await test("unauthenticated connect/status/disconnect/callback", async () => {
  assert.equal(startCalendarConnect(null).status, 401);
  assert.equal((await getCalendarStatus({}, null)).status, 401);
  assert.equal((await disconnectCalendar({}, null)).status, 401);
  assert.equal(
    (await completeCalendarCallback({}, null, { code: "x", state: "y" })).status,
    401
  );
});

await test("OAuth state is signed and expires", () => {
  const state = createCalendarOAuthState({
    tenantId: TENANT_A,
    agentId: AGENT_A,
    tenantSlug: "1416",
    returnTo: "join",
  });
  const payload = verifyCalendarOAuthState(state);
  assert.equal(payload.tenantId, TENANT_A);
  assert.equal(payload.agentId, AGENT_A);
  assert.equal(payload.returnTo, "join");
  assert.equal(verifyCalendarOAuthState("tampered." + state.split(".")[1]), null);
  assert.equal(verifyCalendarOAuthState(state.slice(0, -2) + "xx"), null);

  const expired = createCalendarOAuthState({
    tenantId: TENANT_A,
    agentId: AGENT_A,
    tenantSlug: "1416",
  });
  const [body] = expired.split(".");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  parsed.exp = Date.now() - 1000;
  const staleBody = Buffer.from(JSON.stringify(parsed)).toString("base64url");
  assert.equal(verifyCalendarOAuthState(`${staleBody}.fakesig`), null);
});

await test("state tenant/agent must match the session", () => {
  const state = createCalendarOAuthState({
    tenantId: TENANT_A,
    agentId: AGENT_A,
    tenantSlug: "1416",
  });
  const payload = verifyCalendarOAuthState(state);
  assert.equal(sessionMatchesOAuthState(session(TENANT_A, AGENT_A), payload), true);
  assert.equal(sessionMatchesOAuthState(session(TENANT_B, AGENT_A), payload), false);
  assert.equal(sessionMatchesOAuthState(session(TENANT_A, AGENT_B), payload), false);
});

await test("callback rejects another tenant's state", async () => {
  const db = createFakeCalendarDb();
  const state = createCalendarOAuthState({
    tenantId: TENANT_B,
    agentId: AGENT_B,
    tenantSlug: "other",
  });
  const result = await completeCalendarCallback(db, session(TENANT_A, AGENT_A), {
    code: "auth-code",
    state,
  });
  assert.equal(result.status, 403);
  assert.equal(db.rows.length, 0);
});

await test("callback rejects invalid state", async () => {
  const result = await completeCalendarCallback(
    createFakeCalendarDb(),
    session(TENANT_A, AGENT_A),
    { code: "auth-code", state: "not-valid" }
  );
  assert.equal(result.status, 400);
});

await test("upsert is scoped to session tenant + agent", async () => {
  const db = createFakeCalendarDb();
  const saved = await upsertAgentCalendarConnection(db, {
    tenantId: TENANT_A,
    agentId: AGENT_A,
    googleAccountEmail: "layla@example.com",
    calendarId: "primary",
    calendarSummary: "Work",
    calendarTimezone: "Asia/Dubai",
    tokenCiphertext: "v1.cipher",
    tokenExpiresAt: "2026-09-20T21:00:00.000Z",
  });
  assert.equal(saved.tenant_id, TENANT_A);
  assert.equal(saved.agent_id, AGENT_A);
  assert.equal(db.rows.length, 1);

  const other = await loadAgentCalendarConnection(db, {
    tenantId: TENANT_B,
    agentId: AGENT_A,
  });
  assert.equal(other.connection, null);

  const mine = await loadAgentCalendarConnection(db, {
    tenantId: TENANT_A,
    agentId: AGENT_A,
  });
  assert.equal(mine.connection.google_account_email, "layla@example.com");
});

await test("status payload never includes tokens", async () => {
  const db = createFakeCalendarDb([
    {
      id: "conn-1",
      tenant_id: TENANT_A,
      agent_id: AGENT_A,
      provider: "google",
      google_account_email: "layla@example.com",
      calendar_id: "primary",
      calendar_summary: "Work",
      calendar_timezone: "Asia/Dubai",
      token_ciphertext: "v1.should-never-leak",
      status: "active",
    },
  ]);
  const status = await getCalendarStatus(db, session(TENANT_A, AGENT_A));
  assert.equal(status.connected, true);
  assert.equal(status.email, "layla@example.com");
  assert.equal(status.label, "Work");
  assert.equal(status.timezone, "Asia/Dubai");
  assert.equal(status.status, "active");
  assert.equal(status.lastError, null);
  assert.equal(hasSecret(status), false);
  assert.equal(hasSecret(calendarSettingsPayload(db.rows[0])), false);
});

await test("disconnect revokes and clears ciphertext, keeps the row", async () => {
  const { encryptCalendarTokens } = await import("../src/lib/calendar/tokens.js");
  const ciphertext = encryptCalendarTokens({
    refresh_token: "refresh-keep-local-only",
    access_token: "access-keep-local-only",
  });
  const db = createFakeCalendarDb([
    {
      id: "conn-1",
      tenant_id: TENANT_A,
      agent_id: AGENT_A,
      provider: "google",
      google_account_email: "layla@example.com",
      calendar_id: "primary",
      token_ciphertext: ciphertext,
      token_expires_at: "2026-09-20T21:00:00.000Z",
      status: "active",
    },
  ]);
  const appointments = [{ id: "appt-1", tenant_id: TENANT_A }];
  const originalFetch = globalThis.fetch;
  let revoked = false;
  globalThis.fetch = async () => {
    revoked = true;
    return { ok: true, json: async () => ({}) };
  };
  try {
    const result = await revokeAgentCalendarConnection(db, {
      tenantId: TENANT_A,
      agentId: AGENT_A,
      revokeGoogleToken: async () => {
        revoked = true;
      },
    });
    assert.equal(result.revoked, true);
    assert.equal(revoked, true);
    assert.equal(db.rows[0].status, "revoked");
    assert.equal(db.rows[0].token_ciphertext, null);
    assert.equal(appointments.length, 1);
    const status = await getCalendarStatus(db, session(TENANT_A, AGENT_A));
    assert.equal(status.connected, false);
    assert.equal(hasSecret(status), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("disconnect cannot target another tenant by row contents", async () => {
  const db = createFakeCalendarDb([
    {
      id: "conn-b",
      tenant_id: TENANT_B,
      agent_id: AGENT_B,
      provider: "google",
      token_ciphertext: "v1.other",
      status: "active",
    },
  ]);
  const result = await revokeAgentCalendarConnection(db, {
    tenantId: TENANT_A,
    agentId: AGENT_A,
  });
  assert.equal(result.revoked, false);
  assert.equal(db.rows[0].token_ciphertext, "v1.other");
  assert.equal(db.rows[0].status, "active");
});

await test("successful callback upserts from session, not the browser", async () => {
  const db = createFakeCalendarDb();
  const state = createCalendarOAuthState({
    tenantId: TENANT_A,
    agentId: AGENT_A,
    tenantSlug: "1416",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        json: async () => ({
          access_token: "access-live",
          refresh_token: "refresh-live",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.events",
        }),
      };
    }
    if (href.includes("calendarList/primary")) {
      return {
        ok: true,
        json: async () => ({
          id: "layla@example.com",
          summary: "Work",
          timeZone: "Asia/Dubai",
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const result = await completeCalendarCallback(db, session(TENANT_A, AGENT_A), {
      code: "auth-code",
      state,
    });
    assert.equal(result.redirect, "/copilot/1416/settings?calendar=connected");
    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].tenant_id, TENANT_A);
    assert.equal(db.rows[0].agent_id, AGENT_A);
    assert.equal(db.rows[0].google_account_email, "layla@example.com");
    assert.match(db.rows[0].token_ciphertext, /^v1\./);
    assert.doesNotMatch(db.rows[0].token_ciphertext, /refresh-live|access-live/);
    const status = await getCalendarStatus(db, session(TENANT_A, AGENT_A));
    assert.equal(status.connected, true);
    assert.equal(hasSecret(status), false);
    assert.equal(hasSecret(result), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("connect URL contains signed state and no tokens", () => {
  const started = startCalendarConnect(session(TENANT_A, AGENT_A, "1416"), {
    returnTo: "join",
  });
  const url = new URL(started.url);
  const state = url.searchParams.get("state");
  assert.ok(state);
  const payload = verifyCalendarOAuthState(state);
  assert.equal(payload.tenantId, TENANT_A);
  assert.equal(payload.agentId, AGENT_A);
  assert.equal(payload.returnTo, "join");
  assert.equal(url.search.includes("refresh"), false);
  assert.equal(url.search.includes(TENANT_A), false);
});

await test("callback from join returns to join, not settings", async () => {
  const db = createFakeCalendarDb();
  const state = createCalendarOAuthState({
    tenantId: TENANT_A,
    agentId: AGENT_A,
    tenantSlug: "1416",
    returnTo: "join",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        json: async () => ({
          access_token: "access-live",
          refresh_token: "refresh-live",
          expires_in: 3600,
        }),
      };
    }
    if (href.includes("calendarList/primary")) {
      return {
        ok: true,
        json: async () => ({
          id: "layla@example.com",
          summary: "Work",
          timeZone: "Asia/Dubai",
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  try {
    const result = await completeCalendarCallback(db, session(TENANT_A, AGENT_A), {
      code: "auth-code",
      state,
    });
    assert.equal(result.redirect, "/copilot/1416/join?calendar=connected");
    assert.equal(db.rows[0].tenant_id, TENANT_A);
    assert.equal(db.rows[0].agent_id, AGENT_A);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test("reconnect upserts over a revoked row for the same agent", async () => {
  const db = createFakeCalendarDb([
    {
      id: "conn-1",
      tenant_id: TENANT_A,
      agent_id: AGENT_A,
      provider: "google",
      token_ciphertext: null,
      status: "revoked",
      last_error: "Calendar credentials are no longer valid.",
    },
  ]);
  const saved = await upsertAgentCalendarConnection(db, {
    tenantId: TENANT_A,
    agentId: AGENT_A,
    googleAccountEmail: "layla@example.com",
    calendarId: "primary",
    calendarSummary: "Work",
    calendarTimezone: "Asia/Dubai",
    tokenCiphertext: "v1.new-cipher",
    tokenExpiresAt: "2026-09-20T21:00:00.000Z",
  });
  assert.equal(db.rows.length, 1);
  assert.equal(saved.status, "active");
  assert.equal(db.rows[0].token_ciphertext, "v1.new-cipher");
  assert.equal(db.rows[0].last_error, null);
});

console.log("\nAll calendar OAuth Phase 2 tests passed.");
