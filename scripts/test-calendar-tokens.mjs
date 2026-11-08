import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  buildCalendarCallMetadata,
  buildCalendarSpeechVariables,
  calendarStatusForApi,
} from "../src/lib/calendar/context.js";
import {
  buildGoogleAuthorizeUrl,
  GOOGLE_CALENDAR_SCOPES,
} from "../src/lib/calendar/google.js";
import {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  parseAppointmentInput,
  parseAvailabilityWindow,
  parseCalendarCallMetadata,
  parseCalendarSpeechVariables,
} from "../src/lib/calendar/schema.js";
import {
  decryptCalendarTokens,
  encryptCalendarTokens,
  publicCalendarConnection,
} from "../src/lib/calendar/tokens.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";

function setKey(hex = randomBytes(32).toString("hex")) {
  process.env.CALENDAR_TOKEN_KEY = hex;
  return hex;
}

function hasSecretKey(value) {
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some((key) =>
    /token|ciphertext|refresh|access_token/i.test(key)
  );
}

function test(name, fn) {
  fn();
  console.log(`ok  ${name}`);
}

setKey();

test("encrypt/decrypt roundtrip", () => {
  const payload = {
    refresh_token: "refresh-abc",
    access_token: "access-xyz",
    expires_at: "2026-09-20T20:00:00.000Z",
    scope: "https://www.googleapis.com/auth/calendar.events",
  };
  const cipher = encryptCalendarTokens(payload);
  assert.match(cipher, /^v1\./);
  assert.doesNotMatch(cipher, /refresh-abc|access-xyz/);
  const plain = decryptCalendarTokens(cipher);
  assert.equal(plain.refresh_token, payload.refresh_token);
  assert.equal(plain.access_token, payload.access_token);
  assert.equal(plain.expires_at, payload.expires_at);
});

test("each encrypt uses a new IV", () => {
  const payload = { refresh_token: "refresh-abc" };
  const a = encryptCalendarTokens(payload);
  const b = encryptCalendarTokens(payload);
  assert.notEqual(a, b);
  assert.equal(decryptCalendarTokens(a).refresh_token, "refresh-abc");
  assert.equal(decryptCalendarTokens(b).refresh_token, "refresh-abc");
});

test("tampered ciphertext fails", () => {
  const cipher = encryptCalendarTokens({ refresh_token: "refresh-abc" });
  const bits = cipher.split(".");
  bits[3] = Buffer.from("nope").toString("base64url");
  assert.throws(() => decryptCalendarTokens(bits.join(".")));
});

test("wrong key fails", () => {
  const cipher = encryptCalendarTokens({ refresh_token: "refresh-abc" });
  setKey();
  assert.throws(() => decryptCalendarTokens(cipher));
});

test("missing or short CALENDAR_TOKEN_KEY fails", () => {
  const prev = process.env.CALENDAR_TOKEN_KEY;
  process.env.CALENDAR_TOKEN_KEY = "";
  assert.throws(() => encryptCalendarTokens({ refresh_token: "x" }));
  process.env.CALENDAR_TOKEN_KEY = "abcd";
  assert.throws(() => encryptCalendarTokens({ refresh_token: "x" }));
  process.env.CALENDAR_TOKEN_KEY = prev;
});

test("public connection never exposes tokens", () => {
  const pub = publicCalendarConnection({
    id: CONNECTION_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    provider: "google",
    google_account_email: "agent@example.com",
    calendar_id: "primary",
    calendar_summary: "Work",
    calendar_timezone: "Asia/Dubai",
    token_ciphertext: "v1.secret",
    status: "active",
    connected_at: "2026-09-20T10:00:00.000Z",
  });
  assert.equal(pub.email, "agent@example.com");
  assert.equal(pub.tenantId, TENANT_ID);
  assert.equal(pub.agentId, AGENT_ID);
  assert.equal(hasSecretKey(pub), false);
  assert.equal("token_ciphertext" in pub, false);
});

test("speech variables when connected", () => {
  const result = buildCalendarSpeechVariables({
    id: CONNECTION_ID,
    status: "active",
    token_ciphertext: "v1.secret",
    calendar_summary: "Layla calendar",
    calendar_timezone: "Asia/Dubai",
    google_account_email: "layla@example.com",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    calendarConnected: "true",
    calendarLabel: "Layla calendar",
    calendarTimezone: "Asia/Dubai",
    appointmentDurationMinutes: String(DEFAULT_APPOINTMENT_DURATION_MINUTES),
  });
  assert.equal(hasSecretKey(result.data), false);
});

