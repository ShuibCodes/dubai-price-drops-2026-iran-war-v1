import { getDubaiParts } from "@/lib/calls/business-hours";
import { JARVIS_LEADS_TABLE } from "@/lib/ingest/jarvis-ingest";
import {
  ensureJarvisInferredNames,
  formatJarvisLeadName,
} from "@/lib/jarvis/infer-name";
import {
  clearPendingRelay,
  getPendingRelay,
  isRelayAffirmative,
  normalizeSenderPhone,
  setPendingRelay,
} from "@/lib/jarvis/pending-relay";
import {
  buildJarvisNameOrFilter,
  cleanJarvisSearchName,
  jarvisNameSearchTerms,
} from "@/lib/jarvis/name-search";
import { getSupabaseServerClient, normalizeWaId } from "@/lib/supabase/server";
import { startRelayCall } from "@/lib/vapi/client";

const TASK_MAX_CHARS = 300;
const COOLDOWN_MS = 10 * 60 * 1000;
const RELAY_HOURS_START = 8;
const RELAY_HOURS_END = 21;

const PLACE_RELAY_CALL_DESCRIPTION = `Place a voice call to one of the user's contacts to relay a short spoken message.

Use when the user asks to call someone AND tell/ask them something.
Do NOT use for lead qualification calls — that's the existing lead call tool.

CRITICAL — how to write the task field:
The task you provide is read aloud by a voice assistant directly TO the recipient.
It is not a note to the user and not a transcript of what the user typed.
Rewrite the user's instruction into what the assistant should SAY to the recipient:

Drop all wrapper phrasing: "tell him", "say that", "ask her to", "let them know".
Refer to the user in the THIRD person by name (Shuayb), never "I" or "me".
Address the recipient in the SECOND person ("you", "your").
Keep it short and speakable. No greetings, no sign-off — the assistant handles those.

Examples:
User: "call Tom and tell him to meet me at Dubai Mall at 2pm"
→ task: "Shuayb would like to meet you at Dubai Mall at 2pm"
User: "ring Tom, I'm running 10 late"
→ task: "Shuayb is running about 10 minutes late"
User: "call Sarah and say the offer's been accepted"
→ task: "your offer has been accepted"
User: "call Ahmed and ask if he's free Thursday"
→ task: "Shuayb wants to know if you're free on Thursday"

If the user's request is too vague to turn into a clear spoken message, do not
call this tool — ask them what they want said.`;

export { PLACE_RELAY_CALL_DESCRIPTION };

