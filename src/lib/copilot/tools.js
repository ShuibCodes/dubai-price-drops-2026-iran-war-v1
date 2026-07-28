import { getSupabaseServerClient, MESSAGES_TABLE } from "../supabase/server.js";
import { isWithinBusinessHours, nextWindowStart } from "../calls/business-hours.js";
import { getLeadTimezone } from "../leads/phone-timezone.js";
import {
  DAILY_BATCH_CAP,
  assertOutboundActive,
  buildScheduledTimes,
  dialLeadNow,
  getOutboundTenant,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
  queueLeadCalls,
} from "../calls/outbound.js";

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

function fullPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function qualification(call) {
  return call?.qualification && typeof call.qualification === "object"
    ? call.qualification
    : {};
}

function callTime(call) {
  return call.ended_at || call.started_at || call.created_at;
}

function callStartedAt(call) {
  return call.started_at || call.created_at || call.ended_at;
}

function dubaiDayBounds(date = new Date()) {
  const dubai = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  const start = new Date(
    Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate()) -
      4 * 60 * 60 * 1000
  );
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function summarizeCalls(rows = []) {
  return rows.reduce(
    (totals, call) => {
      const q = qualification(call);
      totals.dialed += 1;
      if (
        call.status === "completed" &&
        !["no_answer", "voicemail"].includes(q.outcome)
      ) {
        totals.answered += 1;
      }
      if (q.lead_engaged === true) totals.engaged += 1;
      if (q.outcome === "qualified") totals.qualified += 1;
      if (q.outcome === "callback") totals.callbacks += 1;
      if (call.results_synced === true) totals.resultsSyncedToCrm += 1;
      return totals;
    },
    { dialed: 0, answered: 0, engaged: 0, qualified: 0, callbacks: 0, resultsSyncedToCrm: 0 }
  );
}

async function insertAudit(supabase, tenantId, action, params, requestedBy, result) {
  const { error } = await supabase.from("copilot_actions").insert({
    tenant_id: tenantId,
    action,
    params,
    requested_by: requestedBy || null,
    result,
  });
  if (error) throw new Error(`Copilot audit insert failed: ${error.message}`);
}

async function auditedWrite(tenantId, action, params, requestedBy, operation) {
  const supabase = db();
  try {
    const result = await operation(supabase);
    await insertAudit(supabase, tenantId, action, params, requestedBy, {
      ok: true,
      ...result,
    });
    return result;
  } catch (error) {
    await insertAudit(supabase, tenantId, action, params, requestedBy, {
      ok: false,
      error: error.message,
    });
    throw error;
  }
}

export async function countCallsSince(tenantId, sinceIso) {
  const supabase = db();
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) throw new Error("Invalid sinceIso");

  const { data, error } = await supabase
    .from("calls")
    .select("status, qualification, results_synced")
    .eq("tenant_id", tenantId)
    .gte("created_at", since.toISOString());
  if (error) throw new Error(`Calls query failed: ${error.message}`);
  return summarizeCalls(data);
}

export async function todaysDigest(tenantId) {
  const supabase = db();
  const { start, end } = dubaiDayBounds();
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id, status, started_at, ended_at, created_at, recording_url, summary, qualification, results_synced, leads(push_name)"
    )
    .eq("tenant_id", tenantId)
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Daily calls query failed: ${error.message}`);

  const engaged = (data || [])
    .filter((call) => qualification(call).lead_engaged === true)
    .slice(0, 5)
    .map((call) => {
      const q = qualification(call);
      return {
        leadName: call.leads?.push_name || null,
        outcome: q.outcome || null,
        budget: q.budget_aed || null,
        crmNote: q.crm_note || null,
        recordingUrl: call.recording_url || null,
      };
    });

  return { ...summarizeCalls(data), topCalls: engaged };
}

function validateOptionalIso(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}`);
  return date.toISOString();
}

function truncateCrmNote(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}

function distressedDealsInterest(q) {
  for (const key of [
    "wants_distressed_deals",
    "wantsDistressedDeals",
    "distressed_deals_interest",
  ]) {
    if (Object.prototype.hasOwnProperty.call(q, key)) return q[key];
  }
  return undefined;
}

