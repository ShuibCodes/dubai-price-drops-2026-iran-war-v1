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
 * Default channel is 'whatsapp' (matching agents.wa_id).
 * For 'imessage', checks imessage_address, wa_id, or email.
 */
export async function resolveJarvisSender(senderPhone, { channel = "whatsapp" } = {}) {
  const raw = String(senderPhone || "").trim();
  if (!raw) return null;

  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  let agent = null;
  const isEmail = raw.includes("@");
  const waId = normalizeJarvisWaId(raw);

  if (channel === "imessage" || isEmail) {
    // 1. Try imessage_address if iMessage channel
    try {
      const { data } = await supabase
        .from("agents")
        .select("id, name, username, role, wa_id, tenant_id")
        .eq("imessage_address", raw)
        .maybeSingle();
      if (data) agent = data;
    } catch {
      // Column may not exist or query failed
    }

    // 2. Try email if raw is an email
    if (!agent && isEmail) {
      try {
        const { data } = await supabase
          .from("agents")
          .select("id, name, username, role, wa_id, tenant_id")
          .eq("email", raw.toLowerCase())
          .maybeSingle();
        if (data) agent = data;
      } catch {
        // Ignore lookup error
      }
    }

    // 3. Fallback to wa_id lookup if digits exist
    if (!agent && waId) {
      const { data, error } = await supabase
        .from("agents")
        .select("id, name, username, role, wa_id, tenant_id")
        .eq("wa_id", waId)
        .maybeSingle();

      if (error) throw new Error(`Jarvis sender lookup failed: ${error.message}`);
      if (data) agent = data;
    }
  } else {
    // Standard WhatsApp channel: match by wa_id only
    if (!waId) return null;

    const { data, error } = await supabase
      .from("agents")
      .select("id, name, username, role, wa_id, tenant_id")
      .eq("wa_id", waId)
      .maybeSingle();

    if (error) throw new Error(`Jarvis sender lookup failed: ${error.message}`);
    if (data) agent = data;
  }

  if (!agent?.tenant_id) return null;

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("id", agent.tenant_id)
    .maybeSingle();

  if (tenantError) throw new Error(`Jarvis sender lookup failed: ${tenantError.message}`);
  if (!tenant?.id) return null;

  const agentName =
    String(agent.name || "").trim() ||
    String(agent.username || "").trim() ||
    "there";

  return {
    agentId: agent.id,
    agentName,
    agentFirstName: firstName(agentName) || "there",
    role: agent.role === "admin" ? "admin" : "agent",
    waId: agent.wa_id || waId || agent.id.replace(/\D/g, ""),
    tenantId: agent.tenant_id,
    tenantName: tenant.name || tenant.slug || "workspace",
    tenantSlug: tenant.slug || null,
  };
}
