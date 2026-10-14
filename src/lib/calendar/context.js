import {
  DEFAULT_APPOINTMENT_DURATION_MINUTES,
  DEFAULT_CALENDAR_TIMEZONE,
  parseCalendarCallMetadata,
  parseCalendarSpeechVariables,
} from "./schema.js";
import { publicCalendarConnection } from "./tokens.js";

function connected(row) {
  return Boolean(row?.id) && row.status === "active" && Boolean(row.token_ciphertext);
}

/**
 * Speech-only Vapi variableValues. Never includes tokens or connection ids.
 */
export function buildCalendarSpeechVariables(connection, { agentTimezone } = {}) {
  const timezone =
    (connected(connection) && connection.calendar_timezone) ||
    agentTimezone ||
    DEFAULT_CALENDAR_TIMEZONE;
  const duration = String(DEFAULT_APPOINTMENT_DURATION_MINUTES);

  if (!connected(connection)) {
    return parseCalendarSpeechVariables({
      calendarConnected: "false",
      calendarLabel: "",
      calendarTimezone: timezone,
      appointmentDurationMinutes: duration,
    });
  }

  const label =
    String(connection.calendar_summary || "").trim() ||
    String(connection.google_account_email || "").trim() ||
    "your calendar";

  return parseCalendarSpeechVariables({
    calendarConnected: "true",
    calendarLabel: label,
    calendarTimezone: timezone,
    appointmentDurationMinutes: duration,
  });
}

/**
 * Routing metadata for the Vapi call. AgentZero tools load Google from this,
 * never from model-supplied calendarId / tokens.
 */
export function buildCalendarCallMetadata({
  tenantId,
  agentId,
  connection = null,
}) {
  return parseCalendarCallMetadata({
    tenantId,
    agentId,
    calendarConnectionId: connected(connection) ? connection.id : null,
  });
}

export function calendarStatusForApi(connection) {
  const pub = publicCalendarConnection(connection);
  return {
    connected: connected(connection),
    connection: pub,
  };
}
