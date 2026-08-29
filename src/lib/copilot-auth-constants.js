export const COPILOT_SESSION_COOKIE = "copilot_session";
export const COPILOT_LOGIN_PATH = "/copilot";

export function copilotHomePath(tenantSlug) {
  const slug = String(tenantSlug || "").trim();
  if (!slug) return COPILOT_LOGIN_PATH;
  return `/copilot/${encodeURIComponent(slug)}`;
}

/** Only honor ?next= when it targets the signed-in user's tenant. */
export function safeCopilotNextPath(raw, tenantSlug) {
  const home = copilotHomePath(tenantSlug);
  if (typeof raw !== "string" || raw.startsWith("//") || !raw.startsWith("/copilot/")) {
    return home;
  }
  if (raw === home || raw.startsWith(`${home}/`)) return raw;
  return home;
}

export function copilotLoginHref(nextPath) {
  const next = String(nextPath || "").trim();
  if (!next || next === COPILOT_LOGIN_PATH) return COPILOT_LOGIN_PATH;
  return `${COPILOT_LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

export function isCopilotLoginPath(pathname) {
  return pathname === COPILOT_LOGIN_PATH || pathname === "/copilot/login";
}
