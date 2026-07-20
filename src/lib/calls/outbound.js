import {
  isWithinBusinessHours,
  isWithinBusinessHoursForZone,
  nextWindowStart,
  nextWindowStartForZone,
} from "./business-hours.js";
import { buildPropertyInterest, normalizePhone } from "../leads/normalize.js";
import { getLeadTimezone } from "../leads/phone-timezone.js";
import { startLeadCall } from "../vapi/dial.js";

export const DAILY_BATCH_CAP = 500;
export const BATCH_SPACING_SECONDS = 60;

export function assertOutboundActive(tenant) {
  if (!tenant) throw new Error("Tenant not found");
  if (tenant.outbound_paused) {
    throw new Error("Outbound calling is paused for this tenant");
  }
}

export async function getOutboundTenant(supabase, tenantId) {
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, name, slug, outbound_paused, vapi_assistant_id, vapi_assistant_id_meta, vapi_phone_number_id"
    )
    .eq("id", tenantId)
    .single();

  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  return data;
}

export function buildScheduledTimes(count, startAt) {
  const times = [];
  let cursor = new Date(startAt);
  if (Number.isNaN(cursor.getTime())) throw new Error("Invalid schedule time");

  for (let index = 0; index < count; index += 1) {
    if (!isWithinBusinessHours(cursor)) cursor = nextWindowStart(cursor);
    times.push(cursor.toISOString());
    cursor = new Date(cursor.getTime() + BATCH_SPACING_SECONDS * 1000);
  }
  return times;
}

export async function queueLeadCalls({
  supabase,
  tenantId,
  leadIds,
  startAt,
  scheduledTimes: explicitTimes,
  source,
  requestedBy,
}) {
  if (!leadIds.length) return [];
  const scheduledTimes =
    explicitTimes && explicitTimes.length >= leadIds.length
      ? explicitTimes
      : buildScheduledTimes(leadIds.length, startAt);
  const rows = leadIds.map((leadId, index) => ({
    tenant_id: tenantId,
    lead_id: leadId,
    scheduled_for: scheduledTimes[index],
    processed: false,
    source,
    requested_by: requestedBy || null,
  }));

  const { data, error } = await supabase.from("call_queue").insert(rows).select("id, lead_id, scheduled_for");
  if (error) throw new Error(`Queue insert failed: ${error.message}`);
  return data || [];
}

/** Business-hours check in the LEAD's local timezone (from phone country code). */
export function isLeadWithinBusinessHours(phone, date = new Date()) {
  return isWithinBusinessHoursForZone(getLeadTimezone(phone), date);
}

/** Next local business-window start (UTC) for the LEAD's timezone. */
export function nextLeadWindowStart(phone, date = new Date()) {
  return nextWindowStartForZone(getLeadTimezone(phone), date);
}

export async function dialLeadNow({
  supabase,
  tenant,
  lead,
  fields = {},
  source,
}) {
  assertOutboundActive(tenant);

  const leadName = String(lead.push_name || fields.name || "").trim() || "there";
  const leadSource = lead.source || fields.client_source || "one of the property portals";
  const propertyInterest = buildPropertyInterest(fields);
  const phone = normalizePhone(fields.phone || lead.wa_id);
  if (!phone) throw new Error("Lead has no valid phone number");

  if (!isLeadWithinBusinessHours(phone)) {
    throw new Error(
      `Outside business hours for lead timezone ${getLeadTimezone(phone)}`
    );
  }

  const result = await startLeadCall({
    name: leadName,
    phone,
    assistantId: tenant.vapi_assistant_id,
    phoneNumberId: tenant.vapi_phone_number_id,
    variableValues: {
      leadName,
      leadSource,
      propertyInterest,
      campaignTopic: fields.campaignTopic || "",
      formWhen: fields.formWhen || "",
      ownsProperty: fields.ownsProperty || lead.owns_property || "",
    },
    metadata: {
      tenantId: tenant.id,
      leadId: lead.id,
      pixxiLeadId: lead.pixxi_lead_id,
      source,
    },
  });

  const { error } = await supabase.from("calls").insert({
    tenant_id: tenant.id,
    lead_id: lead.id,
    vapi_call_id: result.callId,
    direction: "outbound",
    status: "initiated",
    source,
    raw: result.raw,
  });
  if (error) throw new Error(`Call insert failed: ${error.message}`);

  return { callId: result.callId, status: result.status };
}
