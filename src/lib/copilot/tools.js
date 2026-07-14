import { getSupabaseServerClient } from "../supabase/server.js";
import { isWithinBusinessHours, nextWindowStart } from "../calls/business-hours.js";
import {
  DAILY_BATCH_CAP,
  assertOutboundActive,
  buildScheduledTimes,
  dialLeadNow,
  getOutboundTenant,
  queueLeadCalls,
} from "../calls/outbound.js";

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");
  return supabase;
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `••••${digits.slice(-4)}` : null;
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
      if (call.results_synced === true) totals.notesToPixxi += 1;
      return totals;
    },
    { dialed: 0, answered: 0, engaged: 0, qualified: 0, callbacks: 0, notesToPixxi: 0 }
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
      phoneMasked: maskPhone(call.leads?.wa_id),
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

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, push_name, wa_id, source, owns_property, last_message_at")
    .eq("tenant_id", tenantId)
    .ilike("push_name", `%${query}%`)
    .order("last_message_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(`Lead search failed: ${error.message}`);
  if (!leads?.length) return [];

  const { data: calls, error: callsError } = await supabase
    .from("calls")
    .select("lead_id, qualification, created_at")
    .eq("tenant_id", tenantId)
    .in(
      "lead_id",
      leads.map((lead) => lead.id)
    )
    .order("created_at", { ascending: false });
  if (callsError) throw new Error(`Lead calls query failed: ${callsError.message}`);

  const latestOutcome = new Map();
  for (const call of calls || []) {
    if (!latestOutcome.has(call.lead_id)) {
      latestOutcome.set(call.lead_id, qualification(call).outcome || null);
    }
  }

  return leads.map((lead) => ({
    id: lead.id,
    name: lead.push_name || null,
    phone: maskPhone(lead.wa_id),
    source: lead.source || null,
    ownsProperty: lead.owns_property || null,
    lastCallOutcome: latestOutcome.get(lead.id) || null,
    lastMessageAt: lead.last_message_at || null,
  }));
}

export async function getLeadStory(tenantId, leadId) {
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
    supabase
      .from("messages")
      .select("id, direction, body, msg_type, timestamp, created_at")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId),
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
      phone: maskPhone(lead.wa_id),
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
      phone: maskPhone(call.leads?.wa_id),
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

export async function searchConversations(tenantId, query) {
  const supabase = db();
  const term = String(query || "").trim();
  if (!term) return [];

  const [messagesResult, callsResult] = await Promise.all([
    supabase
      .from("messages")
      .select("id, lead_id, body, direction, timestamp, created_at, leads(push_name)")
      .eq("tenant_id", tenantId)
      .ilike("body", `%${term}%`)
      .order("timestamp", { ascending: false })
      .limit(10),
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

async function selectUncalledPurchasedLeads(supabase, tenantId, count) {
  const { data: candidates, error } = await supabase
    .from("leads")
    .select("id, push_name, wa_id, source, owns_property, pixxi_lead_id")
    .eq("tenant_id", tenantId)
    .ilike("source", "Purchased list")
    .order("first_seen", { ascending: true })
    .limit(Math.max(count * 3, 100));
  if (error) throw new Error(`Cold lead query failed: ${error.message}`);
  if (!candidates?.length) return [];

  const ids = candidates.map((lead) => lead.id);
  const [callsResult, queueResult] = await Promise.all([
    supabase.from("calls").select("lead_id").eq("tenant_id", tenantId).in("lead_id", ids),
    supabase
      .from("call_queue")
      .select("lead_id")
      .eq("tenant_id", tenantId)
      .eq("processed", false)
      .in("lead_id", ids),
  ]);
  if (callsResult.error) throw new Error(`Called lead query failed: ${callsResult.error.message}`);
  if (queueResult.error) throw new Error(`Queued lead query failed: ${queueResult.error.message}`);

  const unavailable = new Set([
    ...(callsResult.data || []).map((row) => row.lead_id),
    ...(queueResult.data || []).map((row) => row.lead_id),
  ]);
  return candidates.filter((lead) => !unavailable.has(lead.id)).slice(0, count);
}

function validateCount(count) {
  const value = Number(count);
  if (!Number.isInteger(value) || value < 1) throw new Error("Count must be a positive integer");
  return value;
}

function dubaiDayKey(date) {
  const shifted = new Date(new Date(date).getTime() + 4 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function assertCapAndSelect(supabase, tenantId, count, startAt) {
  const requested = validateCount(count);
  const schedule = buildScheduledTimes(requested, startAt);
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
  const leads = await selectUncalledPurchasedLeads(supabase, tenantId, requested);
  return { leads, capRemaining };
}

export async function startColdBatch(tenantId, count, requestedBy) {
  return auditedWrite(tenantId, "start_cold_batch", { count }, requestedBy, async (supabase) => {
    const tenant = await getOutboundTenant(supabase, tenantId);
    assertOutboundActive(tenant);
    const withinHours = isWithinBusinessHours();
    const startAt = withinHours ? new Date() : nextWindowStart();
    const { leads, capRemaining } = await assertCapAndSelect(
      supabase,
      tenantId,
      count,
      startAt
    );
    const queued = await queueLeadCalls({
      supabase,
      tenantId,
      leadIds: leads.map((lead) => lead.id),
      startAt,
      source: "copilot-cold-batch",
      requestedBy,
    });
    return {
      started: withinHours ? queued.length : 0,
      scheduled: withinHours ? 0 : queued.length,
      capRemaining: capRemaining + (Number(count) - queued.length),
    };
  });
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

      if (!isWithinBusinessHours()) {
        const queued = await queueLeadCalls({
          supabase,
          tenantId,
          leadIds: [lead.id],
          startAt: nextWindowStart(),
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

export async function scheduleBatch(tenantId, count, whenIso, requestedBy) {
  return auditedWrite(
    tenantId,
    "schedule_batch",
    { count, whenIso },
    requestedBy,
    async (supabase) => {
      const tenant = await getOutboundTenant(supabase, tenantId);
      assertOutboundActive(tenant);
      const when = new Date(whenIso);
      if (Number.isNaN(when.getTime())) throw new Error("Invalid whenIso");
      const { leads, capRemaining } = await assertCapAndSelect(
        supabase,
        tenantId,
        count,
        when
      );
      const queued = await queueLeadCalls({
        supabase,
        tenantId,
        leadIds: leads.map((lead) => lead.id),
        startAt: when,
        source: "copilot-scheduled-batch",
        requestedBy,
      });
      return {
        scheduled: queued.length,
        firstScheduledFor: queued[0]?.scheduled_for || null,
        capRemaining: capRemaining + (Number(count) - queued.length),
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
