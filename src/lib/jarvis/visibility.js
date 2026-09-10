import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";

export function assertJarvisActor({ tenantId, agentId } = {}) {
  if (!tenantId) throw new Error("tenantId is required");
  if (!agentId) throw new Error("agentId is required");
}

export function inboxLeadVisible(lead, agentId) {
  if (!lead || !agentId) return false;
  return !lead.assigned_agent_id || lead.assigned_agent_id === agentId;
}

export function applyVisibleInboxLeadScope(query, { tenantId, agentId } = {}) {
  assertJarvisActor({ tenantId, agentId });
  return query
    .eq("tenant_id", tenantId)
    .or(`assigned_agent_id.is.null,assigned_agent_id.eq.${agentId}`);
}

export function applyCampaignAgentScope(query, { tenantId, agentId } = {}) {
  assertJarvisActor({ tenantId, agentId });
  return query
    .eq("tenant_id", tenantId)
    .eq("assigned_agent_id", agentId);
}

export async function listVisibleInboxLeadIds(
  supabase,
  { tenantId, agentId } = {}
) {
  if (!supabase) throw new Error("Supabase is required");
  const { data, error } = await applyVisibleInboxLeadScope(
    supabase.from(JARVIS_LEADS_TABLE).select("id"),
    { tenantId, agentId }
  );
  if (error) throw new Error(`Visible Jarvis leads lookup failed: ${error.message}`);
  return new Set((data || []).map((row) => row.id));
}

export async function getVisibleInboxLead(
  supabase,
  { tenantId, agentId, leadId, select = "*" } = {}
) {
  if (!supabase) throw new Error("Supabase is required");
  assertJarvisActor({ tenantId, agentId });
  const id = String(leadId || "").trim();
  if (!id) return null;

  const { data, error } = await applyVisibleInboxLeadScope(
    supabase.from(JARVIS_LEADS_TABLE).select(select).eq("id", id),
    { tenantId, agentId }
  ).maybeSingle();
  if (error) throw new Error(`Visible Jarvis lead lookup failed: ${error.message}`);
  return data || null;
}