export async function listLeads(
  tenantId,
  {
    sinceIso,
    untilIso,
    engagedOnly = false,
    qualifiedOnly = false,
    outcome,
    limit = 5,
    offset = 0,
  } = {}
) {
  const supabase = db();
  const since = validateOptionalIso(sinceIso, "sinceIso");
  const until = validateOptionalIso(untilIso, "untilIso");
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 5));
  const pageOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  const normalizedOutcome = String(outcome || "").trim().toLowerCase();

  let query = supabase
    .from("calls")
    .select(
      "id, lead_id, started_at, ended_at, created_at, recording_url, qualification, leads(push_name, wa_id, source)",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId);

  if (since) query = query.gte("created_at", since);
  if (until) query = query.lt("created_at", until);
  if (engagedOnly) query = query.eq("qualification->>lead_engaged", "true");
  if (qualifiedOnly) query = query.eq("qualification->>outcome", "qualified");
  if (normalizedOutcome) {
    query = query.eq("qualification->>outcome", normalizedOutcome);
  }

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(pageOffset, pageOffset + pageSize - 1);
  if (error) throw new Error(`Lead list query failed: ${error.message}`);

  const leads = (data || []).map((call) => {
    const q = qualification(call);
    const item = {
      leadName: call.leads?.push_name || null,
      phone: fullPhone(call.leads?.wa_id),
      source: call.leads?.source || null,
      calledAt: callStartedAt(call),
      outcome: q.outcome || null,
      intent: q.intent || null,
      budget: q.budget_aed || null,
      areas: Array.isArray(q.areas) ? q.areas : q.areas ? [q.areas] : [],
      timeline: q.timeline || null,
      callbackTime: q.callback_time || null,
      crmNote: truncateCrmNote(q.crm_note),
      recordingUrl: call.recording_url || null,
    };
    const wantsDistressedDeals = distressedDealsInterest(q);
    if (wantsDistressedDeals !== undefined) {
      item.wantsDistressedDeals = wantsDistressedDeals;
    }
    return item;
  });

  return { total: count || 0, showing: leads.length, leads };
}

// Roster tool: queries the leads table directly (who is on my list), as
// opposed to listLeads/todaysDigest which report call ACTIVITY. Keeping the
// two separate is what lets "how many leads do I have?" work for tenants
// that have imported lists but few calls.
export async function queryLeads(
  tenantId,
  { source, country, uncalledOnly = false, limit = 5, offset = 0 } = {}
) {
  const supabase = db();
  const countryCode = normalizeCountryCode(country);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 5));
  const pageOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  const sourceTerm = String(source || "").trim();

  const applyFilters = (query) => {
    let q = query.eq("tenant_id", tenantId);
    if (sourceTerm) q = q.ilike("source", `%${sourceTerm}%`);
    if (countryCode) q = q.eq("country_code", countryCode);
    return q;
  };

  const { count: total, error: countError } = await applyFilters(
    supabase.from("leads").select("id", { count: "exact", head: true })
  );
  if (countError) throw new Error(`Lead count failed: ${countError.message}`);

  const annotateCalled = async (rows) => {
    const ids = rows.map((lead) => lead.id);
    if (!ids.length) return new Set();
    const calledRows = await fetchInChunks(ids, (chunk) =>
      supabase.from("calls").select("lead_id").eq("tenant_id", tenantId).in("lead_id", chunk)
    );
    const queuedRows = await fetchInChunks(ids, (chunk) =>
      supabase
        .from("call_queue")
        .select("lead_id")
        .eq("tenant_id", tenantId)
        .eq("processed", false)
        .in("lead_id", chunk)
    );
    return new Set([
      ...calledRows.map((row) => row.lead_id),
      ...queuedRows.map((row) => row.lead_id),
    ]);
  };

  const toLead = (lead, calledIds) => ({
    id: lead.id,
    name: lead.push_name || null,
    phone: fullPhone(lead.wa_id),
    source: lead.source || null,
    countryCode: lead.country_code || null,
    calledOrQueued: calledIds.has(lead.id),
  });

  const leads = [];
  // When uncalledOnly, keep paging past called/queued leads until the page is
  // full (early rows are often exactly the ones already batched).
  const SCAN_PAGE = uncalledOnly ? Math.max(pageSize, 100) : pageSize;
  const MAX_SCANNED = 1000;
  let cursor = pageOffset;
  let scanned = 0;
  while (leads.length < pageSize && scanned < MAX_SCANNED) {
    const { data: rows, error } = await applyFilters(
      supabase
        .from("leads")
        .select("id, push_name, wa_id, source, country_code, first_seen")
    )
      .order("first_seen", { ascending: true })
      .range(cursor, cursor + SCAN_PAGE - 1);
    if (error) throw new Error(`Lead query failed: ${error.message}`);
    if (!rows?.length) break;
    const calledIds = await annotateCalled(rows);
    for (const row of rows) {
      const lead = toLead(row, calledIds);
      if (uncalledOnly && lead.calledOrQueued) continue;
      leads.push(lead);
      if (leads.length >= pageSize) break;
    }
    cursor += rows.length;
    scanned += rows.length;
    if (rows.length < SCAN_PAGE) break;
    if (!uncalledOnly) break;
  }

  return {
    total: total || 0,
    showing: leads.length,
    uncalledOnly: Boolean(uncalledOnly),
    leads,
  };
}

