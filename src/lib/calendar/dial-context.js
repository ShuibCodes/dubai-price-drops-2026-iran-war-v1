import {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  DEFAULT_CALENDAR_TIMEZONE,
  parseCalendarCallMetadata,
} from "./schema.js";
import {
  buildCalendarCallMetadata,
  buildCalendarSpeechVariables,
} from "./context.js";
import { loadAgentCalendarConnection } from "./store.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROUTING_KEYS = ["tenantId", "agentId", "calendarConnectionId"];
const SECRET_KEY = /access_token|refresh_token|token_ciphertext|^token$/i;

/**
 * Accept only a UUID. Display names, empty strings, and env fallbacks are not
 * an agent identity.
 */
export function trustedAgentId(value) {
  const id = String(value || "").trim();
  return UUID_RE.test(id) ? id : null;
}

export function trustedTenantId(value) {
  const id = String(value || "").trim();
  return UUID_RE.test(id) ? id : null;
}

function closedSpeech(agentTimezone) {
  const parsed = buildCalendarSpeechVariables(null, { agentTimezone });
  if (parsed.ok) return parsed.data;
  return {
    calendarConnected: "false",
    calendarLabel: "",
    calendarTimezone: agentTimezone || DEFAULT_CALENDAR_TIMEZONE,
    appointmentDurationMinutes: String(DEFAULT_APPOINTMENT_DURATION_MINUTES),
  };
}

function stripSecrets(object) {
  if (!object || typeof object !== "object") return {};
  const next = { ...object };
  for (const key of Object.keys(next)) {
    if (SECRET_KEY.test(key)) delete next[key];
  }
  return next;
}

/**
 * Trusted calendar fields overwrite anything the caller stuffed in.
 * If this flow has no agent, agentId and calendarConnectionId are removed.
 */
export function applyTrustedCalendarMetadata(baseMetadata, calendar) {
  const metadata = stripSecrets(baseMetadata);
  delete metadata.calendarConnectionId;
  if (!calendar?.metadata?.agentId) delete metadata.agentId;

  if (calendar?.metadata?.tenantId) metadata.tenantId = calendar.metadata.tenantId;
  if (calendar?.metadata?.agentId) metadata.agentId = calendar.metadata.agentId;
  if (
    calendar?.metadata &&
    Object.prototype.hasOwnProperty.call(calendar.metadata, "calendarConnectionId")
  ) {
    metadata.calendarConnectionId = calendar.metadata.calendarConnectionId;
  }

  for (const key of ROUTING_KEYS) {
    if (metadata[key] === undefined) delete metadata[key];
  }
  return metadata;
}

export function applyCalendarVariableValues(baseValues, calendar) {
  return {
    ...stripSecrets(baseValues),
    ...(calendar?.variableValues || closedSpeech()),
  };
}

/**
 * Resolve the agent that owns a queued dial. Batch owner first, then
 * requested_by only when it is an agent UUID on the same tenant.
 * Never picks "some other agent" on the tenant.
 */
export async function resolveQueueAgentId(
  supabase,
  { tenantId, batchId, requestedBy } = {}
) {
  const tenant = trustedTenantId(tenantId);
  if (!tenant || !supabase) return null;

  const batch = String(batchId || "").trim();
  if (batch) {
    try {
      const { data, error } = await supabase
        .from("call_batches")
        .select("agent_id")
        .eq("id", batch)
        .eq("tenant_id", tenant)
        .maybeSingle();
      if (!error) {
        const fromBatch = trustedAgentId(data?.agent_id);
        if (fromBatch) return fromBatch;
      }
    } catch {
      // Fall through to requested_by.
    }
  }

  const requested = trustedAgentId(requestedBy);
  if (!requested) return null;

  try {
    const { data, error } = await supabase
      .from("agents")
      .select("id")
      .eq("id", requested)
      .eq("tenant_id", tenant)
      .maybeSingle();
    if (error) return null;
    return trustedAgentId(data?.id);
  } catch {
    return null;
  }
}

async function loadAgentTimezone(supabase, tenantId, agentId) {
  if (!supabase || !tenantId || !agentId) return null;
  try {
    const { data, error } = await supabase
      .from("agents")
      .select("tz")
      .eq("id", agentId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return null;
    return String(data?.tz || "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Speech + routing for one live call. Fail closed (still dialable) when the
 * agent cannot be proven or no calendar is connected.
 */
export async function loadCalendarDialContext(
  supabase,
  { tenantId, agentId, agentTimezone } = {}
) {
  const tenant = trustedTenantId(tenantId);
  const agent = trustedAgentId(agentId);
  const timezone =
    agentTimezone ||
    (await loadAgentTimezone(supabase, tenant, agent)) ||
    DEFAULT_CALENDAR_TIMEZONE;

  if (!tenant || !agent) {
    return {
      connected: false,
      reason: !tenant ? "missing_tenant" : "missing_agent",
      variableValues: closedSpeech(timezone),
      metadata: tenant ? { tenantId: tenant } : {},
    };
  }

  let connection = null;
  if (supabase) {
    try {
      const loaded = await loadAgentCalendarConnection(supabase, {
        tenantId: tenant,
        agentId: agent,
        includeSecrets: true,
      });
      connection = loaded.connection || null;
    } catch {
      connection = null;
    }
  }

  const speech = buildCalendarSpeechVariables(connection, { agentTimezone: timezone });
  const parsedMeta = buildCalendarCallMetadata({
    tenantId: tenant,
    agentId: agent,
    connection,
  });
  const metadata = parsedMeta.ok
    ? parsedMeta.data
    : parseCalendarCallMetadata({
        tenantId: tenant,
        agentId: agent,
        calendarConnectionId: null,
      }).data;

  return {
    connected: Boolean(metadata?.calendarConnectionId),
    reason: metadata?.calendarConnectionId ? null : "no_calendar",
    variableValues: speech.ok ? speech.data : closedSpeech(timezone),
    metadata: metadata || { tenantId: tenant, agentId: agent, calendarConnectionId: null },
  };
}
