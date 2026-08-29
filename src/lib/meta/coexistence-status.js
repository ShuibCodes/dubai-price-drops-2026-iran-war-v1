import { whatsappHealthy } from "@/lib/console/format";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function loadTenantCoexistence(tenantId) {
  const supabase = getSupabaseServerClient();
  if (!supabase || !tenantId) return null;
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, waba_id, phone_number_id, business_token, display_phone")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function probeCoexistence(tenant) {
  if (!whatsappHealthy(tenant)) {
    return { connected: false, live: false, displayPhone: null };
  }

  const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
  try {
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion}/${tenant.phone_number_id}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${tenant.business_token}` } }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        connected: true,
        live: false,
        displayPhone: tenant.display_phone || null,
        error: payload?.error?.message || `Graph ${response.status}`,
      };
    }
    return {
      connected: true,
      live: true,
      displayPhone: payload?.display_phone_number || tenant.display_phone || null,
    };
  } catch (error) {
    return {
      connected: true,
      live: false,
      displayPhone: tenant.display_phone || null,
      error: error.message,
    };
  }
}