// Distinct campaign sources for this tenant with exact counts, so the model
// knows which list names exist before filtering or batching by source.
// Discovers distinct names by scanning ordered pages, then runs an exact
// count per source, so counts stay right even for large rosters.
export async function listLeadSources(tenantId) {
  const supabase = db();
  const names = new Set();
  const MAX_SOURCES = 100;

  const { count: nullCount, error: nullError } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("source", null);
  if (nullError) throw new Error(`Lead sources query failed: ${nullError.message}`);
  if (nullCount > 0) names.add(null);

  // Walk distinct source values: one query per value via source > lastSeen.
  let lastSeen = null;
  while (names.size < MAX_SOURCES) {
    let query = supabase
      .from("leads")
      .select("source")
      .eq("tenant_id", tenantId)
      .not("source", "is", null)
      .order("source", { ascending: true })
      .limit(1);
    if (lastSeen !== null) query = query.gt("source", lastSeen);
    const { data, error } = await query;
    if (error) throw new Error(`Lead sources query failed: ${error.message}`);
    const next = data?.[0]?.source;
    if (next === undefined || next === null) break;
    names.add(next);
    lastSeen = next;
  }

  const sources = [];
  for (const name of names) {
    let query = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    query = name === null ? query.is("source", null) : query.eq("source", name);
    const { count, error } = await query;
    if (error) throw new Error(`Source count failed: ${error.message}`);
    sources.push({ source: name || "(no source)", count: count || 0 });
  }
  sources.sort((a, b) => b.count - a.count);
  return { sources };
}

export async function getCallDetail(tenantId, { leadId, callId } = {}) {
  const supabase = db();
  if (!leadId && !callId) throw new Error("leadId or callId is required");

  let query = supabase
    .from("calls")
    .select(
      "id, lead_id, started_at, ended_at, created_at, duration_seconds, transcript, recording_url, qualification, leads(push_name)"
    )
    .eq("tenant_id", tenantId);

  if (callId) {
    query = query.eq("id", callId);
  } else {
    query = query
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Call detail query failed: ${error.message}`);
  if (!data) return null;

  return {
    leadName: data.leads?.push_name || null,
    calledAt: callStartedAt(data),
    durationSeconds: data.duration_seconds ?? null,
    outcome: qualification(data).outcome || null,
    transcript: data.transcript || null,
    recordingUrl: data.recording_url || null,
  };
}

export async function searchLeadByName(tenantId, name) {
  const supabase = db();
  const query = String(name || "").trim();
  if (!query) return [];

  // Match names and campaign sources so "downtown leads" style queries work.
  const term = query.replace(/[%_,()]/g, " ").trim();
  const { data: leads, error } = await supabase
    .from("leads")
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
      .select("lead_id, qualification, created_at")
      .eq("tenant_id", tenantId)
      .in("lead_id", ids)
      .order("created_at", { ascending: false }),
    supabase
      .from(MESSAGES_TABLE)
      .select("lead_id")
      .eq("tenant_id", tenantId)
      .in("lead_id", ids),
  ]);
  if (callsResult.error) {
    throw new Error(`Lead calls query failed: ${callsResult.error.message}`);
  }
  if (messagesResult.error) {
    throw new Error(`Lead messages query failed: ${messagesResult.error.message}`);
  }

  const latestOutcome = new Map();
  for (const call of callsResult.data || []) {
    if (!latestOutcome.has(call.lead_id)) {
      latestOutcome.set(call.lead_id, qualification(call).outcome || null);
    }
  }

  const messageCounts = new Map();
  for (const message of messagesResult.data || []) {
    messageCounts.set(message.lead_id, (messageCounts.get(message.lead_id) || 0) + 1);
  }

  // Contacts with real conversations first — imported leads with no
  // activity share the same import timestamp and would crowd them out.
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

// includeMessages=false keeps WhatsApp chat content out of the result —
// the client-facing Copilot must only see call activity, never the owner's
// WhatsApp threads. Jarvis passes true.
export async function getLeadStory(tenantId, leadId, { includeMessages = true } = {}) {
  const supabase = db();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
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
      .eq("lead_id", leadId),
    includeMessages
      ? supabase
          .from(MESSAGES_TABLE)
          .select("id, direction, body, msg_type, timestamp, created_at")
          .eq("tenant_id", tenantId)
          .eq("lead_id", leadId)
      : Promise.resolve({ data: [], error: null }),
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
      messageType: message.msg_type || null,
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

export async function getPendingCallbacks(tenantId) {
  const supabase = db();
  const { data, error } = await supabase
    .from("calls")
    .select("lead_id, qualification, created_at, leads(id, push_name, wa_id)")
    .eq("tenant_id", tenantId)
    .not("lead_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Callbacks query failed: ${error.message}`);

  const latestByLead = new Map();
  for (const call of data || []) {
    if (!latestByLead.has(call.lead_id)) latestByLead.set(call.lead_id, call);
  }

  return [...latestByLead.values()]
    .filter((call) => {
      const q = qualification(call);
      return q.outcome === "callback" && q.callback_time;
    })
    .map((call) => ({
      leadId: call.lead_id,
      leadName: call.leads?.push_name || null,
      phone: fullPhone(call.leads?.wa_id),
      callbackTime: qualification(call).callback_time,
      crmNote: qualification(call).crm_note || null,
    }))
    .sort((a, b) => new Date(a.callbackTime) - new Date(b.callbackTime));
}

