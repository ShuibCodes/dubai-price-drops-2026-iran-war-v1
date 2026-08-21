import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function worthScore(call) {
  const q = call.qualification && typeof call.qualification === "object" ? call.qualification : {};
  if (q.outcome === "qualified") return 50;
  if (q.outcome === "callback") return 40;
  if (q.lead_engaged) return 30;
  if (q.outcome === "not_interested") return 10;
  return 0;
}

function quotedSentence(call) {
  const transcript = String(call.transcript || "");
  const lines = transcript
    .split("\n")
    .map((line) => line.replace(/^(User|Lead|Customer)\s*:\s*/i, "").trim())
    .filter((line) => line && !/^(AI|Assistant|Agent)\s*:/i.test(line));
  const sentence = lines.find((line) => line.length > 12) || call.summary || "";
  return sentence.slice(0, 240);
}

function extractedSub(call, findOut) {
  const q = call.qualification && typeof call.qualification === "object" ? call.qualification : {};
  const items = Array.isArray(findOut) ? findOut : [];
  if (!items.length) {
    const bits = [
      q.intent,
      q.budget_aed ? `AED ${q.budget_aed}` : null,
      Array.isArray(q.areas) && q.areas.length ? q.areas.join(", ") : null,
      q.timeline,
    ].filter(Boolean);
    return bits.join(" · ");
  }
  return items
    .map((item) => {
      const key = String(item.label || "")
        .toLowerCase()
        .replace(/\s+/g, "_");
      const value =
        q[key] ??
        q[item.label] ??
        (key.includes("budget") ? q.budget_aed : null) ??
        (key.includes("area") ? (Array.isArray(q.areas) ? q.areas.join(", ") : q.areas) : null) ??
        (key.includes("timeline") ? q.timeline : null);
      if (value == null || value === "") return null;
      return `${item.label}: ${value}`;
    })
    .filter(Boolean)
    .join(" · ");
}

export async function GET(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const id = await routeId(params);

    const { data: batch, error } = await supabase
      .from("call_batches")
      .select(
        "id, tenant_id, status, source_type, created_at, counts, est_cost_aed, window_start, window_end, script_id, script_version_id, scripts(display_name), script_versions(config_json)"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!batch || batch.tenant_id !== session.tenantId) {
      return jsonError("Run not found.", 404);
    }

    const [{ data: calls, error: callsError }, { data: queue, error: queueError }] =
      await Promise.all([
        supabase
          .from("calls")
          .select(
            "id, lead_id, jarvis_lead_id, status, summary, transcript, recording_url, qualification, created_at, ended_at, duration_seconds, leads(push_name, wa_id), jarvis_leads(push_name, wa_id)"
          )
          .eq("tenant_id", session.tenantId)
          .eq("batch_id", id)
          .order("created_at", { ascending: false }),
        supabase
          .from("call_queue")
          .select(
            "id, lead_id, jarvis_lead_id, scheduled_for, processed, failed_at, failure_reason, leads(push_name, wa_id), jarvis_leads(push_name, wa_id)"
          )
          .eq("tenant_id", session.tenantId)
          .eq("batch_id", id)
          .order("scheduled_for", { ascending: true }),
      ]);
    if (callsError) throw new Error(callsError.message);
    if (queueError) throw new Error(queueError.message);

    const findOut = batch.script_versions?.config_json?.find_out || [];
    const callRows = (calls || []).map((call) => {
      const person = call.leads || call.jarvis_leads || {};
      return {
        id: call.id,
        lead_id: call.lead_id,
        jarvis_lead_id: call.jarvis_lead_id,
        name: person.push_name || (person.wa_id ? `+${person.wa_id}` : "Lead"),
        phone: person.wa_id ? `+${person.wa_id}` : null,
        status: call.status,
        quote: quotedSentence(call),
        recording_url: call.recording_url || null,
        transcript: call.transcript || null,
        extracted: extractedSub(call, findOut),
        worth: worthScore(call),
        ended_at: call.ended_at,
      };
    });
    const seen = new Set(
      callRows.map((row) => row.lead_id || row.jarvis_lead_id).filter(Boolean)
    );
    const queueRows = (queue || [])
      .filter((row) => !seen.has(row.lead_id || row.jarvis_lead_id))
      .map((row) => {
        const person = row.leads || row.jarvis_leads || {};
        const failed = Boolean(row.failed_at);
        return {
          id: row.id,
          lead_id: row.lead_id,
          jarvis_lead_id: row.jarvis_lead_id,
          name: person.push_name || (person.wa_id ? `+${person.wa_id}` : "Lead"),
          phone: person.wa_id ? `+${person.wa_id}` : null,
          status: failed ? "failed" : row.processed ? "dialed" : "queued",
          quote: row.failure_reason || null,
          recording_url: null,
          transcript: null,
          extracted: row.scheduled_for
            ? `Scheduled ${new Date(row.scheduled_for).toLocaleString("en-GB", {
                timeZone: "Asia/Dubai",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : null,
          worth: 0,
          ended_at: row.failed_at,
        };
      });
    const rows = [...callRows, ...queueRows].sort((a, b) => b.worth - a.worth);

    const counts = batch.counts || {};
    return Response.json({
      run: {
        id: batch.id,
        status: batch.status,
        source_type: batch.source_type,
        created_at: batch.created_at,
        script_id: batch.script_id,
        script_name: batch.scripts?.display_name || "Untitled script",
        counts,
        est_cost_aed: batch.est_cost_aed,
        window_start: batch.window_start,
        window_end: batch.window_end,
      },
      stats: {
        dialed: counts.dialed || callRows.length,
        queued: counts.queued || rows.length,
        qualified: counts.qualified || callRows.filter((row) => row.worth >= 50).length,
        callbacks: callRows.filter((row) => /callback/i.test(row.extracted || "")).length,
      },
      calls: rows,
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
