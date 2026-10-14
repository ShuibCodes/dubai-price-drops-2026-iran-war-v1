/**
 * Decide which tenant may receive a Meta WhatsApp connection.
 * Never guesses (oldest tenant, existing WABA owner, or a Default Tenant insert).
 *
 * Session tenant is the only write target. Client tenant_slug may only
 * confirm that same tenant; it is never used to pick a destination.
 *
 * @param {{
 *   session?: { tenantId?: string, tenantSlug?: string } | null,
 *   tenantSlug?: string | null,
 *   supabase?: { from: Function },
 * }} args
 * @returns {Promise<
 *   | { tenantId: string, error?: undefined, status?: undefined }
 *   | { tenantId?: undefined, error: string, status: number }
 * >}
 */
export async function resolveMetaExchangeTarget({
  session = null,
  tenantSlug = null,
  supabase,
} = {}) {
  const requestedSlug = String(tenantSlug || "")
    .trim()
    .toLowerCase();
  const sessionId = session?.tenantId ? String(session.tenantId) : "";
  const sessionSlug = String(session?.tenantSlug || "")
    .trim()
    .toLowerCase();

  if (!sessionId) {
    return {
      error: "Sign in to connect WhatsApp.",
      status: 401,
    };
  }

  if (requestedSlug && sessionSlug && requestedSlug !== sessionSlug) {
    return {
      error: "Forbidden for this tenant.",
      status: 403,
    };
  }

  return { tenantId: sessionId };
}
