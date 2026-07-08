import { extractCallRecord, writeCallRecord } from "@/lib/kb/calls";
import { clearKbCache } from "@/lib/kb/loader";
import { resolveQualification } from "@/lib/calls/qualification";
import { phoneToWaId } from "@/lib/leads/normalize";
import { sendAgentSummary } from "@/lib/notify/agent";
import { postCallResult } from "@/lib/notify/results-hook";
import { timingSafeEqual } from "@/lib/security/timing-safe";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PERSISTED_EVENT_TYPES = new Set([
  "end-of-call-report",
  "call.ended",
  "call-end",
  "status-update",
]);

function verifySecret(request) {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided =
    request.headers.get("x-vapi-secret") ||
    request.headers.get("x-vapi-signature") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return timingSafeEqual(provided, expected);
}

function clean(value) {
  return String(value ?? "").trim();
}

function isEndOfCallReport(payload) {
  const eventType =
    payload?.message?.type || payload?.type || payload?.event || "";
  return (
    eventType === "end-of-call-report" ||
    eventType === "call.ended" ||
    eventType === "call-end"
  );
}

function extractVapiCallDetails(payload = {}) {
  const message = payload?.message ?? payload;
  const call = message?.call ?? payload?.call ?? {};
  const callId = clean(call?.id) || clean(message?.callId) || clean(payload?.callId);
  const customer = call?.customer ?? message?.customer ?? {};
  const customerNumber =
    clean(customer?.number) || clean(call?.to) || clean(call?.phoneNumber) || "";

  const summary =
    clean(message?.analysis?.summary) ||
    clean(message?.summary) ||
    clean(call?.analysis?.summary) ||
    clean(call?.summary) ||
    "";

  const transcript =
    clean(message?.transcript) ||
    clean(call?.transcript) ||
    clean(message?.analysis?.transcript) ||
    "";

  const recordingUrl =
    clean(message?.recordingUrl) ||
    clean(call?.recordingUrl) ||
    clean(message?.stereoRecordingUrl) ||
    "";

  const startedAt =
    clean(call?.startedAt) || clean(message?.startedAt) || clean(call?.createdAt) || null;
  const endedAt =
    clean(call?.endedAt) || clean(message?.endedAt) || new Date().toISOString();

  const durationSeconds =
    Number(call?.duration) ||
    Number(message?.duration) ||
    Number(call?.durationSeconds) ||
    null;

  const structuredData =
    message?.analysis?.structuredData ||
    call?.analysis?.structuredData ||
    message?.structuredData ||
    null;

  const endedReason = clean(message?.endedReason) || clean(call?.endedReason) || "";

  const metadata = call?.metadata || message?.metadata || {};

  return {
    callId,
    customerNumber,
    summary,
    transcript,
    recordingUrl,
    startedAt,
    endedAt,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    structuredData,
    endedReason,
    metadata,
    raw: payload,
  };
}

async function findLeadByPhone(supabase, tenantId, phone) {
  const waId = phoneToWaId(phone);
  if (!waId) return null;

  let query = supabase.from("leads").select("*").eq("wa_id", waId);
  if (tenantId) query = query.eq("tenant_id", tenantId);

  const { data } = await query.maybeSingle();
  if (data) return data;

  // Fallback: match last 9 digits for UAE numbers
  const suffix = waId.slice(-9);
  if (suffix.length < 8) return null;

  let suffixQuery = supabase.from("leads").select("*").like("wa_id", `%${suffix}`);
  if (tenantId) suffixQuery = suffixQuery.eq("tenant_id", tenantId);

  const { data: matches } = await suffixQuery.limit(1);
  return matches?.[0] || null;
}

