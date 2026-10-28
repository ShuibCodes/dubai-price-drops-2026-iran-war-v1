import { GOOGLE_CALENDAR_SCOPES } from "./google.js";
import {
  decryptCalendarTokens,
  encryptCalendarTokens,
  publicCalendarConnection,
} from "./tokens.js";

// Centralised token-pattern regex — same set used in tools.js assertNoSecrets.
const TOKEN_LEAK_PATTERN = /access_token|refresh_token|token_ciphertext|"token":|ya29\.|1\/\//gi;


export const CALENDAR_PUBLIC_COLS =
  "id, tenant_id, agent_id, provider, google_account_email, calendar_id, calendar_summary, calendar_timezone, status, last_error, connected_at, updated_at";

const CALENDAR_INTERNAL_COLS = `${CALENDAR_PUBLIC_COLS}, token_ciphertext, token_expires_at, scopes`;

function tableMissing(error) {
  return /calendar_connections|schema cache|does not exist/i.test(
    String(error?.message || "")
  );
}

export function isCalendarConnected(row) {
  return Boolean(row?.id) && row.status === "active" && Boolean(row.token_ciphertext);
}

export function calendarSettingsPayload(row) {
  const pub = publicCalendarConnection(row);
  return {
    connected: row ? row.status === "active" : false,
    email: pub?.email || null,
    label: pub?.calendarSummary || pub?.email || null,
    timezone: pub?.calendarTimezone || null,
    status: pub?.status || null,
    lastError: row?.last_error || null,
  };
}

function assertScope(tenantId, agentId) {
  const tenant = String(tenantId || "").trim();
  const agent = String(agentId || "").trim();
  if (!tenant || !agent) {
    throw new Error("tenantId and agentId are required");
  }
  return { tenantId: tenant, agentId: agent };
}

export async function loadAgentCalendarConnection(
  supabase,
  { tenantId, agentId, includeSecrets = false }
) {
  const scope = assertScope(tenantId, agentId);
  const { data, error } = await supabase
    .from("calendar_connections")
    .select(includeSecrets ? CALENDAR_INTERNAL_COLS : CALENDAR_PUBLIC_COLS)
    .eq("tenant_id", scope.tenantId)
    .eq("agent_id", scope.agentId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return { connection: null, unavailable: true };
    throw new Error(`Calendar lookup failed: ${error.message}`);
  }
  return { connection: data || null, unavailable: false };
}

/**
 * Load one connection by id, but only if it belongs to this tenant AND agent.
 * Never query by calendar_connection_id alone.
 */
export async function loadOwnedCalendarConnection(
  supabase,
  { tenantId, agentId, calendarConnectionId }
) {
  const scope = assertScope(tenantId, agentId);
  const connectionId = String(calendarConnectionId || "").trim();
  if (!connectionId) {
    return { connection: null, reason: "missing_connection_id" };
  }
  const { data, error } = await supabase
    .from("calendar_connections")
    .select(CALENDAR_INTERNAL_COLS)
    .eq("id", connectionId)
    .eq("tenant_id", scope.tenantId)
    .eq("agent_id", scope.agentId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return { connection: null, reason: "unavailable" };
    throw new Error(`Calendar lookup failed: ${error.message}`);
  }
  if (!data) return { connection: null, reason: "not_found" };
  if (data.status !== "active" || !data.token_ciphertext) {
    return { connection: null, reason: data.status === "revoked" ? "revoked" : "inactive" };
  }
  return { connection: data, reason: null };
}

export async function persistCalendarTokens(supabase, connection, tokens) {
  if (!supabase || !connection?.id || !tokens?.refresh_token) return null;
  const ciphertext = encryptCalendarTokens({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token || null,
    expires_at: tokens.expires_at || null,
    token_type: tokens.token_type,
    scope: tokens.scope,
  });
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_connections")
    .update({
      token_ciphertext: ciphertext,
      token_expires_at: tokens.expires_at || null,
      last_error: null,
      status: "active",
      updated_at: now,
    })
    .eq("id", connection.id)
    .eq("tenant_id", connection.tenant_id)
    .eq("agent_id", connection.agent_id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[calendar/store] token persist failed:", error.message);
    return null;
  }
  return data;
}

