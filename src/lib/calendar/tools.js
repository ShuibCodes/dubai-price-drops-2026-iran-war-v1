import {
  calendarToolArgsContainForbiddenKeys,
  parseCalendarToolBookingArgs,
  parseTrustedCalendarToolContext,
} from "./schema.js";
import {
  insertAppointment,
  loadOwnedCalendarConnection,
  markCalendarConnectionError,
  persistCalendarTokens,
} from "./store.js";
import {
  checkGoogleFreeBusy,
  createGoogleCalendarEvent,
  refreshGoogleAccessToken,
} from "./google.js";
import { decryptCalendarTokens } from "./tokens.js";
import {
  expandBusyWithBuffer,
  resolveBookingWindow,
  slotOverlapsBusy,
  viewingWindowAllows,
} from "./window.js";
import {
  extractVapiToolCallContext,
  extractVapiToolCalls,
  vapiToolError,
  vapiToolSuccess,
} from "../vapi/tool-calls.js";

export const CALENDAR_TOOL_NAMES = new Set([
  "check_availability",
  "book_appointment",
]);

/**
 * LLM-facing schemas only. Routing ids and tokens are intentionally absent.
 * Attach these in a later phase — not via live dial assistantOverrides.model.
 */
export const VAPI_CALENDAR_TOOL_DEFINITIONS = [
  {
    type: "function",
    async: false,
    function: {
      name: "check_availability",
      description:
        "Check whether a viewing slot is free on the agent's connected calendar. Pass only the requested time window. Viewings are Sunday to Thursday, 10:00 to 18:00 in the calendar timezone. Do not pass tenant, agent, calendar, or token identifiers.",
      parameters: {
        type: "object",
        properties: {
          startDateTime: {
            type: "string",
            description: "ISO-8601 start timestamp with offset, e.g. 2026-09-21T10:00:00+04:00",
          },
          endDateTime: {
            type: "string",
            description: "ISO-8601 end timestamp with offset. Omit to use durationMinutes.",
          },
          timeZone: {
            type: "string",
            description: "IANA timezone, e.g. Asia/Dubai",
          },
          durationMinutes: {
            type: "number",
            description: "Appointment length in minutes when endDateTime is omitted",
          },
        },
        required: ["startDateTime"],
      },
    },
  },
  {
    type: "function",
    async: false,
    function: {
      name: "book_appointment",
      description:
        "Book a viewing on the agent's connected calendar after checking it is still free. Pass only booking times and an optional summary. Viewings are Sunday to Thursday, 10:00 to 18:00 in the calendar timezone. Do not pass tenant, agent, calendar, or token identifiers.",
      parameters: {
        type: "object",
        properties: {
          startDateTime: {
            type: "string",
            description: "ISO-8601 start timestamp with offset",
          },
          endDateTime: {
            type: "string",
            description: "ISO-8601 end timestamp with offset. Omit to use durationMinutes.",
          },
          timeZone: {
            type: "string",
            description: "IANA timezone, e.g. Asia/Dubai",
          },
          durationMinutes: {
            type: "number",
            description: "Appointment length in minutes when endDateTime is omitted",
          },
          summary: {
            type: "string",
            description: "Short calendar title, e.g. Viewing at Marina Gate",
          },
        },
        required: ["startDateTime"],
      },
    },
  },
];

const TOKEN_LEAK = /access_token|refresh_token|token_ciphertext|"token":/i;

function defaultGoogle() {
  return {
    checkFreeBusy: checkGoogleFreeBusy,
    createEvent: createGoogleCalendarEvent,
    refreshAccessToken: refreshGoogleAccessToken,
  };
}

function formatBusy(busy = []) {
  return busy
    .slice(0, 8)
    .map((slot) => `${slot.start} to ${slot.end}`)
    .join("; ");
}

function isGoogleAuthFailure(error) {
  const blob = `${error?.message || ""} ${JSON.stringify(error?.body || {})}`;
  return error?.status === 401 || /invalid_grant/i.test(blob);
}