async function upsertCompletedCall(details, qualification) {
  const supabase = getSupabaseServerClient();
  if (!supabase || !details.callId) return null;

  const tenantId = details.metadata?.tenantId || null;
  const leadIdHint = details.metadata?.leadId || null;

  let lead = null;
  if (leadIdHint) {
    const { data } = await supabase.from("leads").select("*").eq("id", leadIdHint).maybeSingle();
    lead = data;
  }
  if (!lead) {
    lead = await findLeadByPhone(supabase, tenantId, details.customerNumber);
  }

  const row = {
    tenant_id: lead?.tenant_id || tenantId,
    lead_id: lead?.id || null,
    vapi_call_id: details.callId,
    direction: "outbound",
    status: "completed",
    started_at: details.startedAt,
    ended_at: details.endedAt,
    duration_seconds: details.durationSeconds,
    recording_url: details.recordingUrl || null,
    transcript: details.transcript || null,
    summary: details.summary || null,
    qualification,
    raw: details.raw,
  };

  const { data: existing } = await supabase
    .from("calls")
    .select("id, tenant_id, results_synced")
    .eq("vapi_call_id", details.callId)
    .maybeSingle();

  let callRecord;
  if (existing) {
    const { data, error } = await supabase
      .from("calls")
      .update(row)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) {
      console.error("[vapi/webhook] call update failed:", error.message);
      return null;
    }
    callRecord = data;
  } else if (row.tenant_id) {
    const { data, error } = await supabase.from("calls").insert(row).select("*").single();
    if (error) {
      console.error("[vapi/webhook] call insert failed:", error.message);
      return null;
    }
    callRecord = data;
  } else {
    console.warn(`[vapi/webhook] no tenant for call ${details.callId}, skipping DB upsert`);
    return null;
  }

  return { call: callRecord, lead };
}

async function processPipelineCall(payload) {
  const details = extractVapiCallDetails(payload);
  if (!details.callId) return { processed: false, reason: "missing_call_id" };

  const qualification = await resolveQualification({
    structuredData: details.structuredData,
    transcript: details.transcript,
    summary: details.summary,
    endedReason: details.endedReason,
  });

  const result = await upsertCompletedCall(details, qualification);
  if (!result) return { processed: false, reason: "db_upsert_failed" };

  const { call, lead } = result;

  if (lead) {
    await sendAgentSummary(call, lead, qualification);
    await postCallResult(call, lead, qualification);
  }

  return { processed: true, callId: details.callId, qualification };
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "VAPI webhook is healthy. POST end-of-call-report payloads here.",
  });
}

export async function POST(request) {
  let pipelineResult = null;

  try {
    if (!verifySecret(request)) {
      return Response.json({ ok: false, error: "Invalid secret" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const eventType =
      payload?.message?.type ||
      payload?.type ||
      payload?.event ||
      "unknown";

    const shouldPersist =
      PERSISTED_EVENT_TYPES.has(String(eventType)) ||
      Boolean(payload?.message?.endedReason) ||
      Boolean(payload?.message?.summary) ||
      Boolean(payload?.message?.transcript);

    if (!shouldPersist) {
      return Response.json({ ok: true, persisted: false, eventType });
    }

    const record = extractCallRecord(payload);
    if (!record.summary && !record.transcript) {
      return Response.json({
        ok: true,
        persisted: false,
        eventType,
        reason: "No summary or transcript yet",
      });
    }

    const { fileName, fullPath } = writeCallRecord(record);
    clearKbCache();

    if (isEndOfCallReport(payload)) {
      try {
        pipelineResult = await processPipelineCall(payload);
      } catch (pipelineError) {
        console.error("[vapi/webhook] pipeline error:", pipelineError.message);
        pipelineResult = { processed: false, error: pipelineError.message };
      }
    }

    return Response.json({
      ok: true,
      persisted: true,
      eventType,
      callId: record.callId,
      leadName: record.leadName,
      fileName,
      fullPath,
      pipeline: pipelineResult,
    });
  } catch (error) {
    console.error("VAPI webhook error:", error);
    return Response.json(
      { ok: true, error: error?.message || "Webhook handler error", pipeline: pipelineResult },
      { status: 200 }
    );
  }
}
