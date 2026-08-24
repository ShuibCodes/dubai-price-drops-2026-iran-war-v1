import { getSupabaseServerClient } from "@/lib/supabase/server";

export function normalizeJarvisWaId(value) {
  return String(value || "").replace(/\D/g, "");
}

function firstName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] || "";
}

/**
 * AZ copilot identity: who is texting → which tenant they may see.
 * `agents.wa_id` is globally unique. No env slug, no shared Sterling fallback.
 */
export async function resolveJarvisSender(senderPhone) {
  const waId = normalizeJarvisWaId(senderPhone);
  if (!waId) return null;

  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data: agent, error } = await supabase
    .from("agents")
    .select("id, name, username, role, wa_id, tenant_id, tenants!inner(id, name, slug)")
    .eq("wa_id", waId)
    .maybeSingle();

  if (error) throw new Error(`Jarvis sender lookup failed: ${error.message}`);
  if (!agent?.tenant_id || !agent.tenants?.id) return null;

  const agentName =
    String(agent.name || "").trim() ||
    String(agent.username || "").trim() ||
    "there";

  return {
    agentId: agent.id,
    agentName,
    agentFirstName: firstName(agentName) || "there",
    role: agent.role === "admin" ? "admin" : "agent",
    waId: agent.wa_id,
    tenantId: agent.tenant_id,
    tenantName: agent.tenants.name || agent.tenants.slug || "workspace",
    tenantSlug: agent.tenants.slug || null,
  };
}
