import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  assertOutboundActive,
  dialLeadNow,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
  queueLeadCalls,
} from "@/lib/calls/outbound";
import {
  buildPropertyInterest,
  normalizePhone,
  phoneToWaId,
  resolveLeadSource,
} from "@/lib/leads/normalize";
import {
  buildLeadSourceWithMeta,
  buildMetaFormVariables,
  isMetaInstantFormSource,
  normalizeOwnsProperty,
} from "@/lib/leads/meta-form";

export async function getTenantBySlug(slug) {
  const normalized = String(slug || "").trim();
  if (!normalized) throw new Error("tenant slug is required");

  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, outbound_paused, vapi_assistant_id, vapi_assistant_id_meta, vapi_phone_number_id, phone_number_id, business_token"
    )
    .eq("slug", normalized)
    .maybeSingle();

  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  if (!data) throw new Error(`Tenant not found for slug: ${normalized}`);
  return data;
}

export async function upsertInboundLead(tenantId, fields) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const phone = normalizePhone(fields.phone);
  if (!phone) throw new Error("Invalid phone number");

  const waId = phoneToWaId(phone);
  const pixxiLeadId = String(fields.pixxi_lead_id || "").trim() || null;
  const baseSource = resolveLeadSource(fields);
  const leadSource = buildLeadSourceWithMeta(fields, baseSource);
  const ownsProperty = normalizeOwnsProperty(fields.owns_property) || null;
  const now = new Date().toISOString();

  const row = {
    tenant_id: tenantId,
    wa_id: waId,
    push_name: String(fields.name || "").trim() || null,
    pixxi_lead_id: pixxiLeadId,
    assigned_agent_name: String(fields.agent_name || "").trim() || null,
    assigned_agent_phone: fields.agent_phone
      ? normalizePhone(fields.agent_phone) || String(fields.agent_phone).trim()
      : null,
    source: leadSource,
    owns_property: ownsProperty,
    last_message_at: now,
    first_seen: now,
  };

  if (pixxiLeadId) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id, first_seen")
      .eq("tenant_id", tenantId)
      .eq("pixxi_lead_id", pixxiLeadId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase
        .from("leads")
        .update({ ...row, first_seen: existing.first_seen })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw new Error(`Lead update failed: ${error.message}`);
      return data;
    }
  }

  const { data: byPhone } = await supabase
    .from("leads")
    .select("id, first_seen, pixxi_lead_id")
    .eq("tenant_id", tenantId)
    .eq("wa_id", waId)
    .maybeSingle();

  if (byPhone) {
    const { data, error } = await supabase
      .from("leads")
      .update({
        ...row,
        first_seen: byPhone.first_seen,
        pixxi_lead_id: pixxiLeadId || byPhone.pixxi_lead_id,
      })
      .eq("id", byPhone.id)
      .select("*")
      .single();
    if (error) throw new Error(`Lead update failed: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase.from("leads").insert(row).select("*").single();
  if (error) throw new Error(`Lead insert failed: ${error.message}`);
  return data;
}

export function buildCallVariables(lead, fields = {}) {
  const leadName = String(lead.push_name || fields.name || "").trim() || "there";
  const leadSource = lead.source || resolveLeadSource(fields);
  const propertyInterest = buildPropertyInterest({
    rooms: fields.rooms,
    house_type: fields.house_type,
    community: fields.community,
    budget: fields.budget,
  });
  const metaVars = buildMetaFormVariables(fields);

  return {
    leadName,
    leadSource,
    propertyInterest,
    campaignTopic: metaVars.campaignTopic,
    formWhen: metaVars.formWhen,
    ownsProperty: metaVars.ownsProperty,
  };
}

function inboundCallSource(fields = {}) {
  if (isMetaInstantFormSource(fields)) return "meta-instant-form";
  if (String(fields.pixxi_lead_id || "").trim()) return "pixxi-inbound";
  const raw = String(fields.client_source || fields.custom_client_source || "")
    .trim()
    .toLowerCase();
  if (raw === "ghl" || raw.startsWith("ghl")) return "ghl-inbound";
  return "inbound";
}

/**
 * @param {{ immediate?: boolean }} [options]
 *   immediate: skip lead-local business-hours deferral and dial now
 *   (used for ghl-courses opt-ins — call within ~60s of webhook).
 */
export async function dialOrQueueLead({
  tenant,
  lead,
  fields = {},
  dryRun = false,
  immediate = false,
}) {
  assertOutboundActive(tenant);
  if (lead.opted_out) {
    throw new Error("Lead has opted out");
  }
  const variables = buildCallVariables(lead, fields);
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const phone = normalizePhone(fields.phone || lead.wa_id);
  const source = inboundCallSource(fields);

  if (!immediate && !isLeadWithinBusinessHours(phone)) {
    const scheduledFor = nextLeadWindowStart(phone);
    if (dryRun) {
      return { queued: true, scheduledFor: scheduledFor.toISOString(), dryRun: true };
    }

    await queueLeadCalls({
      supabase,
      tenantId: tenant.id,
      leadIds: [lead.id],
      scheduledTimes: [scheduledFor.toISOString()],
      source,
    });
    return { queued: true, scheduledFor: scheduledFor.toISOString() };
  }

  if (dryRun) {
    return { queued: false, dryRun: true, ...variables };
  }

  const result = await dialLeadNow({
    supabase,
    tenant,
    lead,
    fields,
    source,
  });

  return {
    queued: false,
    callId: result.callId,
    status: result.status,
    ...variables,
  };
}
