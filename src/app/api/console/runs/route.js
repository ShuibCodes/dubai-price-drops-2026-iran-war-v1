import {
  assertOutboundActive,
  buildCappedBatchSchedule,
  getOutboundTenant,
  queueLeadCalls,
  resolveBatchDialStart,
} from "@/lib/calls/outbound";
import { consoleContext, CONSOLE_RUN_SOURCE, estCostAed, jsonError } from "@/lib/console/http";
import { selectRunLeadIds } from "@/lib/console/match";
import { normalizePhone, phoneToWaId } from "@/lib/leads/normalize";
import { scriptPointerForScript } from "@/lib/scripts/pointers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireLiveScript(supabase, tenantId, scriptId) {
  if (!scriptId) return { response: jsonError("Pick a live script.", 400) };
  const { data, error } = await supabase
    .from("scripts")
    .select("id, display_name, status, current_version, is_migrated")
    .eq("id", scriptId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.is_migrated) return { response: jsonError("Script not found.", 404) };
  if (data.status !== "live") {
    return { response: jsonError("Only live scripts can be dialled.", 409) };
  }
  const pointer = await scriptPointerForScript(supabase, tenantId, data.id);
  if (!pointer.script_version_id) {
    return { response: jsonError("This script has no published version.", 409) };
  }
  return { script: data, pointer };
}

async function upsertUploadedLeads(supabase, tenantId, contacts) {
  const ids = [];
  for (const contact of contacts) {
    const phone = normalizePhone(contact.phone || contact.wa_id);
    const waId = phoneToWaId(phone);
    if (!waId) continue;
    const now = new Date().toISOString();
    const { data: existing } = await supabase
      .from("leads")
      .select("id, opted_out")
      .eq("tenant_id", tenantId)
      .eq("wa_id", waId)
      .maybeSingle();
    if (existing?.opted_out) continue;
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const { data, error } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        wa_id: waId,
        push_name: String(contact.name || "").trim() || null,
        source: "console-upload",
        first_seen: now,
        last_message_at: now,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Lead upsert failed: ${error.message}`);
    ids.push(data.id);
  }
  return ids;
}

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const body = await request.json().catch(() => ({}));

    const sourceType = String(body.source_type || "whatsapp");
    const loaded = await requireLiveScript(supabase, session.tenantId, body.script_id);
    if (loaded.response) return loaded.response;
    const { pointer } = loaded;

    const tenant = await getOutboundTenant(supabase, session.tenantId);
    assertOutboundActive(tenant);

    let leadIds = [];
    let jarvisLeadIds = [];
    if (sourceType === "upload") {
      const contacts = Array.isArray(body.contacts) ? body.contacts : [];
      leadIds = await upsertUploadedLeads(supabase, session.tenantId, contacts);
    } else {
      const selected = await selectRunLeadIds(supabase, {
        tenantId: session.tenantId,
        sourceType,
        areas: body.areas || [],
        bedrooms: body.bedrooms || "",
        limit: body.limit,
      });
      leadIds = selected.leadIds;
      jarvisLeadIds = selected.jarvisLeadIds;
    }

    const count = leadIds.length || jarvisLeadIds.length;
    if (!count) {
      return jsonError("No matching leads after exclusions.", 400);
    }

    const startAt = body.window_start
      ? resolveBatchDialStart(new Date(body.window_start))
      : resolveBatchDialStart(new Date());
    const { times } = await buildCappedBatchSchedule(
      supabase,
      session.tenantId,
      count,
      startAt
    );
    if (!times.length) {
      return jsonError("No open dial slots in the calling window.", 409);
    }

    const ids = leadIds.length ? leadIds.slice(0, times.length) : [];
    const jarvisIds = jarvisLeadIds.length ? jarvisLeadIds.slice(0, times.length) : [];
    const queuedCount = ids.length || jarvisIds.length;

    const queued = await queueLeadCalls({
      supabase,
      tenantId: session.tenantId,
      leadIds: ids,
      jarvisLeadIds: jarvisIds,
      scheduledTimes: times,
      source: CONSOLE_RUN_SOURCE,
      requestedBy: session.agentId,
      scriptId: pointer.script_id,
      scriptVersionId: pointer.script_version_id,
      agentId: session.agentId,
      sourceType,
      filter: {
        areas: body.areas || [],
        bedrooms: body.bedrooms || "",
      },
      windowStart: times[0],
      windowEnd: times[times.length - 1],
      estCostAed: estCostAed(queuedCount),
    });

    return Response.json({
      ok: true,
      batch_id: queued[0]?.batch_id || null,
      queued: queued.length,
      first_scheduled_for: queued[0]?.scheduled_for || null,
      last_scheduled_for: queued[queued.length - 1]?.scheduled_for || null,
      est_cost_aed: estCostAed(queued.length),
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
