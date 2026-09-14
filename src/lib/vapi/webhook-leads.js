import { phoneToWaId } from "@/lib/leads/normalize";

/**
 * Resolve a campaign lead for a Vapi end-of-call event.
 * Fail closed: never look up a lead without tenantId, and never return a
 * row whose tenant_id does not match.
 */
export async function findLeadByPhone(supabase, tenantId, phone) {
  if (!supabase || !tenantId) return null;
  const waId = phoneToWaId(phone);
  if (!waId) return null;

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("wa_id", waId)
    .maybeSingle();
  if (error) throw new Error(`Lead phone lookup failed: ${error.message}`);
  if (data) return data;

  const suffix = waId.slice(-9);
  if (suffix.length < 8) return null;

  const { data: matches, error: suffixError } = await supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .like("wa_id", `%${suffix}`)
    .limit(1);
  if (suffixError) {
    throw new Error(`Lead suffix lookup failed: ${suffixError.message}`);
  }
  const hit = matches?.[0] || null;
  if (hit && hit.tenant_id !== tenantId) return null;
  return hit;
}

export async function resolveWebhookLead(supabase, { tenantId, leadIdHint, phone } = {}) {
  if (!supabase || !tenantId) return null;

  const hint = String(leadIdHint || "").trim();
  if (hint) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", hint)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) throw new Error(`Lead id lookup failed: ${error.message}`);
    if (data) return data;
  }

  return findLeadByPhone(supabase, tenantId, phone);
}

/** Prefer the existing call row so spoofed metadata cannot retarget another tenant. */
export function resolveCallTenantId({ existingCall, metadata } = {}) {
  if (existingCall?.tenant_id) return String(existingCall.tenant_id);
  if (metadata?.tenantId) return String(metadata.tenantId);
  return null;
}

export async function resolveCompletedCallContext(supabase, details) {
  if (!supabase || !details?.callId) {
    return { tenantId: null, lead: null, existing: null };
  }

  const { data: existing, error } = await supabase
    .from("calls")
    .select("id, tenant_id, results_synced")
    .eq("vapi_call_id", details.callId)
    .maybeSingle();
  if (error) throw new Error(`Call lookup failed: ${error.message}`);

  const tenantId = resolveCallTenantId({
    existingCall: existing,
    metadata: details.metadata,
  });
  if (!tenantId) {
    return { tenantId: null, lead: null, existing: existing || null };
  }

  const lead = await resolveWebhookLead(supabase, {
    tenantId,
    leadIdHint: details.metadata?.leadId,
    phone: details.customerNumber,
  });
  return { tenantId, lead, existing: existing || null };
}
