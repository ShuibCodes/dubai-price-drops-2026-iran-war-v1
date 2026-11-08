import { VAPI_CALENDAR_TOOL_DEFINITIONS } from "../calendar/tools.js";

export const VAPI_REQUIRED_SERVER_MESSAGES = [
  "end-of-call-report",
  "status-update",
  "tool-calls",
];

/** Used only when creating a new assistant (no existing serverMessages to merge). */
export const VAPI_DEFAULT_SERVER_MESSAGES = [
  "conversation-update",
  "end-of-call-report",
  "hang",
  "speech-update",
  "status-update",
  "tool-calls",
  "transcript",
  "user-interrupted",
];

export function isNativeGoogleCalendarTool(tool) {
  const type = String(tool?.type || "");
  return /^google\.calendar/i.test(type) || type === "googleCalendar";
}

export function calendarToolName(tool) {
  return String(tool?.function?.name || tool?.name || "").trim();
}

export function calendarToolsForAssistant(serverUrl) {
  const url = String(serverUrl || "").trim();
  return VAPI_CALENDAR_TOOL_DEFINITIONS.map((tool) => {
    const next = {
      type: "function",
      async: false,
      function: { ...tool.function },
    };
    if (url) next.server = { url, timeoutSeconds: 20 };
    return next;
  });
}

export function mergeAssistantModelTools(existingTools, calendarTools) {
  const kept = (Array.isArray(existingTools) ? existingTools : []).filter((tool) => {
    if (isNativeGoogleCalendarTool(tool)) return false;
    const name = calendarToolName(tool);
    return name !== "check_availability" && name !== "book_appointment";
  });
  return [...kept, ...(Array.isArray(calendarTools) ? calendarTools : [])];
}

export function mergeServerMessages(existing, { includeDefaults = false } = {}) {
  const base = includeDefaults
    ? VAPI_DEFAULT_SERVER_MESSAGES
    : Array.isArray(existing)
      ? existing
      : [];
  const extra = includeDefaults
    ? Array.isArray(existing)
      ? existing
      : []
    : VAPI_REQUIRED_SERVER_MESSAGES;
  const seen = new Set();
  const out = [];
  for (const item of [...base, ...extra, ...VAPI_REQUIRED_SERVER_MESSAGES]) {
    const value = String(item || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function preservedToolIds(existingAssistant) {
  const ids = existingAssistant?.model?.toolIds || existingAssistant?.toolIds;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => String(id || "").trim()).filter(Boolean);
}