function credentialsInvalidError() {
  return Object.assign(
    new Error(
      "This calendar connection is no longer valid. Offer to arrange a callback instead of booking."
    ),
    { vapiError: true, authFailed: true }
  );
}

function assertNoSecrets(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (TOKEN_LEAK.test(text)) {
    throw new Error("Refusing to return calendar tokens to Vapi");
  }
  return value;
}

export function resolveTrustedCalendarContext(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return { ok: false, error: "Call metadata is missing. Calendar cannot be used." };
  }
  if (TOKEN_LEAK.test(JSON.stringify(metadata))) {
    return { ok: false, error: "Call metadata is invalid." };
  }

  const tenantId = String(metadata.tenantId || "").trim();
  const agentId = String(metadata.agentId || "").trim();
  const calendarConnectionId = String(metadata.calendarConnectionId || "").trim();

  if (!tenantId || !agentId) {
    return { ok: false, error: "Call metadata is missing tenant or agent. Calendar cannot be used." };
  }
  if (!calendarConnectionId) {
    return {
      ok: false,
      error: "No calendar is connected. Offer to arrange a callback instead of booking.",
    };
  }

  const parsed = parseTrustedCalendarToolContext({
    tenantId,
    agentId,
    calendarConnectionId,
    leadId: metadata.leadId || null,
    jarvisLeadId: metadata.jarvisLeadId || null,
  });
  if (!parsed.ok) {
    return { ok: false, error: "Call metadata is invalid. Calendar cannot be used." };
  }
  return { ok: true, data: parsed.data };
}

export function parseAllowedToolArguments(name, rawArgs) {
  if (!CALENDAR_TOOL_NAMES.has(name)) {
    return { ok: false, error: `Unknown calendar tool: ${name}` };
  }
  const forbidden = calendarToolArgsContainForbiddenKeys(rawArgs);
  if (forbidden.length) {
    return {
      ok: false,
      error: "Tool arguments cannot include tenant, agent, calendar, or token identifiers.",
    };
  }
  return parseCalendarToolBookingArgs(rawArgs || {});
}

async function resolveOwnedConnection(supabase, context) {
  if (!supabase) {
    return { connection: null, reason: "unavailable" };
  }
  try {
    return await loadOwnedCalendarConnection(supabase, {
      tenantId: context.tenantId,
      agentId: context.agentId,
      calendarConnectionId: context.calendarConnectionId,
    });
  } catch (error) {
    console.error("[calendar/tools] connection lookup failed:", error.message);
    return { connection: null, reason: "unavailable" };
  }
}

function connectionError(reason) {
  if (reason === "revoked" || reason === "inactive") {
    return "This calendar connection is no longer active. Offer to arrange a callback instead of booking.";
  }
  if (reason === "not_found" || reason === "missing_connection_id") {
    return "No matching calendar is connected for this agent. Offer to arrange a callback instead of booking.";
  }
  return "Calendar is unavailable right now.";
}

export async function accessTokenForConnection(
  connection,
  google = defaultGoogle(),
  { supabase, forceRefresh = false } = {}
) {
  let tokens;
  try {
    tokens = decryptCalendarTokens(connection.token_ciphertext);
  } catch {
    await markCalendarConnectionError(
      supabase,
      connection,
      "Calendar credentials could not be read."
    );
    throw credentialsInvalidError();
  }
  const expiresAt = tokens.expires_at ? Date.parse(tokens.expires_at) : 0;
  const freshEnough =
    !forceRefresh &&
    tokens.access_token &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60_000;
  if (freshEnough) return tokens.access_token;

  if (!tokens.refresh_token) {
    await markCalendarConnectionError(
      supabase,
      connection,
      "Calendar tokens are incomplete."
    );
    throw credentialsInvalidError();
  }

  let refreshed;
  try {
    refreshed = await google.refreshAccessToken(tokens.refresh_token);
  } catch (error) {
    if (isGoogleAuthFailure(error)) {
      await markCalendarConnectionError(
        supabase,
        connection,
        "Calendar credentials are no longer valid."
      );
      throw credentialsInvalidError();
    }
    throw error;
  }
  if (!refreshed?.access_token) {
    throw new Error("Google did not return an access token");
  }
  try {
    await persistCalendarTokens(supabase, connection, {
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      access_token: refreshed.access_token,
      expires_at: refreshed.expires_at || null,
      token_type: refreshed.token_type,
      scope: refreshed.scope || tokens.scope,
    });
  } catch (error) {
    console.error("[calendar/tools] token persist failed:", error.message);
  }
  return refreshed.access_token;
}

