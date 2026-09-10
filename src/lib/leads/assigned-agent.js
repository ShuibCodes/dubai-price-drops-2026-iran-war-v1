import { phoneToWaId } from "@/lib/leads/normalize";
import { normalizeWaId } from "@/lib/supabase/server";

/**
 * Keep an existing owner. Never clear assignment. Never steal from another agent.
 * @param {string | null | undefined} existingId
 * @param {string | null | undefined} incomingId
 */
export function nextAssignedAgentId(existingId, incomingId) {
  const existing = existingId ? String(existingId) : null;
  const incoming = incomingId ? String(incomingId) : null;
  if (!incoming) return existing;
  if (!existing || existing === incoming) return incoming;
  return existing;
}

export async function findTenantAgentIdByWaId(supabase, tenantId, waId) {
  const digits = normalizeWaId(waId);
  if (!supabase || !tenantId || !digits) return null;
  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("wa_id", digits)
    .maybeSingle();
  if (error) throw new Error(`Agent wa_id lookup failed: ${error.message}`);
  return data?.id || null;
}

export async function findTenantAgentIdByPhone(supabase, tenantId, agentPhone) {
  return findTenantAgentIdByWaId(supabase, tenantId, phoneToWaId(agentPhone));
}
