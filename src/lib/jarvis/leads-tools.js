import { getSupabaseServerClient, MESSAGES_TABLE } from "@/lib/supabase/server";
import {
  assertOutboundActive,
  dialLeadNow,
  getOutboundTenant,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
} from "@/lib/calls/outbound";
import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

function fullPhone(waId) {
  const digits = String(waId || "").replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function qualification(call) {
  return call?.qualification && typeof call.qualification === "object"
    ? call.qualification
    : {};
}

function callTime(call) {
  return call?.started_at || call?.created_at || null;
}

function snippet(text, term) {
  const body = String(text || "");
  const idx = body.toLowerCase().indexOf(String(term || "").toLowerCase());
  if (idx < 0) return body.slice(0, 140);
  const start = Math.max(0, idx - 40);
  return body.slice(start, start + 140);
}

export async function getJarvisLatestMessages(tenantId, limit = 10) {
  const supabase = db();
  const capped = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select(
      "id, jarvis_lead_id, direction, body, msg_type, timestamp, created_at, jarvis_leads(push_name, wa_id)"
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .order("timestamp", { ascending: false })
    .limit(capped);
  if (error) throw new Error(`Latest messages query failed: ${error.message}`);

  return (data || []).map((message) => ({
    leadId: message.jarvis_lead_id,
    leadName: message.jarvis_leads?.push_name || null,
    phone: fullPhone(message.jarvis_leads?.wa_id),
    direction: message.direction,
    body: message.body || `[${message.msg_type || "message"}]`,
    timestamp: message.timestamp || message.created_at,
  }));
}

export async function searchJarvisLeadByName(tenantId, name) {
  const supabase = db();
  const query = String(name || "").trim();
  if (!query) return [];

  const term = query.replace(/[%_,()]/g, " ").trim();
  const { data: leads, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select("id, push_name, wa_id, source, owns_property, last_message_at")
    .eq("tenant_id", tenantId)
    .or(`push_name.ilike.%${term}%,source.ilike.%${term}%`)
    .order("last_message_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Lead search failed: ${error.message}`);
  if (!leads?.length) return [];

  const ids = leads.map((lead) => lead.id);
  const [callsResult, messagesResult] = await Promise.all([
    supabase
      .from("calls")
      .select("jarvis_lead_id, qualification, created_at")
      .eq("tenant_id", tenantId)
      .in("jarvis_lead_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from(MESSAGES_TABLE)
      .select("jarvis_lead_id")
      .eq("tenant_id", tenantId)
      .in("jarvis_lead_id", ids),
  ]);
  if (callsResult.error) {
    throw new Error(`Lead calls query failed: ${callsResult.error.message}`);
  }
  if (messagesResult.error) {
    throw new Error(`Lead messages query failed: ${messagesResult.error.message}`);
  }

  const latestOutcome = new Map();
  for (const call of callsResult.data || []) {
    if (!latestOutcome.has(call.jarvis_lead_id)) {
      latestOutcome.set(call.jarvis_lead_id, qualification(call).outcome || null);
    }
  }

  const messageCounts = new Map();
  for (const message of messagesResult.data || []) {
    messageCounts.set(
      message.jarvis_lead_id,
      (messageCounts.get(message.jarvis_lead_id) || 0) + 1
    );
  }

  return leads
    .map((lead) => ({
      id: lead.id,
      name: lead.push_name || null,
      phone: fullPhone(lead.wa_id),
      source: lead.source || null,
      ownsProperty: lead.owns_property || null,
      lastCallOutcome: latestOutcome.get(lead.id) || null,
      lastMessageAt: lead.last_message_at || null,
      messageCount: messageCounts.get(lead.id) || 0,
    }))
    .sort((a, b) => (b.messageCount > 0) - (a.messageCount > 0))
    .slice(0, 10);
}

export async function getJarvisLeadStory(tenantId, leadId) {
  const supabase = db();
  const { data: lead, error: leadError } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select("id, push_name, wa_id, source, owns_property")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error(`Lead lookup failed: ${leadError.message}`);
  if (!lead) return null;

  const [callsResult, messagesResult] = await Promise.all([
    supabase
      .from("calls")
      .select("id, started_at, ended_at, created_at, summary, qualification, recording_url")
      .eq("tenant_id", tenantId)
      .eq("jarvis_lead_id", leadId),
    supabase
      .from(MESSAGES_TABLE)
      .select("id, direction, body, msg_type, timestamp, created_at")
      .eq("tenant_id", tenantId)
      .eq("jarvis_lead_id", leadId),
  ]);
  if (callsResult.error) throw new Error(`Lead calls query failed: ${callsResult.error.message}`);
  if (messagesResult.error) {
    throw new Error(`Lead messages query failed: ${messagesResult.error.message}`);
  }

  const events = [
    ...(callsResult.data || []).map((call) => ({
      type: "call",
      timestamp: callTime(call),
      callId: call.id,
      summary: call.summary || null,
      outcome: qualification(call).outcome || null,
      crmNote: qualification(call).crm_note || null,
      recordingUrl: call.recording_url || null,
    })),
    ...(messagesResult.data || []).map((message) => ({
      type: "message",
      timestamp: message.timestamp || message.created_at,
      direction: message.direction,
      body: message.body || null,
    })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    lead: {
      id: lead.id,
      name: lead.push_name || null,
      phone: fullPhone(lead.wa_id),
      source: lead.source || null,
      ownsProperty: lead.owns_property || null,
    },
    events,
  };
}

export async function searchJarvisConversations(tenantId, query) {
  const supabase = db();
  const term = String(query || "").trim();
  if (!term) return [];

  const { data: messages, error } = await supabase
    .from(MESSAGES_TABLE)
    .select(
      "id, jarvis_lead_id, direction, body, timestamp, created_at, jarvis_leads(push_name, wa_id)"
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .ilike("body", `%${term}%`)
    .order("timestamp", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Conversation search failed: ${error.message}`);

  return (messages || []).map((message) => ({
    type: "message",
    leadId: message.jarvis_lead_id,
    leadName: message.jarvis_leads?.push_name || null,
    phone: fullPhone(message.jarvis_leads?.wa_id),
    direction: message.direction,
    timestamp: message.timestamp || message.created_at,
    snippet: snippet(message.body, term),
  }));
}

export async function getJarvisCallDetail(tenantId, { leadId, callId } = {}) {
  const supabase = db();
  let query = supabase
    .from("calls")
    .select(
      "id, jarvis_lead_id, started_at, ended_at, created_at, duration_seconds, transcript, recording_url, qualification, summary, jarvis_leads(push_name, wa_id)"
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null);

  if (callId) query = query.eq("id", callId);
  if (leadId) query = query.eq("jarvis_lead_id", leadId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Call detail query failed: ${error.message}`);
  if (!data) return null;

  const q = qualification(data);
  return {
    callId: data.id,
    leadId: data.jarvis_lead_id,
    leadName: data.jarvis_leads?.push_name || null,
    phone: fullPhone(data.jarvis_leads?.wa_id),
    startedAt: data.started_at || data.created_at,
    endedAt: data.ended_at || null,
    durationSeconds: data.duration_seconds || null,
    outcome: q.outcome || null,
    summary: data.summary || null,
    crmNote: q.crm_note || null,
    transcript: data.transcript || null,
    recordingUrl: data.recording_url || null,
  };
}

export async function getJarvisPendingCallbacks(tenantId) {
  const supabase = db();
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id, jarvis_lead_id, created_at, qualification, jarvis_leads(push_name, wa_id)"
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .eq("qualification->>outcome", "callback")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Callbacks query failed: ${error.message}`);

  const seen = new Set();
  const out = [];
  for (const call of data || []) {
    if (!call.jarvis_lead_id || seen.has(call.jarvis_lead_id)) continue;
    seen.add(call.jarvis_lead_id);
    const q = qualification(call);
    out.push({
      leadId: call.jarvis_lead_id,
      leadName: call.jarvis_leads?.push_name || null,
      phone: fullPhone(call.jarvis_leads?.wa_id),
      callbackTime: q.callback_time || null,
      calledAt: call.created_at,
    });
  }
  return out;
}

async function dialJarvisLeadNow({ supabase, tenant, lead, source }) {
  return dialLeadNow({
    supabase,
    tenant,
    lead,
    source,
    jarvisLead: true,
  });
}

export async function startJarvisTargetCall(tenantId, leadId, requestedBy) {
  const supabase = db();
  const tenant = await getOutboundTenant(supabase, tenantId);
  assertOutboundActive(tenant);

  const { data: lead, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select("id, push_name, wa_id, source, owns_property, pixxi_lead_id")
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(`Lead lookup failed: ${error.message}`);
  if (!lead) throw new Error("Lead not found");

  const leadPhone = lead.wa_id ? `+${lead.wa_id}` : null;
  if (leadPhone && !isLeadWithinBusinessHours(leadPhone)) {
    const scheduledFor = nextLeadWindowStart(leadPhone).toISOString();
    const { error: queueError } = await supabase.from("call_queue").insert({
      tenant_id: tenantId,
      lead_id: null,
      jarvis_lead_id: lead.id,
      scheduled_for: scheduledFor,
      processed: false,
      source: "jarvis-target-call",
      requested_by: requestedBy || null,
    });
    if (queueError) throw new Error(`Queue insert failed: ${queueError.message}`);
    return { ok: true, queued: scheduledFor };
  }

  const result = await dialJarvisLeadNow({
    supabase,
    tenant,
    lead,
    source: "jarvis-target-call",
  });
  return { ok: true, callId: result.callId };
}
