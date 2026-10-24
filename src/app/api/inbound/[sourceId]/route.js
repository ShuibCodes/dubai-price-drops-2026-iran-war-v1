import { getSupabaseServerClient } from "@/lib/supabase/server";
import { timingSafeEqual } from "@/lib/security/timing-safe";
import { maskPhone } from "@/lib/leads/normalize";
import { upsertInboundLead } from "@/lib/leads/inbound";
import {
  INBOUND_DEDUPE_MS,
  mapInboundPayload,
  scheduleFirstCall,
  toE164,
} from "@/lib/leads/inbound-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    return form ? Object.fromEntries(form.entries()) : {};
  }
  return request.json().catch(() => ({}));
}

/** Copy of the payload with phone-ish values masked, for logs. */
function loggablePayload(body) {
  return JSON.stringify(body, (key, value) =>
    /phone|mobile/i.test(key) && typeof value === "string" ? maskPhone(value) : value
  ).slice(0, 4000);
}

/**
 * Generic inbound lead webhook (GHL forms first).
 * Auth: header x-az-secret or ?key= (some GHL plans can't set headers).
 * Never dials in-request — the batch-callbacks cron picks up call_status=waiting.
 */
export async function POST(request, { params }) {
  const sourceId = String(params?.sourceId || "");
  const supabase = getSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Supabase not configured" }, { status: 500 });
  if (!UUID_RE.test(sourceId)) return Response.json({ error: "not_found" }, { status: 404 });

  const { data: source, error: sourceError } = await supabase
    .from("inbound_sources")
    .select("*, tenants(id, slug, outbound_paused)")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) {
    console.error("[inbound] source lookup failed:", sourceError.message);
    return Response.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!source || !source.is_active) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const provided =
    request.headers.get("x-az-secret") || new URL(request.url).searchParams.get("key");
  if (!timingSafeEqual(provided, source.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await readBody(request);
  console.log(`[inbound] source=${source.id} tenant=${source.tenants?.slug} payload=${loggablePayload(body)}`);

  const mapped = mapInboundPayload(body, source.field_map);
  const phone = toE164(mapped.phone);
  if (!phone) {
    return Response.json({ error: "invalid_phone" }, { status: 422 });
  }

  try {
    // Existing upsert: matches (tenant_id, wa_id), keeps first_seen/agent assignment.
    // client_source becomes leads.source = the list name (console "saved list").
    const lead = await upsertInboundLead(
      source.tenant_id,
      { name: mapped.name, phone, client_source: source.list_name || source.name },
      supabase
    );

    const patch = {
      inbound_source_id: source.id,
      form_data: {
        ...(lead.form_data || {}),
        ...mapped.extra,
        ...(mapped.email ? { email: mapped.email } : {}),
      },
    };
    if (mapped.externalId) patch.external_id = mapped.externalId;

    let callStatus = lead.call_status || null;
    let nextCallAt = lead.next_call_at || null;
    let note = null;

    if (!source.auto_call) {
      note = "auto_call_off";
    } else if (source.tenants?.outbound_paused) {
      note = "tenant_paused";
    } else if (lead.opted_out) {
      note = "opted_out";
    } else if (["waiting", "calling"].includes(lead.call_status)) {
      note = "already_queued";
    } else {
      // Dedupe: any call to this lead in the last 10 min (covers the Zapier path too).
      const since = new Date(Date.now() - INBOUND_DEDUPE_MS).toISOString();
      const { count } = await supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .gte("created_at", since);
      if (count) {
        note = "recently_called";
      } else {
        callStatus = "waiting";
        nextCallAt = scheduleFirstCall(source, phone).toISOString();
        Object.assign(patch, {
          call_status: callStatus,
          next_call_at: nextCallAt,
          call_attempts: 0,
        });
      }
    }

    const { error: patchError } = await supabase.from("leads").update(patch).eq("id", lead.id);
    if (patchError) throw new Error(`Lead patch failed: ${patchError.message}`);

    console.log(
      `[inbound] source=${source.id} lead=${lead.id} phone=${maskPhone(phone)} call_status=${callStatus} next_call_at=${nextCallAt} note=${note || "queued"}`
    );
    return Response.json({
      lead_id: lead.id,
      call_status: callStatus,
      next_call_at: nextCallAt,
      ...(note ? { note } : {}),
    });
  } catch (error) {
    console.error("[inbound] error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