export async function markCalendarConnectionError(supabase, connection, message) {
  if (!supabase || !connection?.id) return null;
  const safe = String(message || "Calendar credentials are no longer valid")
    .replace(TOKEN_LEAK_PATTERN, "[redacted]")
    .slice(0, 240);
  const now = new Date().toISOString();
  try {
    const { data, error } = await supabase
      .from("calendar_connections")
      .update({
        status: "error",
        last_error: safe,
        updated_at: now,
      })
      .eq("id", connection.id)
      .eq("tenant_id", connection.tenant_id)
      .eq("agent_id", connection.agent_id)
      .select("id, status, last_error")
      .maybeSingle();
    if (error) {
      console.error("[calendar/store] mark error failed:", error.message);
      return null;
    }
    return data;
  } catch (error) {
    console.error("[calendar/store] mark error failed:", error.message);
    return null;
  }
}

export async function insertAppointment(supabase, row) {
  const { data, error } = await supabase
    .from("appointments")
    .insert(row)
    .select(
      "id, tenant_id, agent_id, calendar_connection_id, lead_id, jarvis_lead_id, call_id, vapi_call_id, summary, start_at, end_at, timezone, provider_event_id, status"
    )
    .single();
  if (error) throw new Error(`Appointment save failed: ${error.message}`);
  return data;
}

/**
 * B1: Persist a record of an orphan Google Calendar event so the team can
 * manually clean it up. Swallows all errors — compensation logging must
 * never throw and must never block the tool response.
 */
export async function logCompensationFailure(supabase, {
  tenantId,
  agentId,
  calendarConnectionId,
  providerEventId,
  calendarId,
  reason,
}) {
  if (!supabase) return;
  try {
    await supabase.from("calendar_compensation_failures").insert({
      tenant_id: tenantId || null,
      agent_id: agentId || null,
      calendar_connection_id: calendarConnectionId || null,
      provider_event_id: providerEventId || null,
      calendar_id: calendarId || "primary",
      reason: String(reason || "unknown").slice(0, 240),
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Log to console only — do not re-throw. The Vapi response has already
    // been decided before this function is called.
    console.error("[calendar/store] compensation failure log failed:", err?.message);
  }
}


export async function upsertAgentCalendarConnection(
  supabase,
  {
    tenantId,
    agentId,
    googleAccountEmail,
    calendarId,
    calendarSummary,
    calendarTimezone,
    tokenCiphertext,
    tokenExpiresAt,
    scopes,
  }
) {
  const scope = assertScope(tenantId, agentId);
  if (!tokenCiphertext) throw new Error("Encrypted calendar tokens are required");
  const now = new Date().toISOString();
  const row = {
    tenant_id: scope.tenantId,
    agent_id: scope.agentId,
    provider: "google",
    google_account_email: googleAccountEmail || null,
    calendar_id: calendarId || "primary",
    calendar_summary: calendarSummary || null,
    calendar_timezone: calendarTimezone || null,
    token_ciphertext: tokenCiphertext,
    token_expires_at: tokenExpiresAt || null,
    scopes: Array.isArray(scopes) && scopes.length ? scopes : GOOGLE_CALENDAR_SCOPES,
    status: "active",
    last_error: null,
    connected_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("calendar_connections")
    .upsert(row, { onConflict: "tenant_id,agent_id,provider" })
    .select(CALENDAR_PUBLIC_COLS)
    .single();
  if (error) throw new Error(`Calendar save failed: ${error.message}`);
  return data;
}

export async function revokeAgentCalendarConnection(
  supabase,
  { tenantId, agentId, revokeGoogleToken }
) {
  const scope = assertScope(tenantId, agentId);
  const { connection, unavailable } = await loadAgentCalendarConnection(supabase, {
    ...scope,
    includeSecrets: true,
  });
  if (unavailable) {
    throw new Error("Calendar connections table is not available");
  }
  if (!connection) {
    return { revoked: false, reason: "not_connected" };
  }

  if (connection.token_ciphertext && typeof revokeGoogleToken === "function") {
    try {
      const tokens = decryptCalendarTokens(connection.token_ciphertext);
      await revokeGoogleToken(tokens.refresh_token || tokens.access_token);
    } catch {
      // Still clear local tokens so AgentZero cannot keep using them.
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("calendar_connections")
    .update({
      token_ciphertext: null,
      token_expires_at: null,
      status: "revoked",
      last_error: null,
      updated_at: now,
    })
    .eq("id", connection.id)
    .eq("tenant_id", scope.tenantId)
    .eq("agent_id", scope.agentId)
    .select(CALENDAR_PUBLIC_COLS)
    .single();
  if (error) throw new Error(`Calendar disconnect failed: ${error.message}`);
  return { revoked: true, connection: data };
}