function db() {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

function fullPhone(waId) {
  const digits = String(waId || "").replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

function firstToken(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
}

function isRelayWithinHours(date = new Date()) {
  // Spec: block 21:00–08:00 Gulf time → allow 08:00–21:00 Asia/Dubai
  const { hour } = getDubaiParts(date);
  return hour >= RELAY_HOURS_START && hour < RELAY_HOURS_END;
}

function jarvisAllowlist() {
  return String(process.env.JARVIS_WHATSAPP_WA_IDS || "")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean);
}

export function isRelaySenderAllowed(senderPhone) {
  const key = normalizeSenderPhone(senderPhone);
  if (!key) return false;
  const allow = jarvisAllowlist();
  if (!allow.length) return false;
  return allow.includes(key);
}

function normalizeTask(task) {
  const cleaned = String(task || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return { ok: false, error: "task is required" };
  if (cleaned.length > TASK_MAX_CHARS) {
    return {
      ok: false,
      error: `task is too long (${cleaned.length} chars). Keep it under ${TASK_MAX_CHARS}.`,
      task: cleaned.slice(0, TASK_MAX_CHARS),
    };
  }
  return { ok: true, task: cleaned };
}

async function recentRelayToPhone(phoneE164) {
  const supabase = db();
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data, error } = await supabase
    .from("relay_calls")
    .select("id, created_at, customer_name, task, status")
    .eq("phone_e164", phoneE164)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Relay cooldown lookup failed: ${error.message}`);
  return data?.[0] || null;
}

async function resolveRelayLead(tenantId, name, phoneHint) {
  const supabase = db();
  const hintDigits = normalizeWaId(phoneHint);
  if (hintDigits) {
    const { data: byPhone, error } = await supabase
      .from(JARVIS_LEADS_TABLE)
      .select(
        "id, push_name, wa_id, inferred_name, inferred_name_confidence, inferred_name_at"
      )
      .eq("tenant_id", tenantId)
      .eq("wa_id", hintDigits)
      .maybeSingle();
    if (error) throw new Error(`Lead phone lookup failed: ${error.message}`);
    if (byPhone) {
      const enriched = await ensureJarvisInferredNames(supabase, tenantId, [byPhone]);
      const lead = enriched.get(byPhone.id) || byPhone;
      const formatted = formatJarvisLeadName(lead);
      return {
        status: "single",
        lead: {
          id: lead.id,
          name: formatted.displayName || name || "there",
          phone: fullPhone(lead.wa_id),
          push_name: lead.push_name,
          inferred_name: lead.inferred_name,
        },
      };
    }
  }

  const query = cleanJarvisSearchName(name);
  if (!query) {
    return { status: "not_found", matches: [] };
  }

  const terms = jarvisNameSearchTerms(query);
  const orFilter = buildJarvisNameOrFilter(terms);
  if (!orFilter) {
    return { status: "not_found", matches: [] };
  }

  const { data: leads, error } = await supabase
    .from(JARVIS_LEADS_TABLE)
    .select(
      "id, push_name, wa_id, inferred_name, inferred_name_confidence, inferred_name_at, last_message_at"
    )
    .eq("tenant_id", tenantId)
    .or(orFilter)
    .order("last_message_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Lead search failed: ${error.message}`);
  if (!leads?.length) {
    return { status: "not_found", matches: [] };
  }

  const enriched = await ensureJarvisInferredNames(supabase, tenantId, leads);
  const needle = firstToken(query);
  const scored = leads
    .map((row) => {
      const lead = enriched.get(row.id) || row;
      const formatted = formatJarvisLeadName(lead);
      const pushFirst = firstToken(lead.push_name);
      const inferredFirst = firstToken(lead.inferred_name);
      let score = 0;
      // Prefer authoritative push_name matches over inferred guesses.
      if (pushFirst === needle) score += 5;
      else if (pushFirst.startsWith(needle) && needle.length >= 2) score += 3;
      if (inferredFirst === needle) score += 2;
      else if (inferredFirst.startsWith(needle) && needle.length >= 2) score += 1;
      return {
        id: lead.id,
        name:
          String(lead.push_name || "").trim() ||
          formatted.displayName ||
          name ||
          "there",
        phone: fullPhone(lead.wa_id),
        push_name: lead.push_name,
        inferred_name: lead.inferred_name,
        score,
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { status: "not_found", matches: [] };

  // Exact push_name first-name winner wins even if weaker inferred matches exist.
  const exactPush = scored.filter(
    (row) => firstToken(row.push_name) === needle && row.score >= 5
  );
  if (exactPush.length === 1) {
    return { status: "single", lead: exactPush[0] };
  }

  if (
    scored.length === 1 ||
    (scored[0].score > 0 && scored[0].score > (scored[1]?.score || 0))
  ) {
    return { status: "single", lead: scored[0] };
  }
  return {
    status: "multiple",
    matches: scored.slice(0, 5).map(({ id, name, phone }) => ({ id, name, phone })),
  };
}

export function formatRelayConfirmation({ name, phone, task }) {
  return `Call ${name} (${phone}) and say: "${task}"? Reply yes to place the call.`;
}

async function dialAndLogRelay({
  tenantId,
  senderPhone,
  leadId,
  phoneE164,
  customerName,
  task,
}) {
  const result = await startRelayCall({
    phoneE164,
    customerName,
    task,
    metadata: {
      tenantId,
      leadId,
      senderPhone: normalizeSenderPhone(senderPhone),
      kind: "relay",
    },
  });

  const supabase = db();
  const { data, error } = await supabase
    .from("relay_calls")
    .insert({
      tenant_id: tenantId,
      sender_phone: normalizeSenderPhone(senderPhone),
      lead_id: leadId || null,
      phone_e164: phoneE164,
      customer_name: customerName,
      task,
      vapi_call_id: result.callId,
      status: "initiated",
    })
    .select("id, vapi_call_id, status")
    .single();
  if (error) throw new Error(`relay_calls insert failed: ${error.message}`);

  return {
    status: "dialed",
    callId: result.callId,
    relayCallId: data.id,
    name: customerName,
    phone: phoneE164,
    task,
  };
}

/**
 * First-turn tool: resolve contact, persist pending confirmation, do NOT dial.
 */
export async function placeRelayCall({
  tenantId,
  senderPhone,
  name,
  task,
  phone,
  forceAfterHours = false,
  forceCooldown = false,
}) {
  if (!isRelaySenderAllowed(senderPhone)) {
    return {
      status: "forbidden",
      error: "Relay calls are only available for allowlisted Jarvis WhatsApp senders.",
    };
  }

  const taskCheck = normalizeTask(task);
  if (!taskCheck.ok) {
    return { status: "invalid_task", error: taskCheck.error };
  }
  const spokenTask = taskCheck.task;

  const resolved = await resolveRelayLead(tenantId, name, phone);
  if (resolved.status === "not_found") {
    return {
      status: "not_found",
      error: `No contact found for "${name}". Ask for the phone number.`,
    };
  }
  if (resolved.status === "multiple") {
    return {
      status: "multiple_matches",
      matches: resolved.matches,
      instruction: "Ask which contact. Never guess.",
    };
  }

  const lead = resolved.lead;
  if (!lead.phone) {
    return {
      status: "not_found",
      error: `Contact "${lead.name || name}" has no phone number.`,
    };
  }

  const hasName = Boolean(
    String(lead.push_name || "").trim() || String(lead.inferred_name || "").trim()
  );
  if (!hasName && !normalizeWaId(phone)) {
    return {
      status: "unnamed_lead",
      phone: lead.phone,
      error:
        "This contact has no saved name. Ask the user for the number explicitly, or confirm the name first with set_lead_name.",
    };
  }

  if (!isRelayWithinHours() && !forceAfterHours) {
    return {
      status: "outside_hours",
      name: lead.name,
      phone: lead.phone,
      task: spokenTask,
      instruction:
        "It is outside 08:00–21:00 Gulf time. Offer to wait until morning, or ask for an explicit override (e.g. \"call anyway\"). If they override, call place_relay_call again with forceAfterHours=true.",
    };
  }

  const recent = await recentRelayToPhone(lead.phone);
  if (recent && !forceCooldown) {
    return {
      status: "cooldown",
      name: lead.name,
      phone: lead.phone,
      lastRelayAt: recent.created_at,
      instruction:
        "A relay was already placed to this number in the last 10 minutes. Refuse unless the user insists — then call place_relay_call again with forceCooldown=true.",
    };
  }

  await setPendingRelay({
    senderPhone,
    tenantId,
    leadId: lead.id,
    phoneE164: lead.phone,
    customerName: lead.name || name || "there",
    task: spokenTask,
  });

  return {
    status: "needs_confirmation",
    leadId: lead.id,
    name: lead.name || name || "there",
    phone: lead.phone,
    task: spokenTask,
    confirmationPrompt: formatRelayConfirmation({
      name: lead.name || name || "there",
      phone: lead.phone,
      task: spokenTask,
    }),
  };
}

/**
 * Confirm + dial a pending relay (WhatsApp "yes" path). Cleared on non-yes.
 * Returns null if there was no pending relay (caller should continue normally).
 */
export async function handleRelayConfirmationMessage({
  tenantId,
  senderPhone,
  message,
}) {
  const pending = await getPendingRelay(senderPhone);
  if (!pending) return null;
  if (pending.tenant_id && tenantId && pending.tenant_id !== tenantId) {
    await clearPendingRelay(senderPhone);
    return null;
  }

  if (!isRelayAffirmative(message)) {
    await clearPendingRelay(senderPhone);
    return null;
  }

  if (!isRelaySenderAllowed(senderPhone)) {
    await clearPendingRelay(senderPhone);
    return {
      handled: true,
      text: "Relay calls are locked to your allowlisted WhatsApp number.",
    };
  }

  try {
    const dialed = await dialAndLogRelay({
      tenantId: pending.tenant_id || tenantId,
      senderPhone,
      leadId: pending.lead_id,
      phoneE164: pending.phone_e164,
      customerName: pending.customer_name,
      task: pending.task,
    });
    await clearPendingRelay(senderPhone);
    return {
      handled: true,
      text: `Calling ${dialed.name} at ${dialed.phone} now — I'll relay: "${dialed.task}"`,
      dialed,
    };
  } catch (error) {
    await clearPendingRelay(senderPhone);
    return {
      handled: true,
      text: `Couldn't place that relay call: ${error.message}`,
    };
  }
}

export async function updateRelayCallFromWebhook({
  vapiCallId,
  status,
  summary,
  transcript,
}) {
  if (!vapiCallId) return null;
  const supabase = db();
  const { data: existing, error: lookupError } = await supabase
    .from("relay_calls")
    .select(
      "id, tenant_id, sender_phone, lead_id, phone_e164, customer_name, task, vapi_call_id, status"
    )
    .eq("vapi_call_id", vapiCallId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`relay_calls lookup failed: ${lookupError.message}`);
  }
  if (!existing) return null;

  const patch = {
    status: status || "completed",
  };
  if (summary) patch.summary = summary;
  else if (transcript) {
    patch.summary = `Relay delivered: "${existing.task}"`;
  }

  const { data, error } = await supabase
    .from("relay_calls")
    .update(patch)
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw new Error(`relay_calls update failed: ${error.message}`);
  return data;
}

/**
 * Mirror a completed relay into `calls` so Jarvis lead story / call detail can see it.
 */
export async function upsertRelayIntoCallsTable({
  details,
  relay,
}) {
  if (!details?.callId || !relay?.tenant_id) return null;
  const supabase = db();

  const summary =
    details.summary ||
    (relay.task ? `Relay: ${relay.task}` : null) ||
    null;

  const row = {
    tenant_id: relay.tenant_id,
    lead_id: null,
    jarvis_lead_id: relay.lead_id || null,
    vapi_call_id: details.callId,
    direction: "outbound",
    status: "completed",
    started_at: details.startedAt || null,
    ended_at: details.endedAt || null,
    duration_seconds: details.durationSeconds,
    recording_url: details.recordingUrl || null,
    transcript: details.transcript || null,
    summary,
    qualification: {
      outcome: "relay",
      task: relay.task || null,
      passback: details.summary || null,
    },
    source: "jarvis-relay",
    lead_name: relay.customer_name || null,
    raw: details.raw || null,
  };

  const { data: existing } = await supabase
    .from("calls")
    .select("id")
    .eq("vapi_call_id", details.callId)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("calls")
      .update(row)
      .eq("id", existing.id)
      .select("id, vapi_call_id")
      .single();
    if (error) throw new Error(`Relay call update failed: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase
    .from("calls")
    .insert(row)
    .select("id, vapi_call_id")
    .single();
  if (error) throw new Error(`Relay call insert failed: ${error.message}`);
  return data;
}
