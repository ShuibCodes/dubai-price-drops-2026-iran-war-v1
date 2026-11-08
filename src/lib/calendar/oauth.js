import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchPrimaryCalendar,
  GOOGLE_CALENDAR_SCOPES,
  revokeGoogleToken,
} from "./google.js";
import {
  createCalendarOAuthState,
  normalizeCalendarReturnTo,
  sessionMatchesOAuthState,
  verifyCalendarOAuthState,
} from "./oauth-state.js";
import {
  calendarSettingsPayload,
  loadAgentCalendarConnection,
  revokeAgentCalendarConnection,
  upsertAgentCalendarConnection,
} from "./store.js";
import { encryptCalendarTokens } from "./tokens.js";

export function calendarReturnPath(tenantSlug, returnTo = "settings", query = "") {
  const slug = encodeURIComponent(String(tenantSlug || "").trim());
  const path =
    normalizeCalendarReturnTo(returnTo) === "join"
      ? `/copilot/${slug}/join`
      : `/copilot/${slug}/settings`;
  return query ? `${path}?${query}` : path;
}

export function settingsRedirect(tenantSlug, query = "") {
  return calendarReturnPath(tenantSlug, "settings", query);
}

export function startCalendarConnect(session, { returnTo } = {}) {
  if (!session?.tenantId || !session?.agentId || !session?.tenantSlug) {
    return { error: "Unauthorized", status: 401 };
  }
  const state = createCalendarOAuthState({
    tenantId: session.tenantId,
    agentId: session.agentId,
    tenantSlug: session.tenantSlug,
    returnTo,
  });
  const url = buildGoogleAuthorizeUrl({ state });
  return { url };
}

export async function getCalendarStatus(supabase, session) {
  if (!session?.tenantId || !session?.agentId) {
    return { error: "Unauthorized", status: 401 };
  }
  const { connection, unavailable } = await loadAgentCalendarConnection(supabase, {
    tenantId: session.tenantId,
    agentId: session.agentId,
  });
  return {
    ...calendarSettingsPayload(connection),
    unavailable: Boolean(unavailable),
  };
}

export async function disconnectCalendar(supabase, session) {
  if (!session?.tenantId || !session?.agentId) {
    return { error: "Unauthorized", status: 401 };
  }
  const result = await revokeAgentCalendarConnection(supabase, {
    tenantId: session.tenantId,
    agentId: session.agentId,
    revokeGoogleToken,
  });
  return {
    ok: true,
    ...calendarSettingsPayload(result.connection || null),
    connected: false,
    status: result.connection?.status || "revoked",
  };
}

export async function completeCalendarCallback(supabase, session, { code, state, error }) {
  const statePayload = verifyCalendarOAuthState(state);
  const returnTo = normalizeCalendarReturnTo(statePayload?.returnTo);

  if (error) {
    return {
      redirect: calendarReturnPath(
        session?.tenantSlug || statePayload?.tenantSlug,
        returnTo,
        "calendar=error"
      ),
    };
  }
  if (!session?.tenantId || !session?.agentId) {
    return { error: "Unauthorized", status: 401 };
  }

  if (!statePayload) {
    return { error: "Invalid or expired calendar connect state.", status: 400 };
  }
  if (!sessionMatchesOAuthState(session, statePayload)) {
    return { error: "Forbidden for this tenant.", status: 403 };
  }

  const trimmedCode = String(code || "").trim();
  if (!trimmedCode) {
    return { error: "Missing Google authorization code.", status: 400 };
  }

  const tokens = await exchangeGoogleCode(trimmedCode);
  const calendar = await fetchPrimaryCalendar(tokens.access_token);
  const tokenCiphertext = encryptCalendarTokens(tokens);

  await upsertAgentCalendarConnection(supabase, {
    tenantId: session.tenantId,
    agentId: session.agentId,
    googleAccountEmail: calendar.googleAccountEmail,
    calendarId: calendar.calendarId,
    calendarSummary: calendar.calendarSummary,
    calendarTimezone: calendar.calendarTimezone,
    tokenCiphertext,
    tokenExpiresAt: tokens.expires_at,
    scopes: tokens.scope ? tokens.scope.split(/\s+/) : GOOGLE_CALENDAR_SCOPES,
  });

  return {
    redirect: calendarReturnPath(session.tenantSlug, returnTo, "calendar=connected"),
  };
}
