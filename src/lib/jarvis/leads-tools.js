import { getSupabaseServerClient, MESSAGES_TABLE, normalizeWaId } from "@/lib/supabase/server";
import {
  assertOutboundActive,
  dialLeadNow,
  getOutboundTenant,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
} from "@/lib/calls/outbound";
import { scriptPointerForSource } from "@/lib/scripts/pointers";
import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";
import {
  ensureJarvisInferredName,
  ensureJarvisInferredNames,
  formatJarvisLeadName,
} from "@/lib/jarvis/infer-name";
import {
  buildJarvisNameOrFilter,
  cleanJarvisSearchName,
  jarvisNameSearchTerms,
} from "@/lib/jarvis/name-search";

const JARVIS_LEAD_NAME_SELECT =
  "push_name, wa_id, inferred_name, inferred_name_confidence, inferred_name_at";

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

function leadNameFields(jarvisLead) {
  return {
    id: null,
    push_name: jarvisLead?.push_name || null,
    inferred_name: jarvisLead?.inferred_name || null,
    inferred_name_confidence: jarvisLead?.inferred_name_confidence || null,
    inferred_name_at: jarvisLead?.inferred_name_at || null,
    wa_id: jarvisLead?.wa_id || null,
  };
}

async function enrichConversationSlice(tenantId, conversations) {
  const supabase = db();
  const candidates = conversations.map((row) => ({
    id: row.leadId,
    push_name: row.push_name,
    inferred_name: row.inferred_name,
    inferred_name_confidence: row.inferred_name_confidence,
    inferred_name_at: row.inferred_name_at,
    wa_id: row.wa_id,
  }));
  const enriched = await ensureJarvisInferredNames(supabase, tenantId, candidates);

  return conversations.map((row) => {
    const lead = enriched.get(row.leadId) || row;
    const formatted = formatJarvisLeadName(lead);
    return {
      leadId: row.leadId,
      leadName: formatted.displayName,
      nameSource: formatted.nameSource,
      nameConfidence: formatted.nameConfidence,
      phone: row.phone || fullPhone(lead.wa_id),
      direction: row.direction,
      snippet: row.snippet,
      lastAt: row.lastAt,
      age: row.age,
    };
  });
}

export async function getJarvisLatestMessages(tenantId, limit = 10) {
  const supabase = db();
  const capped = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select(
      `id, jarvis_lead_id, direction, body, msg_type, timestamp, created_at, jarvis_leads(${JARVIS_LEAD_NAME_SELECT})`
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .order("timestamp", { ascending: false })
    .limit(capped);
  if (error) throw new Error(`Latest messages query failed: ${error.message}`);

  const rows = data || [];
  const uniqueLeads = new Map();
  for (const message of rows) {
    if (!message.jarvis_lead_id || uniqueLeads.has(message.jarvis_lead_id)) continue;
    uniqueLeads.set(message.jarvis_lead_id, {
      id: message.jarvis_lead_id,
      ...leadNameFields(message.jarvis_leads),
    });
  }
  const enriched = await ensureJarvisInferredNames(
    supabase,
    tenantId,
    [...uniqueLeads.values()]
  );

  return rows.map((message) => {
    const lead =
      enriched.get(message.jarvis_lead_id) || leadNameFields(message.jarvis_leads);
    const formatted = formatJarvisLeadName(lead);
    return {
      leadId: message.jarvis_lead_id,
      leadName: formatted.displayName,
      nameSource: formatted.nameSource,
      nameConfidence: formatted.nameConfidence,
      phone: fullPhone(lead.wa_id || message.jarvis_leads?.wa_id),
      direction: message.direction,
      body: message.body || `[${message.msg_type || "message"}]`,
      timestamp: message.timestamp || message.created_at,
    };
  });
}

function clampHours(hours, fallback = 72) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 24 * 14);
}

function clampLimit(limit, fallback = 15, max = 30) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

