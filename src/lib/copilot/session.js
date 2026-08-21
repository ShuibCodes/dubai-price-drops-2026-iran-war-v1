import {
  COPILOT_SESSION_COOKIE,
  sessionAllowsTenant,
  verifyCopilotSessionToken,
} from "@/lib/copilot-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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
 * @param {Request | { cookies: { get: Function } } | { get: Function }} source
 *   Route `request`, or `cookies()` from next/headers.
 * @param {{ tenantSlug?: string }} [opts]
 *   When tenantSlug is set, mismatch throws with status 403.
 * @returns {Promise<{ agentId: string, tenantId: string, tenantSlug: string, role: string, waPhone: string | null } | null>}
 */
export async function getSession(source, { tenantSlug } = {}) {
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

  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { data: agent, error } = await supabase
    .from("agents")
    .select("id, tenant_id, role, wa_id, tenants!inner(id, slug)")
    .eq("id", payload.agentId)
    .eq("tenant_id", payload.tenantId)
    .maybeSingle();

  if (error) throw new Error(`Agent session lookup failed: ${error.message}`);
  if (!agent) return null;

  const slug = agent.tenants?.slug || payload.tenantSlug;
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
