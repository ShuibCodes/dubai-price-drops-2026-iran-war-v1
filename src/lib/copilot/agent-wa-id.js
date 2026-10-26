import { phoneToWaId, normalizePhone } from "../leads/normalize.js";

/**
 * Normalizes a raw phone number into pure digits for `agents.wa_id`.
 * Validates length: WhatsApp E.164 phone numbers have between 6 and 20 digits.
 *
 * @param {string | number | null | undefined} rawPhone
 * @returns {string | null}
 */
export function cleanWaId(rawPhone) {
  if (rawPhone == null) return null;
  const str = String(rawPhone).trim();
  if (!str) return null;

  // First try the lead phone normalizer (handles UAE local prefixes, 05x, etc.)
  const normalizedFromLead = phoneToWaId(str);
  if (normalizedFromLead && /^\d{6,20}$/.test(normalizedFromLead)) {
    return normalizedFromLead;
  }

  // Fallback: extract pure digits
  const digits = str.replace(/\D/g, "");
  if (/^\d{6,20}$/.test(digits)) {
    return digits;
  }

  return null;
}

/**
 * Automatically assign or update an agent's wa_id.
 *
 * Edge cases handled:
 * 1. Missing / invalid phone input: returns { ok: false, error: 'invalid_phone' }.
 * 2. Missing agentId: returns { ok: false, error: 'missing_agent' }.
 * 3. Idempotent: if agent already has this wa_id, returns { ok: true, unchanged: true, waId }.
 * 4. Unique conflict: if another agent already owns this wa_id, returns { ok: false, conflict: true, error: 'wa_id_conflict' }
 *    without throwing, protecting callers (e.g. Meta token exchange) from failing.
 * 5. Flag `overwriteExisting: false`: if agent already has a different number, skips update.
 *
 * @param {object} supabase - Supabase server/service-role client
 * @param {object} params
 * @param {string} params.agentId - UUID of the agent
 * @param {string} params.rawPhone - Raw phone number from Meta Graph or Auth provider
 * @param {boolean} [params.overwriteExisting=true] - Whether to overwrite an existing wa_id
 * @returns {Promise<{ ok: boolean, waId?: string, unchanged?: boolean, skipped?: boolean, conflict?: boolean, error?: string }>}
 */
export async function assignAgentWaId(
  supabase,
  { agentId, rawPhone, overwriteExisting = true }
) {
  if (!supabase) {
    return { ok: false, error: "missing_supabase" };
  }
  if (!agentId) {
    return { ok: false, error: "missing_agent" };
  }

  const waId = cleanWaId(rawPhone);
  if (!waId) {
    return { ok: false, error: "invalid_phone" };
  }

  // Look up target agent
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, wa_id, tenant_id")
    .eq("id", agentId)
    .maybeSingle();

  if (agentError) {
    return { ok: false, error: `agent_lookup_failed: ${agentError.message}` };
  }
  if (!agent) {
    return { ok: false, error: "agent_not_found" };
  }

  // Idempotency: agent already has this exact wa_id
  if (agent.wa_id === waId) {
    return { ok: true, unchanged: true, waId };
  }

  // If overwriteExisting is false and agent already has a wa_id, skip
  if (!overwriteExisting && agent.wa_id) {
    return { ok: true, skipped: true, waId: agent.wa_id };
  }

  // Check if another agent already has this wa_id (agents_wa_id_unique constraint)
  const { data: conflict, error: conflictError } = await supabase
    .from("agents")
    .select("id, name, tenant_id")
    .eq("wa_id", waId)
    .neq("id", agentId)
    .maybeSingle();

  if (conflictError) {
    return { ok: false, error: `conflict_check_failed: ${conflictError.message}` };
  }

  if (conflict) {
    return {
      ok: false,
      conflict: true,
      error: "wa_id_conflict",
      conflictingAgentId: conflict.id,
    };
  }

  // Update agent row
  const { error: updateError } = await supabase
    .from("agents")
    .update({ wa_id: waId })
    .eq("id", agentId);

  if (updateError) {
    return { ok: false, error: `update_failed: ${updateError.message}` };
  }

  return { ok: true, waId };
}