function formatAge(timestamp) {
  if (!timestamp) return null;
  const ms = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function bodySnippet(message) {
  const text = String(message?.body || "").trim();
  if (text) return text.slice(0, 140);
  return `[${message?.msg_type || "message"}]`;
}

/**
 * Load recent jarvis WhatsApp rows and reduce to latest-per-thread + counts.
 * Bounded query — no migration/RPC required.
 */
async function loadJarvisInboxWindow(tenantId, hours = 72) {
  const supabase = db();
  const windowHours = clampHours(hours);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select(
      `id, jarvis_lead_id, direction, body, msg_type, timestamp, created_at, jarvis_leads(${JARVIS_LEAD_NAME_SELECT})`
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .gte("timestamp", since)
    .order("timestamp", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Inbox window query failed: ${error.message}`);

  const rows = data || [];
  const latestByLead = new Map();
  let inbound = 0;
  let outbound = 0;

  for (const row of rows) {
    if (row.direction === "inbound") inbound += 1;
    else if (row.direction === "outbound") outbound += 1;

    if (!row.jarvis_lead_id || latestByLead.has(row.jarvis_lead_id)) continue;
    const fields = leadNameFields(row.jarvis_leads);
    latestByLead.set(row.jarvis_lead_id, {
      leadId: row.jarvis_lead_id,
      push_name: fields.push_name,
      inferred_name: fields.inferred_name,
      inferred_name_confidence: fields.inferred_name_confidence,
      inferred_name_at: fields.inferred_name_at,
      wa_id: fields.wa_id,
      phone: fullPhone(fields.wa_id),
      direction: row.direction,
      snippet: bodySnippet(row),
      lastAt: row.timestamp || row.created_at,
      age: formatAge(row.timestamp || row.created_at),
    });
  }

  const threads = [...latestByLead.values()];
  return {
    hours: windowHours,
    since,
    messageCount: rows.length,
    inbound,
    outbound,
    threads,
    unreplied: threads.filter((t) => t.direction === "inbound"),
    staleOutbound: threads.filter((t) => t.direction === "outbound"),
  };
}

/** Threads whose latest message in the window is inbound (needs a reply). */
export async function getJarvisUnrepliedConversations(
  tenantId,
  { hours = 72, limit = 15 } = {}
) {
  const window = await loadJarvisInboxWindow(tenantId, hours);
  const capped = clampLimit(limit);
  const slice = window.unreplied.slice(0, capped);
  const conversations = await enrichConversationSlice(tenantId, slice);
  return {
    hours: window.hours,
    count: window.unreplied.length,
    conversations,
  };
}

/** Distinct threads active in the window, newest first. */
export async function getJarvisInboxActivity(
  tenantId,
  { hours = 72, limit = 15, inboundOnly = false } = {}
) {
  const window = await loadJarvisInboxWindow(tenantId, hours);
  const capped = clampLimit(limit);
  const list = inboundOnly
    ? window.threads.filter((t) => t.direction === "inbound")
    : window.threads;
  const slice = list.slice(0, capped);
  const conversations = await enrichConversationSlice(tenantId, slice);
  return {
    hours: window.hours,
    inboundOnly: Boolean(inboundOnly),
    count: list.length,
    conversations,
  };
}

/**
 * Threads whose latest message is outbound and older than `hours`
 * (you messaged them; they haven't replied since).
 * Always looks back 14 days so threads idle longer than `hours` still surface.
 */
export async function getJarvisStaleConversations(
  tenantId,
  { hours = 72, limit = 15 } = {}
) {
  const staleHours = clampHours(hours);
  const lookbackHours = 24 * 14;
  const window = await loadJarvisInboxWindow(tenantId, lookbackHours);
  const cutoff = Date.now() - staleHours * 60 * 60 * 1000;
  const capped = clampLimit(limit);
  const stale = window.staleOutbound.filter((t) => {
    const ts = new Date(t.lastAt).getTime();
    return Number.isFinite(ts) && ts <= cutoff;
  });
  const conversations = await enrichConversationSlice(
    tenantId,
    stale.slice(0, capped)
  );
  return {
    hours: staleHours,
    lookbackHours,
    count: stale.length,
    conversations,
  };
}

/** Aggregate inbox counts for a time window. */
export async function getJarvisInboxStats(tenantId, { hours = 72 } = {}) {
  const window = await loadJarvisInboxWindow(tenantId, hours);
  return {
    hours: window.hours,
    since: window.since,
    messages: window.messageCount,
    threads: window.threads.length,
    inbound: window.inbound,
    outbound: window.outbound,
    unreplied: window.unreplied.length,
    staleOutbound: window.staleOutbound.length,
  };
}

export async function searchJarvisLeadByName(tenantId, name) {
  const supabase = db();
  const query = cleanJarvisSearchName(name);
  if (!query) return [];

  const terms = jarvisNameSearchTerms(query);
  const orFilter = buildJarvisNameOrFilter(terms);
  if (!orFilter) return [];

  // Phone pasted as the "name" — resolve by wa_id directly.
  const digits = query.replace(/\D/g, "");
  let phoneMatches = [];
  if (digits.length >= 8) {
    const { data: byPhone, error: phoneError } = await supabase
      .from(JARVIS_LEADS_TABLE)
      .select(
        "id, push_name, wa_id, source, owns_property, last_message_at, inferred_name, inferred_name_confidence, inferred_name_at"
      )
      .eq("tenant_id", tenantId)
      .or(`wa_id.eq.${digits},wa_id.like.%${digits.slice(-9)}`)
      .limit(10);
    if (phoneError) throw new Error(`Lead phone search failed: ${phoneError.message}`);
    phoneMatches = byPhone || [];
  }

  const { data: nameLeads, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select(
      "id, push_name, wa_id, source, owns_property, last_message_at, inferred_name, inferred_name_confidence, inferred_name_at"
    )
    .eq("tenant_id", tenantId)
    .or(orFilter)
    .order("last_message_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Lead search failed: ${error.message}`);

  const byId = new Map();
  for (const lead of [...phoneMatches, ...(nameLeads || [])]) {
    if (lead?.id) byId.set(lead.id, lead);
  }
  const leads = [...byId.values()];
  if (!leads.length) return [];

  const term = query;

  const ids = leads.map((lead) => lead.id);
  const [callsResult, messagesResult, enrichedMap] = await Promise.all([
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
    ensureJarvisInferredNames(supabase, tenantId, leads),
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

  const needle = String(term || "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();

  return leads
    .map((lead) => {
      const enriched = enrichedMap.get(lead.id) || lead;
      const formatted = formatJarvisLeadName(enriched);
      const pushFirst = String(enriched.push_name || "")
        .trim()
        .split(/\s+/)[0]
        .toLowerCase();
      // Rank exact push_name matches first so "Shuayb" doesn't lose to noise.
      const exactPush = needle && pushFirst === needle ? 1 : 0;
      return {
        id: lead.id,
        name: formatted.displayName,
        nameSource: formatted.nameSource,
        nameConfidence: formatted.nameConfidence,
        phone: fullPhone(lead.wa_id),
        source: lead.source || null,
        ownsProperty: lead.owns_property || null,
        lastCallOutcome: latestOutcome.get(lead.id) || null,
        lastMessageAt: lead.last_message_at || null,
        messageCount: messageCounts.get(lead.id) || 0,
        exactPush,
      };
    })
    .sort((a, b) => {
      if (b.exactPush !== a.exactPush) return b.exactPush - a.exactPush;
      return (b.messageCount > 0) - (a.messageCount > 0);
    })
    .slice(0, 10);
}

export async function getJarvisLeadStory(tenantId, leadId) {
  const supabase = db();
  const { data: lead, error: leadError } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select(
      "id, push_name, wa_id, source, owns_property, inferred_name, inferred_name_confidence, inferred_name_at"
    )
    .eq("tenant_id", tenantId)
    .eq("id", leadId)
    .maybeSingle();
  if (leadError) throw new Error(`Lead lookup failed: ${leadError.message}`);
  if (!lead) return null;

  const [callsResult, messagesResult, enrichedLead] = await Promise.all([
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
    ensureJarvisInferredName(supabase, tenantId, lead),
  ]);
  if (callsResult.error) throw new Error(`Lead calls query failed: ${callsResult.error.message}`);
  if (messagesResult.error) {
    throw new Error(`Lead messages query failed: ${messagesResult.error.message}`);
  }

  const events = [
    ...(callsResult.data || []).map((call) => {
      const q = qualification(call);
      const relayTask = q.task ? `Task: ${q.task}` : null;
      return {
        type: "call",
        timestamp: callTime(call),
        callId: call.id,
        summary: [call.summary || null, relayTask].filter(Boolean).join(" | ") || null,
        outcome: q.outcome || null,
        crmNote: q.crm_note || q.passback || null,
        recordingUrl: call.recording_url || null,
      };
    }),
    ...(messagesResult.data || []).map((message) => ({
      type: "message",
      timestamp: message.timestamp || message.created_at,
      direction: message.direction,
      body: message.body || null,
    })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const formatted = formatJarvisLeadName(enrichedLead || lead);
  return {
    lead: {
      id: lead.id,
      name: formatted.displayName,
      nameSource: formatted.nameSource,
      nameConfidence: formatted.nameConfidence,
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
      `id, jarvis_lead_id, direction, body, timestamp, created_at, jarvis_leads(${JARVIS_LEAD_NAME_SELECT})`
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .ilike("body", `%${term}%`)
    .order("timestamp", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Conversation search failed: ${error.message}`);

  const rows = messages || [];
  const uniqueLeads = new Map();
  for (const message of rows) {
    if (!message.jarvis_lead_id || uniqueLeads.has(message.jarvis_lead_id)) continue;
    uniqueLeads.set(message.jarvis_lead_id, {
      id: message.jarvis_lead_id,
      ...leadNameFields(message.jarvis_leads),
    });
  }
  const enriched = await ensureJarvisInferredNames(
    supabase,
    tenantId,
    [...uniqueLeads.values()]
  );

  return rows.map((message) => {
    const lead =
      enriched.get(message.jarvis_lead_id) || leadNameFields(message.jarvis_leads);
    const formatted = formatJarvisLeadName(lead);
    return {
      type: "message",
      leadId: message.jarvis_lead_id,
      leadName: formatted.displayName,
      nameSource: formatted.nameSource,
      nameConfidence: formatted.nameConfidence,
      phone: fullPhone(lead.wa_id || message.jarvis_leads?.wa_id),
      direction: message.direction,
      timestamp: message.timestamp || message.created_at,
      snippet: snippet(message.body, term),
    };
  });
}

export async function getJarvisCallDetail(tenantId, { leadId, callId } = {}) {
  const supabase = db();
  let query = supabase
    .from("calls")
    .select(
      `id, jarvis_lead_id, started_at, ended_at, created_at, duration_seconds, transcript, recording_url, qualification, summary, jarvis_leads(${JARVIS_LEAD_NAME_SELECT})`
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

  const leadFields = {
    id: data.jarvis_lead_id,
    ...leadNameFields(data.jarvis_leads),
  };
  const enriched = await ensureJarvisInferredName(supabase, tenantId, leadFields);
  const formatted = formatJarvisLeadName(enriched || leadFields);
  const q = qualification(data);
  return {
    callId: data.id,
    leadId: data.jarvis_lead_id,
    leadName: formatted.displayName,
    nameSource: formatted.nameSource,
    nameConfidence: formatted.nameConfidence,
    phone: fullPhone(enriched?.wa_id || data.jarvis_leads?.wa_id),
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
      `id, jarvis_lead_id, created_at, qualification, jarvis_leads(${JARVIS_LEAD_NAME_SELECT})`
    )
    .eq("tenant_id", tenantId)
    .not("jarvis_lead_id", "is", null)
    .eq("qualification->>outcome", "callback")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Callbacks query failed: ${error.message}`);

  const seen = new Set();
  const pending = [];
  for (const call of data || []) {
    if (!call.jarvis_lead_id || seen.has(call.jarvis_lead_id)) continue;
    seen.add(call.jarvis_lead_id);
    const q = qualification(call);
    pending.push({
      leadId: call.jarvis_lead_id,
      ...leadNameFields(call.jarvis_leads),
      phone: fullPhone(call.jarvis_leads?.wa_id),
      callbackTime: q.callback_time || null,
      calledAt: call.created_at,
    });
  }

  const enriched = await ensureJarvisInferredNames(
    supabase,
    tenantId,
    pending.map((row) => ({
      id: row.leadId,
      push_name: row.push_name,
      inferred_name: row.inferred_name,
      inferred_name_confidence: row.inferred_name_confidence,
      inferred_name_at: row.inferred_name_at,
      wa_id: row.wa_id,
    }))
  );

  return pending.map((row) => {
    const lead = enriched.get(row.leadId) || row;
    const formatted = formatJarvisLeadName(lead);
    return {
      leadId: row.leadId,
      leadName: formatted.displayName,
      nameSource: formatted.nameSource,
      nameConfidence: formatted.nameConfidence,
      phone: row.phone,
      callbackTime: row.callbackTime,
      calledAt: row.calledAt,
    };
  });
}

/**
 * Persist an authoritative contact name (user-confirmed).
 * Writes push_name only — never invents; Vapi dials use this field.
 */
export async function setJarvisLeadName(tenantId, { leadId, phone, name } = {}) {
  const supabase = db();
  const cleanedName = String(name || "")
    .trim()
    .split(/\s+/)[0];
  if (!cleanedName || cleanedName.length < 2) {
    throw new Error("A valid first name is required");
  }
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(cleanedName)) {
    throw new Error("Name must be letters only (first name)");
  }
  const normalized =
    cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1);

  let query = supabase
    .from(JARVIS_LEADS_TABLE)
    .select(
      "id, push_name, wa_id, inferred_name, inferred_name_confidence, inferred_name_at"
    )
    .eq("tenant_id", tenantId);

  if (leadId) {
    query = query.eq("id", leadId);
  } else {
    const digits = normalizeWaId(phone);
    if (!digits) throw new Error("leadId or phone is required");
    query = query.eq("wa_id", digits);
  }

  const { data: lead, error: lookupError } = await query.maybeSingle();
  if (lookupError) throw new Error(`Lead lookup failed: ${lookupError.message}`);
  if (!lead) throw new Error("Lead not found");

  const { data: updated, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .update({ push_name: normalized })
    .eq("id", lead.id)
    .select(
      "id, push_name, wa_id, inferred_name, inferred_name_confidence, inferred_name_at"
    )
    .single();
  if (error) throw new Error(`Failed to set lead name: ${error.message}`);

  const formatted = formatJarvisLeadName(updated);
  return {
    ok: true,
    leadId: updated.id,
    name: formatted.displayName,
    nameSource: formatted.nameSource,
    nameConfidence: formatted.nameConfidence,
    phone: fullPhone(updated.wa_id),
    previousPushName: lead.push_name || null,
  };
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
    const pointer = await scriptPointerForSource(supabase, tenantId, "jarvis-target-call", {
      jarvisLead: true,
    });
    const { error: queueError } = await supabase.from("call_queue").insert({
      tenant_id: tenantId,
      lead_id: null,
      jarvis_lead_id: lead.id,
      scheduled_for: scheduledFor,
      processed: false,
      source: "jarvis-target-call",
      requested_by: requestedBy || null,
      script_id: pointer.script_id,
      script_version_id: pointer.script_version_id,
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
