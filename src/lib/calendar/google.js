import { parseAvailabilityWindow } from "./schema.js";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export function getGoogleCalendarConfig() {
  const clientId = String(process.env.GOOGLE_CALENDAR_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.GOOGLE_CALENDAR_REDIRECT_URI || "").trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, or GOOGLE_CALENDAR_REDIRECT_URI"
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleAuthorizeUrl({ state, redirectUri } = {}) {
  const config = getGoogleCalendarConfig();
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri || config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  if (state) url.searchParams.set("state", String(state));
  return url.toString();
}

async function readGoogleJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      body?.error_description || body?.error?.message || body?.error || "Google API error";
    const error = new Error(`Google Calendar: ${message}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function exchangeGoogleCode(code, { redirectUri } = {}) {
  const config = getGoogleCalendarConfig();
  const trimmed = String(code || "").trim();
  if (!trimmed) throw new Error("Google OAuth code is required");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: trimmed,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri || config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await readGoogleJson(response);
  if (!body.refresh_token) {
    throw new Error("Google OAuth did not return a refresh_token");
  }
  return normalizeTokenResponse(body);
}

export async function refreshGoogleAccessToken(refreshToken) {
  const config = getGoogleCalendarConfig();
  const token = String(refreshToken || "").trim();
  if (!token) throw new Error("refresh_token is required");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const body = await readGoogleJson(response);
  return normalizeTokenResponse({ ...body, refresh_token: token });
}

export async function revokeGoogleToken(token) {
  const value = String(token || "").trim();
  if (!value) return { revoked: false, reason: "missing_token" };
  const response = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: value }),
  });
  if (!response.ok && response.status !== 200) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error_description || `Google revoke failed (${response.status})`);
  }
  return { revoked: true };
}

function authHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function fetchPrimaryCalendar(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("access_token is required");
  const response = await fetch(`${CALENDAR_API}/users/me/calendarList/primary`, {
    headers: authHeaders(token),
  });
  const body = await readGoogleJson(response);
  return {
    calendarId: body.id || "primary",
    calendarSummary: body.summary || null,
    calendarTimezone: body.timeZone || null,
    googleAccountEmail: body.id && String(body.id).includes("@") ? body.id : null,
  };
}

export async function checkGoogleFreeBusy({
  accessToken,
  calendarId = "primary",
  startDateTime,
  endDateTime,
  timeZone,
}) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("access_token is required");
  const window = parseAvailabilityWindow({
    startDateTime,
    endDateTime,
    timeZone,
  });
  if (!window.ok) {
    const error = new Error(window.error);
    error.fieldErrors = window.fieldErrors;
    throw error;
  }

  const response = await fetch(`${CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: window.data.startDateTime,
      timeMax: window.data.endDateTime,
      timeZone: window.data.timeZone || undefined,
      items: [{ id: calendarId || "primary" }],
    }),
  });
  const body = await readGoogleJson(response);
  const busy = body?.calendars?.[calendarId]?.busy || body?.calendars?.primary?.busy || [];
  return {
    calendarId: calendarId || "primary",
    timeMin: window.data.startDateTime,
    timeMax: window.data.endDateTime,
    busy: busy.map((slot) => ({
      start: slot.start,
      end: slot.end,
    })),
  };
}

export async function createGoogleCalendarEvent({
  accessToken,
  calendarId = "primary",
  summary,
  startDateTime,
  endDateTime,
  timeZone,
  description,
}) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("access_token is required");
  const title = String(summary || "").trim();
  if (!title) throw new Error("Event summary is required");
  const window = parseAvailabilityWindow({
    startDateTime,
    endDateTime,
    timeZone,
  });
  if (!window.ok) {
    const error = new Error(window.error);
    error.fieldErrors = window.fieldErrors;
    throw error;
  }

  const response = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId || "primary")}/events`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        description: description ? String(description) : undefined,
        start: {
          dateTime: window.data.startDateTime,
          timeZone: window.data.timeZone,
        },
        end: {
          dateTime: window.data.endDateTime,
          timeZone: window.data.timeZone,
        },
      }),
    }
  );
  const body = await readGoogleJson(response);
  return {
    eventId: body.id || null,
    htmlLink: body.htmlLink || null,
    start: body.start || null,
    end: body.end || null,
    status: body.status || null,
  };
}

/**
 * Best-effort compensation after a diary write that AgentZero could not persist.
 * 204/200 = deleted. 404/410 = already gone (treat as compensated, not created).
 * Does not claim success for any other status.
 */
export async function deleteGoogleCalendarEvent({
  accessToken,
  calendarId = "primary",
  eventId,
}) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("access_token is required");
  const id = String(eventId || "").trim();
  if (!id) throw new Error("eventId is required");

  const response = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId || "primary")}/events/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: authHeaders(token),
    }
  );
  if (response.status === 204 || response.status === 200) {
    return { deleted: true };
  }
  if (response.status === 404 || response.status === 410) {
    return { deleted: true, alreadyGone: true };
  }
  const body = await response.json().catch(() => ({}));
  const message =
    body?.error_description || body?.error?.message || body?.error || "Google API error";
  const error = new Error(`Google Calendar: ${message}`);
  error.status = response.status;
  error.body = body;
  throw error;
}

function normalizeTokenResponse(body) {
  const expiresIn = Number(body.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;
  return {
    access_token: body.access_token || null,
    refresh_token: body.refresh_token || null,
    expires_at: expiresAt,
    token_type: body.token_type || "Bearer",
    scope: body.scope || null,
  };
}
