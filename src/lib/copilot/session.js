import {
  COPILOT_SESSION_COOKIE,
  sessionAllowsTenant,
  verifyCopilotSessionToken,
} from "@/lib/copilot-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createReadOnlyAuthClient,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/auth-server";

function readSessionCookie(source) {
  if (!source) return null;
  if (typeof source.cookies?.get === "function") {
    return source.cookies.get(COPILOT_SESSION_COOKIE)?.value || null;
  }
  if (typeof source.get === "function") {
    return source.get(COPILOT_SESSION_COOKIE)?.value || null;
  }
  return null;
}

/** Graph wa_id is digits without +. Test-call / Vapi need E.164. */
export function waIdToE164(waId) {
  const raw = String(waId || "").trim();
  if (!raw) return null;
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

/**
 * getUser() validates the JWT against Supabase rather than trusting the cookie,
 * so a forged session cannot resolve to an agent row.
 */
async function supabaseAuthUserId(source) {
  if (!isSupabaseAuthConfigured()) return null;
  try {
    const client = createReadOnlyAuthClient(source);
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * @param {Request | { cookies: { get: Function } } | { get: Function }} source
 *   Route `request`, or `cookies()` from next/headers.
 * @param {{ tenantSlug?: string }} [opts]
 *   When tenantSlug is set, mismatch throws with status 403.
 * @returns {Promise<{ agentId: string, tenantId: string, tenantSlug: string, role: string, waPhone: string | null } | null>}
 */
export async function getSession(source, { tenantSlug } = {}) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const select = "id, tenant_id, role, wa_id, tenants!inner(id, slug)";
  let query = supabase.from("agents").select(select);
  let fallbackSlug = null;

  // Supabase Auth first; agents still on the legacy form fall through to the
  // HMAC cookie until every account has migrated.
  const authUserId = await supabaseAuthUserId(source);
  if (authUserId) {
    query = query.eq("auth_user_id", authUserId);
  } else {
    const token = readSessionCookie(source);
    const payload = token ? verifyCopilotSessionToken(token) : null;
    if (!payload?.agentId || !payload?.tenantId || !payload?.tenantSlug) {
      return null;
    }
    if (tenantSlug && !sessionAllowsTenant(payload, tenantSlug)) {
      const error = new Error("Forbidden for this tenant.");
      error.status = 403;
      throw error;
    }
    query = query.eq("id", payload.agentId).eq("tenant_id", payload.tenantId);
    fallbackSlug = payload.tenantSlug;
  }

  const { data: agent, error } = await query.maybeSingle();
  if (error) throw new Error(`Agent session lookup failed: ${error.message}`);
  if (!agent) return null;

  // Authoritative for both paths: role and tenant come from the row, never a claim.
  const slug = agent.tenants?.slug || fallbackSlug;
  if (tenantSlug && slug !== String(tenantSlug).trim()) {
    const mismatch = new Error("Forbidden for this tenant.");
    mismatch.status = 403;
    throw mismatch;
  }

  return {
    agentId: agent.id,
    tenantId: agent.tenant_id,
    tenantSlug: slug,
    role: agent.role === "admin" ? "admin" : "agent",
    waPhone: waIdToE164(agent.wa_id),
  };
}
