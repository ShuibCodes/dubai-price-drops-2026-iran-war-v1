import { getSupabaseServerClient } from "@/lib/supabase/server";
import { startLeadCall } from "@/lib/vapi/client";
import {
  assertOutboundActive,
  isLeadWithinBusinessHours,
  nextLeadWindowStart,
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

const TENANT_SLUG = "1416";

export async function getTenantBySlug(slug = TENANT_SLUG) {
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, outbound_paused, vapi_assistant_id, vapi_assistant_id_meta, vapi_phone_number_id, phone_number_id, business_token"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  if (!data) throw new Error(`Tenant not found for slug: ${slug}`);
  return data;
}

export async function upsertPixxiLead(tenantId, fields) {
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

export function resolveAssistantId(tenant, fields = {}) {
  if (isMetaInstantFormSource(fields) && tenant.vapi_assistant_id_meta) {
    return tenant.vapi_assistant_id_meta;
  }
  return tenant.vapi_assistant_id;
}

export async function dialOrQueueLead({ tenant, lead, fields = {}, dryRun = false }) {
  assertOutboundActive(tenant);
  const variables = buildCallVariables(lead, fields);
  const { leadName, leadSource, propertyInterest, campaignTopic, formWhen, ownsProperty } =
    variables;
  const supabase = getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase not configured");

  const phone = normalizePhone(fields.phone || lead.wa_id);

  if (!isLeadWithinBusinessHours(phone)) {
    const scheduledFor = nextLeadWindowStart(phone);
    if (dryRun) {
      return { queued: true, scheduledFor: scheduledFor.toISOString(), dryRun: true };
    }

    const { error } = await supabase.from("call_queue").insert({
      tenant_id: tenant.id,
      lead_id: lead.id,
      scheduled_for: scheduledFor.toISOString(),
      processed: false,
      source: isMetaInstantFormSource(fields) ? "meta-instant-form" : "pixxi-inbound",
    });
    if (error) throw new Error(`Queue insert failed: ${error.message}`);
    return { queued: true, scheduledFor: scheduledFor.toISOString() };
  }

  if (dryRun) {
    return { queued: false, dryRun: true, ...variables };
  }

  const assistantId = resolveAssistantId(tenant, fields);
  const result = await startLeadCall({
    name: leadName,
    phone,
    assistantId,
    phoneNumberId: tenant.vapi_phone_number_id,
    variableValues: {
      leadName,
      leadSource,
      propertyInterest,
      campaignTopic,
      formWhen,
      ownsProperty,
    },
    metadata: {
      tenantId: tenant.id,
      leadId: lead.id,
      pixxiLeadId: lead.pixxi_lead_id,
      source: isMetaInstantFormSource(fields) ? "meta-instant-form" : "pixxi-inbound",
      assistantId,
    },
  });

  const { error: callError } = await supabase.from("calls").insert({
    tenant_id: tenant.id,
    lead_id: lead.id,
    vapi_call_id: result.callId,
    direction: "outbound",
    status: "initiated",
    source: isMetaInstantFormSource(fields) ? "meta-instant-form" : "pixxi-inbound",
    raw: result.raw,
  });
  if (callError) throw new Error(`Call insert failed: ${callError.message}`);

  return {
    queued: false,
    callId: result.callId,
    status: result.status,
    ...variables,
  };
}
