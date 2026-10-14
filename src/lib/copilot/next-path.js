// The single place a ?next= value becomes a redirect target, shared by the
// OAuth callback and the login form. The raw value is pushed through the URL
// parser *before* the tenant-prefix check so dot-segments ("..", "%2e%2e") and
// backslash tricks cannot smuggle a path past it. The output is always a
// same-origin path: the input must start with "/copilot/" and is resolved
// against a fixed dummy origin, so an absolute or protocol-relative URL can
// never survive.

const DUMMY_ORIGIN = "https://next-check.invalid";

/**
 * @param {unknown} raw the untrusted ?next= value
 * @param {string} tenantSlug the tenant the session actually resolved to
 * @returns {string} a path confined to /copilot/<tenantSlug>, else its home
 */
export function safeNextPath(raw, tenantSlug) {
  const slug = String(tenantSlug || "").trim();
  const home = slug ? `/copilot/${encodeURIComponent(slug)}` : "/copilot";
  if (typeof raw !== "string" || !raw.startsWith("/copilot/")) return home;

  let normalized;
  try {
    const url = new URL(raw, DUMMY_ORIGIN);
    if (url.origin !== DUMMY_ORIGIN) return home;
    normalized = url.pathname + url.search;
  } catch {
    return home;
  }

  return normalized === home || normalized.startsWith(`${home}/`)
    ? normalized
    : home;
}