function snippet(text, query) {
  const value = String(text || "");
  const lower = value.toLowerCase();
  const at = lower.indexOf(String(query || "").toLowerCase());
  const start = Math.max(0, at < 0 ? 0 : at - 80);
  return value.slice(start, start + 220);
}

// includeMessages=false restricts the search to call transcripts — the
// client-facing Copilot must not read WhatsApp message bodies. Jarvis passes true.
export async function searchConversations(tenantId, query, { includeMessages = true } = {}) {
  const supabase = db();
  const term = String(query || "").trim();
  if (!term) return [];

  const [messagesResult, callsResult] = await Promise.all([
    includeMessages
      ? supabase
          .from(MESSAGES_TABLE)
          .select("id, lead_id, body, direction, timestamp, created_at, leads(push_name)")
          .eq("tenant_id", tenantId)
          .ilike("body", `%${term}%`)
          .order("timestamp", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("calls")
      .select("id, lead_id, transcript, started_at, created_at, leads(push_name)")
      .eq("tenant_id", tenantId)
      .ilike("transcript", `%${term}%`)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  if (messagesResult.error) {
    throw new Error(`Message search failed: ${messagesResult.error.message}`);
  }
  if (callsResult.error) throw new Error(`Transcript search failed: ${callsResult.error.message}`);

  return [
    ...(messagesResult.data || []).map((message) => ({
      type: "message",
      id: message.id,
      leadId: message.lead_id,
      leadName: message.leads?.push_name || null,
      direction: message.direction,
      timestamp: message.timestamp || message.created_at,
      snippet: snippet(message.body, term),
    })),
    ...(callsResult.data || []).map((call) => ({
      type: "call",
      id: call.id,
      leadId: call.lead_id,
      leadName: call.leads?.push_name || null,
      timestamp: call.started_at || call.created_at,
      snippet: snippet(call.transcript, term),
    })),
  ]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);
}

export async function getLatestMessages(tenantId, limit = 10) {
  const supabase = db();
  const capped = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const { data, error } = await supabase
    .from(MESSAGES_TABLE)
    .select("id, lead_id, direction, body, msg_type, timestamp, created_at, leads(push_name, wa_id)")
    .eq("tenant_id", tenantId)
    .order("timestamp", { ascending: false })
    .limit(capped);
  if (error) throw new Error(`Latest messages query failed: ${error.message}`);

  return (data || []).map((message) => ({
    leadId: message.lead_id,
    leadName: message.leads?.push_name || null,
    phone: fullPhone(message.leads?.wa_id),
    direction: message.direction,
    body: message.body || `[${message.msg_type || "message"}]`,
    timestamp: message.timestamp || message.created_at,
  }));
}

async function batchUsageForDay(supabase, tenantId, date) {
  const { start, end } = dubaiDayBounds(date);
  const [callsResult, queueResult] = await Promise.all([
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("source", "pixxi-batch")
      .gte("created_at", start)
      .lt("created_at", end),
    supabase
      .from("call_queue")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("source", ["copilot-cold-batch", "copilot-scheduled-batch"])
      .gte("scheduled_for", start)
      .lt("scheduled_for", end),
  ]);
  if (callsResult.error) throw new Error(`Daily cap call query failed: ${callsResult.error.message}`);
  if (queueResult.error) throw new Error(`Daily cap queue query failed: ${queueResult.error.message}`);
  return (callsResult.count || 0) + (queueResult.count || 0);
}

// PostgREST encodes .in() filters into the URL; too many UUIDs at once
// overflows Node's header size limit ("fetch failed").
const IN_FILTER_CHUNK = 100;

async function fetchInChunks(ids, runQuery) {
  const rows = [];
  for (let i = 0; i < ids.length; i += IN_FILTER_CHUNK) {
    const { data, error } = await runQuery(ids.slice(i, i + IN_FILTER_CHUNK));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

// Common ways Naheem may name a market, mapped to the E.164 dialing code
// stored in leads.country_code. Bare dialing codes ("971") pass through.
const COUNTRY_ALIASES = {
  uae: "971",
  emirates: "971",
  dubai: "971",
  ksa: "966",
  saudi: "966",
  saudiarabia: "966",
  uk: "44",
  unitedkingdom: "44",
  britain: "44",
  usa: "1",
  us: "1",
  unitedstates: "1",
  canada: "1",
  india: "91",
  pakistan: "92",
  egypt: "20",
  turkey: "90",
  qatar: "974",
  kuwait: "965",
  bahrain: "973",
  oman: "968",
  russia: "7",
  china: "86",
  germany: "49",
  france: "33",
  israel: "972",
};

export function normalizeCountryCode(country) {
  const raw = String(country || "").trim().toLowerCase();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits && digits === raw.replace(/^\+/, "")) return digits;
  const alias = COUNTRY_ALIASES[raw.replace(/[^a-z]/g, "")];
  if (!alias) {
    throw new Error(
      `Unknown country "${country}". Use a dialing code like 971 (UAE) or a known name (UAE, Saudi, UK...).`
    );
  }
  return alias;
}

async function queryColdCandidates(supabase, tenantId, count, countryCode, applySource) {
  let candidateQuery = supabase
    .from("leads")
    .select("id, push_name, wa_id, source, owns_property, pixxi_lead_id")
    .eq("tenant_id", tenantId);
  candidateQuery = applySource(candidateQuery);
  if (countryCode) candidateQuery = candidateQuery.eq("country_code", countryCode);
  return candidateQuery
    .order("first_seen", { ascending: true })
    .limit(Math.max(count * 3, 100));
}

async function selectUncalledPurchasedLeads(
  supabase,
  tenantId,
  count,
  countryCode,
  sourceFilter
) {
  const requestedSource = String(sourceFilter || "").trim();
  let candidates;
  let error;

  if (requestedSource) {
    ({ data: candidates, error } = await queryColdCandidates(
      supabase,
      tenantId,
      count,
      countryCode,
      (q) => q.ilike("source", `%${requestedSource}%`)
    ));
  } else {
    // Default cold list is the 1416-style "Purchased list". Tenants imported
    // with named campaign sources (downtown_views, burj_lake_owner, ...) have
    // no such rows, so fall back to any lead that has a source at all —
    // organic WhatsApp contacts (source null) are never cold-called.
    ({ data: candidates, error } = await queryColdCandidates(
      supabase,
      tenantId,
      count,
      countryCode,
      (q) => q.ilike("source", "Purchased list")
    ));
    if (!error && !candidates?.length) {
      ({ data: candidates, error } = await queryColdCandidates(
        supabase,
        tenantId,
        count,
        countryCode,
        (q) => q.not("source", "is", null)
      ));
    }
  }

  if (error) throw new Error(`Cold lead query failed: ${error.message}`);
  if (!candidates?.length) return [];

  const ids = candidates.map((lead) => lead.id);
  let calledRows;
  let queuedRows;
  try {
    calledRows = await fetchInChunks(ids, (chunk) =>
      supabase.from("calls").select("lead_id").eq("tenant_id", tenantId).in("lead_id", chunk)
    );
  } catch (error) {
    throw new Error(`Called lead query failed: ${error.message}`);
  }
  try {
    queuedRows = await fetchInChunks(ids, (chunk) =>
      supabase
        .from("call_queue")
        .select("lead_id")
        .eq("tenant_id", tenantId)
        .eq("processed", false)
        .in("lead_id", chunk)
    );
  } catch (error) {
    throw new Error(`Queued lead query failed: ${error.message}`);
  }

  const unavailable = new Set([
    ...calledRows.map((row) => row.lead_id),
    ...queuedRows.map((row) => row.lead_id),
  ]);
  return candidates.filter((lead) => !unavailable.has(lead.id)).slice(0, count);
}

function validateCount(count) {
  const value = Number(count);
  if (!Number.isInteger(value) || value < 1) throw new Error("Count must be a positive integer");
  return value;
}

// Batch tools return the actual people they queued so "list them here" never
// needs a second (calls-table) lookup. Capped to keep tool payloads small.
const QUEUED_LEADS_PREVIEW_CAP = 25;

function summarizeQueuedLeads(leads = []) {
  return {
    total: leads.length,
    preview: leads.slice(0, QUEUED_LEADS_PREVIEW_CAP).map((lead) => ({
      name: lead.push_name || null,
      phone: fullPhone(lead.wa_id),
      source: lead.source || null,
    })),
  };
}

function dubaiDayKey(date) {
  const shifted = new Date(new Date(date).getTime() + 4 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function assertDailyCaps(supabase, tenantId, schedule) {
  const perDay = new Map();
  for (const scheduledFor of schedule) {
    const key = dubaiDayKey(scheduledFor);
    const entry = perDay.get(key) || { date: scheduledFor, count: 0 };
    entry.count += 1;
    perDay.set(key, entry);
  }

  let capRemaining = DAILY_BATCH_CAP;
  for (const [day, planned] of perDay) {
    const used = await batchUsageForDay(supabase, tenantId, new Date(planned.date));
    const remaining = Math.max(0, DAILY_BATCH_CAP - used);
    if (planned.count > remaining) {
      throw new Error(
        `Daily batch cap exceeded for ${day}: ${remaining} calls remaining`
      );
    }
    capRemaining = Math.min(capRemaining, remaining - planned.count);
  }
  return capRemaining;
}

async function assertCapAndSelect(supabase, tenantId, count, startAt, countryCode, sourceFilter) {
  const requested = validateCount(count);
  const schedule = buildScheduledTimes(requested, startAt);
  const capRemaining = await assertDailyCaps(supabase, tenantId, schedule);
  const leads = await selectUncalledPurchasedLeads(
    supabase,
    tenantId,
    requested,
    countryCode,
    sourceFilter
  );
  return { leads, capRemaining };
}

export async function startColdBatch(tenantId, count, requestedBy, country, sourceFilter) {
  const countryCode = normalizeCountryCode(country);
  return auditedWrite(
    tenantId,
    "start_cold_batch",
    { count, country: countryCode, source: sourceFilter || null },
    requestedBy,
    async (supabase) => {
      const tenant = await getOutboundTenant(supabase, tenantId);
      assertOutboundActive(tenant);
      const withinHours = isWithinBusinessHours();
      const startAt = withinHours ? new Date() : nextWindowStart();
      const { leads, capRemaining } = await assertCapAndSelect(
        supabase,
        tenantId,
        count,
        startAt,
        countryCode,
        sourceFilter
      );
      const queued = await queueLeadCalls({
        supabase,
        tenantId,
        leadIds: leads.map((lead) => lead.id),
        startAt,
        source: "copilot-cold-batch",
        requestedBy,
      });
      const byTimezone = {};
      for (const lead of leads) {
        const timezone = getLeadTimezone(`+${lead.wa_id}`);
        byTimezone[timezone] = (byTimezone[timezone] || 0) + 1;
      }
      return {
        started: withinHours ? queued.length : 0,
        scheduled: withinHours ? 0 : queued.length,
        capRemaining: capRemaining + (Number(count) - queued.length),
        country: countryCode,
        byTimezone,
        queuedLeads: summarizeQueuedLeads(leads),
      };
    }
  );
}

export async function startTargetCall(tenantId, leadId, requestedBy) {
  return auditedWrite(
    tenantId,
    "start_target_call",
    { leadId },
    requestedBy,
    async (supabase) => {
      const tenant = await getOutboundTenant(supabase, tenantId);
      assertOutboundActive(tenant);
      const { data: lead, error } = await supabase
        .from("leads")
        .select("id, push_name, wa_id, source, owns_property, pixxi_lead_id")
        .eq("tenant_id", tenantId)
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw new Error(`Lead lookup failed: ${error.message}`);
      if (!lead) throw new Error("Lead not found");

      const leadPhone = lead.wa_id ? `+${lead.wa_id}` : null;
      if (leadPhone && !isLeadWithinBusinessHours(leadPhone)) {
        const queued = await queueLeadCalls({
          supabase,
          tenantId,
          leadIds: [lead.id],
          startAt: nextLeadWindowStart(leadPhone),
          source: "copilot-target-call",
          requestedBy,
        });
        return { ok: true, queued: queued[0]?.scheduled_for || true };
      }

      const result = await dialLeadNow({
        supabase,
        tenant,
        lead,
        source: "copilot-target-call",
      });
      return { ok: true, callId: result.callId };
    }
  );
}

const MAX_SPREAD_DAYS = 14;

function splitAcrossDays(total, days) {
  const base = Math.floor(total / days);
  const remainder = total % days;
  return Array.from({ length: days }, (_, index) =>
    base + (index < remainder ? 1 : 0)
  );
}

export async function scheduleBatch(
  tenantId,
  count,
  whenIso,
  requestedBy,
  spreadDays,
  country,
  sourceFilter
) {
  const countryCode = normalizeCountryCode(country);
  return auditedWrite(
    tenantId,
    "schedule_batch",
    { count, whenIso, spreadDays, country: countryCode, source: sourceFilter || null },
    requestedBy,
    async (supabase) => {
      const tenant = await getOutboundTenant(supabase, tenantId);
      assertOutboundActive(tenant);
      const when = new Date(whenIso);
      if (Number.isNaN(when.getTime())) throw new Error("Invalid whenIso");
      const requested = validateCount(count);
      const days = spreadDays == null ? 1 : Number(spreadDays);
      if (!Number.isInteger(days) || days < 1 || days > MAX_SPREAD_DAYS) {
        throw new Error(`spreadDays must be an integer between 1 and ${MAX_SPREAD_DAYS}`);
      }

      // Same start time each consecutive day; buildScheduledTimes rolls any
      // out-of-window start into the next business window.
      const schedule = [];
      const perDay = [];
      const chunks = splitAcrossDays(requested, days);
      for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
        const chunk = chunks[dayIndex];
        if (!chunk) continue;
        const dayStart = new Date(when.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        const times = buildScheduledTimes(chunk, dayStart);
        schedule.push(...times);
        perDay.push({ firstScheduledFor: times[0], count: chunk });
      }

      const capRemaining = await assertDailyCaps(supabase, tenantId, schedule);
      const leads = await selectUncalledPurchasedLeads(
        supabase,
        tenantId,
        requested,
        countryCode,
        sourceFilter
      );
      const queued = await queueLeadCalls({
        supabase,
        tenantId,
        leadIds: leads.map((lead) => lead.id),
        scheduledTimes: schedule,
        source: "copilot-scheduled-batch",
        requestedBy,
      });
      return {
        scheduled: queued.length,
        spreadDays: days,
        perDay,
        firstScheduledFor: queued[0]?.scheduled_for || null,
        capRemaining: capRemaining + (requested - queued.length),
        country: countryCode,
        queuedLeads: summarizeQueuedLeads(leads),
      };
    }
  );
}

export async function pauseTenant(tenantId, requestedBy) {
  return auditedWrite(tenantId, "pause_tenant", {}, requestedBy, async (supabase) => {
    const { error } = await supabase
      .from("tenants")
      .update({ outbound_paused: true })
      .eq("id", tenantId);
    if (error) throw new Error(`Tenant pause failed: ${error.message}`);
    return { paused: true };
  });
}

export async function resumeTenant(tenantId, requestedBy) {
  return auditedWrite(tenantId, "resume_tenant", {}, requestedBy, async (supabase) => {
    const { error } = await supabase
      .from("tenants")
      .update({ outbound_paused: false })
      .eq("id", tenantId);
    if (error) throw new Error(`Tenant resume failed: ${error.message}`);
    return { paused: false };
  });
}
