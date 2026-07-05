import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";

function formatRelativeTime(timestamp) {
  if (!timestamp) return "unknown time";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "unknown time";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toISOString().slice(0, 10);
}

function formatWaDisplay(waId) {
  const digits = normalizeWaId(waId);
  if (!digits) return "unknown";
  return `+${digits}`;
}

function formatMessageLine(message) {
  const speaker = message.direction === "outbound" ? "me" : "lead";
  const body = String(message.body || "").trim() || `[${message.msg_type || "message"}]`;
  return `${speaker}: ${body}`;
}

export function formatLiveContext(conversations = []) {
  if (!Array.isArray(conversations) || !conversations.length) {
    return "";
  }

  return conversations
    .map((conversation) => {
      const leadName = conversation.push_name || "Unknown";
      const waDisplay = formatWaDisplay(conversation.wa_id);
      const lastAt = formatRelativeTime(conversation.last_message_at);
      const header = `[Lead: ${leadName} (${waDisplay}), last message ${lastAt}]`;
      const lines = (conversation.messages || []).map(formatMessageLine).join("\n");
      return `${header}\n${lines}`.trim();
    })
    .join("\n\n");
}

export async function getRecentConversations(tenantId, { limit = 5, messageLimit = 10 } = {}) {
  const supabase = getSupabaseServerClient();
  if (!supabase || !tenantId) return [];

  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("id, wa_id, push_name, last_message_at")
    .eq("tenant_id", tenantId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (leadsError || !leads?.length) return [];

  const conversations = await Promise.all(
    leads.map(async (lead) => {
      const { data: messages } = await supabase
        .from("messages")
        .select("direction, body, msg_type, timestamp")
        .eq("tenant_id", tenantId)
        .eq("lead_id", lead.id)
        .order("timestamp", { ascending: true })
        .limit(messageLimit);

      return {
        ...lead,
        messages: messages || [],
      };
    })
  );

  return conversations;
}

export async function getLeadThread(tenantId, waIdOrNameFragment, { messageLimit = 50 } = {}) {
  const supabase = getSupabaseServerClient();
  if (!supabase || !tenantId || !waIdOrNameFragment) return null;

  const fragment = String(waIdOrNameFragment).trim();
  const digits = normalizeWaId(fragment);

  let query = supabase
    .from("leads")
    .select("id, wa_id, push_name, last_message_at")
    .eq("tenant_id", tenantId);

  if (digits.length >= 4) {
    query = query.or(`wa_id.ilike.%${digits}%,push_name.ilike.%${fragment}%`);
  } else {
    query = query.ilike("push_name", `%${fragment}%`);
  }

  const { data: leads, error } = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error || !leads?.length) return null;

  const lead = leads[0];
  const { data: messages } = await supabase
    .from("messages")
    .select("direction, body, msg_type, timestamp")
    .eq("tenant_id", tenantId)
    .eq("lead_id", lead.id)
    .order("timestamp", { ascending: true })
    .limit(messageLimit);

  return {
    ...lead,
    messages: messages || [],
  };
}