test("speech variables when no calendar — still callable", () => {
  const result = buildCalendarSpeechVariables(null, { agentTimezone: "Asia/Dubai" });
  assert.equal(result.ok, true);
  assert.equal(result.data.calendarConnected, "false");
  assert.equal(result.data.calendarLabel, "");
  assert.equal(result.data.calendarTimezone, "Asia/Dubai");
});

test("call metadata routes by tenant/agent/connection — not calendarId", () => {
  const result = buildCalendarCallMetadata({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    connection: {
      id: CONNECTION_ID,
      status: "active",
      token_ciphertext: "v1.secret",
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    calendarConnectionId: CONNECTION_ID,
  });
  assert.equal("calendarId" in result.data, false);
  assert.equal(hasSecretKey(result.data), false);
});

test("disconnected agent gets null calendarConnectionId", () => {
  const result = buildCalendarCallMetadata({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    connection: { status: "revoked" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.calendarConnectionId, null);
});

test("metadata schema rejects tokens and model-chosen calendarId", () => {
  const leaked = parseCalendarCallMetadata({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    calendarConnectionId: CONNECTION_ID,
    refresh_token: "nope",
  });
  assert.equal(leaked.ok, false);

  const chosen = parseCalendarCallMetadata({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    calendarConnectionId: CONNECTION_ID,
    calendarId: "other-tenant@example.com",
  });
  assert.equal(chosen.ok, false);
});

test("speech schema rejects tokens", () => {
  const leaked = parseCalendarSpeechVariables({
    calendarConnected: "true",
    calendarLabel: "Work",
    calendarTimezone: "Asia/Dubai",
    appointmentDurationMinutes: "30",
    access_token: "nope",
  });
  assert.equal(leaked.ok, false);
});

test("appointment window validation", () => {
  const ok = parseAppointmentInput({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    calendarConnectionId: CONNECTION_ID,
    summary: "Viewing",
    startAt: "2026-09-21T10:00:00+04:00",
    endAt: "2026-09-21T10:30:00+04:00",
    timezone: "Asia/Dubai",
  });
  assert.equal(ok.ok, true);

  const inverted = parseAppointmentInput({
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    summary: "Viewing",
    startAt: "2026-09-21T11:00:00+04:00",
    endAt: "2026-09-21T10:00:00+04:00",
    timezone: "Asia/Dubai",
  });
  assert.equal(inverted.ok, false);
  assert.match(inverted.fieldErrors.endAt || "", /after startAt/);
});

test("availability window validation", () => {
  const ok = parseAvailabilityWindow({
    startDateTime: "2026-09-21T10:00:00+04:00",
    endDateTime: "2026-09-21T18:00:00+04:00",
    timeZone: "Asia/Dubai",
  });
  assert.equal(ok.ok, true);
  const bad = parseAvailabilityWindow({
    startDateTime: "not-a-date",
    endDateTime: "2026-09-21T18:00:00+04:00",
  });
  assert.equal(bad.ok, false);
});

test("authorize URL is offline + consent and contains no tokens", () => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client.apps.googleusercontent.com";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "secret";
  process.env.GOOGLE_CALENDAR_REDIRECT_URI =
    "https://example.com/api/console/calendar/callback";
  const url = new URL(buildGoogleAuthorizeUrl({ state: "signed-state" }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "signed-state");
  assert.ok(
    GOOGLE_CALENDAR_SCOPES.every((scope) =>
      url.searchParams.get("scope").includes(scope)
    )
  );
  assert.equal(url.search.includes("secret"), false);
  assert.equal(url.search.includes("refresh"), false);
});

test("API status helper redacts ciphertext", () => {
  const status = calendarStatusForApi({
    id: CONNECTION_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    status: "active",
    token_ciphertext: "v1.secret",
    google_account_email: "agent@example.com",
  });
  assert.equal(status.connected, true);
  assert.equal(status.connection.email, "agent@example.com");
  assert.equal(hasSecretKey(status.connection), false);
});

test("random uuid still accepted by metadata parser", () => {
  const result = parseCalendarCallMetadata({
    tenantId: randomUUID(),
    agentId: randomUUID(),
    calendarConnectionId: null,
  });
  assert.equal(result.ok, true);
});

console.log("\nAll calendar Phase 1 tests passed.");
