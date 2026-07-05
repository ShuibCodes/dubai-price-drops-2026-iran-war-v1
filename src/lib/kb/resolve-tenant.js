import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";

export async function resolveTenantByAgent(waId) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const normalized = normalizeWaId(waId);
  if (!normalized) return null;

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("tenant_id")
    .eq("wa_id", normalized)
    .maybeSingle();

  if (agentError || !agent?.tenant_id) return null;

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", agent.tenant_id)
    .maybeSingle();

  if (tenantError || !tenant) return null;
  return tenant;
}

export async function resolveTenantByPhoneNumberId(phoneNumberId) {
  const supabase = getSupabaseServerClient();
  if (!supabase || !phoneNumberId) return null;

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("phone_number_id", String(phoneNumberId))
    .maybeSingle();

  if (error || !tenant) return null;
  return tenant;
}

export async function getFirstTenant() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !tenant) return null;
  return tenant;
}