async function lookupScopedId(supabase, table, id, tenantId) {
  if (!supabase || !id || !tenantId) return null;
  try {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

async function lookupCallId(supabase, vapiCallId, tenantId) {
  if (!supabase || !vapiCallId || !tenantId) return null;
  try {
    const { data, error } = await supabase
      .from("calls")
      .select("id")
      .eq("vapi_call_id", vapiCallId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

async function queryAvailability({ connection, window, google, supabase }) {
  const calendarId = connection.calendar_id || "primary";
  const run = (accessToken) =>
    google.checkFreeBusy({
      accessToken,
      calendarId,
      startDateTime: window.startDateTime,
      endDateTime: window.endDateTime,
      timeZone: window.timeZone,
    });

  let accessToken = await accessTokenForConnection(connection, google, { supabase });
  let freeBusy;
  try {
    freeBusy = await run(accessToken);
  } catch (error) {
    if (error?.status !== 401) throw error;
    accessToken = await accessTokenForConnection(connection, google, {
      supabase,
      forceRefresh: true,
    });
    freeBusy = await run(accessToken);
  }
  const rawBusy = Array.isArray(freeBusy?.busy) ? freeBusy.busy : [];
  const buffered = expandBusyWithBuffer(rawBusy);
  return {
    available: !slotOverlapsBusy(window.startDateTime, window.endDateTime, buffered),
    busy: rawBusy,
    calendarId,
  };
}

function availabilitySpeech(window, available, busy) {
  if (available) {
    return `Available. The requested slot from ${window.startDateTime} to ${window.endDateTime} (${window.timeZone}) is free.`;
  }
  const busyText = formatBusy(busy);
  return busyText
    ? `Unavailable. That slot overlaps existing bookings: ${busyText}.`
    : `Unavailable. That slot from ${window.startDateTime} to ${window.endDateTime} (${window.timeZone}) is not free.`;
}

function viewingWindowSpeech(window) {
  return `Unavailable. Viewings are Sunday to Thursday, 10:00 to 18:00 ${window.timeZone}. Offer another time.`;
}

async function handleCheckAvailability({ connection, args, google, supabase }) {
  const window = resolveBookingWindow(args, connection);
  if (!viewingWindowAllows(window)) {
    return assertNoSecrets(viewingWindowSpeech(window));
  }
  const { available, busy } = await queryAvailability({
    connection,
    window,
    google,
    supabase,
  });
  return assertNoSecrets(availabilitySpeech(window, available, busy));
}

async function handleBookAppointment({
  supabase,
  connection,
  context,
  args,
  vapiCallId,
  google,
}) {
  const verified = await resolveOwnedConnection(supabase, context);
  if (!verified.connection) {
    throw Object.assign(new Error(connectionError(verified.reason)), {
      vapiError: true,
    });
  }

  const window = resolveBookingWindow(args, verified.connection);
  if (!viewingWindowAllows(window)) {
    return assertNoSecrets(`Could not book. ${viewingWindowSpeech(window)}`);
  }
  const { available, busy } = await queryAvailability({
    connection: verified.connection,
    window,
    google,
    supabase,
  });
  if (!available) {
    return assertNoSecrets(
      `Could not book. ${availabilitySpeech(window, false, busy)} Offer another time.`
    );
  }

  const summary = String(args.summary || "Viewing").trim() || "Viewing";
  const accessToken = await accessTokenForConnection(verified.connection, google, {
    supabase,
  });
  const event = await google.createEvent({
    accessToken,
    calendarId: verified.connection.calendar_id || "primary",
    summary,
    startDateTime: window.startDateTime,
    endDateTime: window.endDateTime,
    timeZone: window.timeZone,
  });

  if (!event?.eventId) {
    throw new Error("Google Calendar did not return an event id");
  }

  const [leadId, jarvisLeadId, callId] = await Promise.all([
    lookupScopedId(supabase, "leads", context.leadId, context.tenantId),
    lookupScopedId(supabase, "jarvis_leads", context.jarvisLeadId, context.tenantId),
    lookupCallId(supabase, vapiCallId, context.tenantId),
  ]);

  try {
    await insertAppointment(supabase, {
      tenant_id: context.tenantId,
      agent_id: context.agentId,
      calendar_connection_id: verified.connection.id,
      lead_id: leadId,
      jarvis_lead_id: jarvisLeadId,
      call_id: callId,
      vapi_call_id: vapiCallId || null,
      summary,
      start_at: window.startDateTime,
      end_at: window.endDateTime,
      timezone: window.timeZone,
      provider_event_id: event.eventId,
      status: "booked",
      raw: {
        htmlLink: event.htmlLink || null,
        googleStatus: event.status || null,
      },
    });
  } catch (error) {
    console.error("[calendar/tools] appointment persist failed:", error.message);
  }

  return assertNoSecrets(
    `Booked. ${summary} is confirmed from ${window.startDateTime} to ${window.endDateTime} (${window.timeZone}).`
  );
}

export async function executeCalendarTool({
  toolCall,
  context,
  supabase,
  google = defaultGoogle(),
}) {
  const toolCallId = toolCall?.id;
  const name = String(toolCall?.name || "").trim();

  if (!toolCallId) {
    return vapiToolError("unknown", "Tool call is missing an id.");
  }
  if (!CALENDAR_TOOL_NAMES.has(name)) {
    return vapiToolError(toolCallId, `Unknown tool: ${name || "missing"}.`);
  }

  const trusted = resolveTrustedCalendarContext(context?.metadata);
  if (!trusted.ok) {
    return vapiToolError(toolCallId, trusted.error);
  }

  const args = parseAllowedToolArguments(name, toolCall.arguments);
  if (!args.ok) {
    return vapiToolError(toolCallId, args.error || "Invalid booking arguments.");
  }

  const owned = await resolveOwnedConnection(supabase, trusted.data);
  if (!owned.connection) {
    return vapiToolError(toolCallId, connectionError(owned.reason));
  }

  try {
    const result =
      name === "book_appointment"
        ? await handleBookAppointment({
            supabase,
            connection: owned.connection,
            context: trusted.data,
            args: args.data,
            vapiCallId: context?.callId || null,
            google,
          })
        : await handleCheckAvailability({
            connection: owned.connection,
            args: args.data,
            google,
            supabase,
          });
    return vapiToolSuccess(toolCallId, result);
  } catch (error) {
    if (error?.vapiError) {
      return vapiToolError(toolCallId, error.message);
    }
    if (isGoogleAuthFailure(error)) {
      await markCalendarConnectionError(
        supabase,
        owned.connection,
        "Calendar credentials are no longer valid."
      );
      return vapiToolError(toolCallId, credentialsInvalidError().message);
    }
    console.error("[calendar/tools] tool failed:", error.message);
    return vapiToolError(toolCallId, "Calendar is unavailable right now.");
  }
}

/**
 * Handle an official Vapi `message.type === "tool-calls"` payload.
 * Always returns a results array so the webhook can respond HTTP 200.
 */
export async function handleVapiCalendarToolCalls(payload, { supabase, google } = {}) {
  const toolCalls = extractVapiToolCalls(payload);
  const context = extractVapiToolCallContext(payload);
  if (!toolCalls.length) {
    return [];
  }
  const results = [];
  for (const toolCall of toolCalls) {
    results.push(
      await executeCalendarTool({
        toolCall,
        context,
        supabase,
        google,
      })
    );
  }
  return results;
}
