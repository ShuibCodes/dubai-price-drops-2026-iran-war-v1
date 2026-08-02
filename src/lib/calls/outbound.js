import {
  isWithinBusinessHoursForZone,
  nextWindowStartForZone,
} from "./business-hours.js";
import { buildPropertyInterest, normalizePhone } from "../leads/normalize.js";
import { getLeadTimezone } from "../leads/phone-timezone.js";
import { startLeadCall } from "../vapi/dial.js";

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
      "id, name, slug, outbound_paused, vapi_assistant_id, vapi_assistant_id_meta, vapi_assistant_id_jarvis, vapi_phone_number_id"
    )
    .eq("id", tenantId)
    .single();

  if (error) throw new Error(`Tenant lookup failed: ${error.message}`);
  return data;
}

/** Space calls at BATCH_SPACING_SECONDS from startAt — no business-hours snapping. */
export function buildScheduledTimes(count, startAt) {
  const times = [];
  let cursor = new Date(startAt);
  if (Number.isNaN(cursor.getTime())) throw new Error("Invalid schedule time");

  for (let index = 0; index < count; index += 1) {
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
  jarvisLead = false,
}) {
  assertOutboundActive(tenant);

  const leadName = String(lead.push_name || fields.name || "").trim() || "there";
  const leadSource = lead.source || fields.client_source || "one of the property portals";
  const propertyInterest = buildPropertyInterest(fields);
  const phone = normalizePhone(fields.phone || lead.wa_id);
  if (!phone) throw new Error("Lead has no valid phone number");

  // Jarvis personal dials must NEVER fall back to Pixxi/Allan (vapi_assistant_id).
  let assistantId = tenant.vapi_assistant_id;
  if (jarvisLead) {
    if (!tenant.vapi_assistant_id_jarvis) {
      throw new Error(
        "Missing tenants.vapi_assistant_id_jarvis — refuse to dial with the cold-call assistant"
      );
    }
    assistantId = tenant.vapi_assistant_id_jarvis;
  }
  if (!assistantId) {
    throw new Error("Missing Vapi assistant id for this tenant");
  }

  const result = await startLeadCall({
    name: leadName,
    phone,
    assistantId,
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
      leadId: jarvisLead ? null : lead.id,
      jarvisLeadId: jarvisLead ? lead.id : null,
      pixxiLeadId: lead.pixxi_lead_id,
      source,
    },
  });

  const callRow = {
    tenant_id: tenant.id,
    vapi_call_id: result.callId,
    direction: "outbound",
    status: "initiated",
    source,
    raw: result.raw,
  };
  if (jarvisLead) {
    callRow.lead_id = null;
    callRow.jarvis_lead_id = lead.id;
  } else {
    callRow.lead_id = lead.id;
  }

  const { error } = await supabase.from("calls").insert(callRow);
  if (error) throw new Error(`Call insert failed: ${error.message}`);

  return { callId: result.callId, status: result.status };
}
