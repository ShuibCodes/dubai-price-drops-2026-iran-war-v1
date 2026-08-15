// Relative import (not @/) so plain node scripts like retry-results-sync.mjs can resolve it
import { getSupabaseServerClient } from "../supabase/server.js";

/** Tenant-specific results destinations (Zapier Catch Hooks, etc.). */
const TENANT_RESULTS_WEBHOOK_ENV = {
  "ghl-courses": "RESULTS_WEBHOOK_URL_GHL_COURSES",
};

export function resultsWebhookUrlForTenant(tenantSlug) {
  const slug = String(tenantSlug || "").trim();
  const envKey = TENANT_RESULTS_WEBHOOK_ENV[slug];
  if (envKey) {
    const dedicated = String(process.env[envKey] || "").trim();
    // Dedicated tenants never fall back to the shared Pixxi/results hook.
    return dedicated || null;
  }
  return String(process.env.RESULTS_WEBHOOK_URL || "").trim() || null;
}

function flatPayload(call, lead, qualification, tenantSlug = "") {
  const areas = Array.isArray(qualification?.areas)
    ? qualification.areas.join(", ")
    : String(qualification?.areas || "");

  return {
    tenant_slug: String(tenantSlug || ""),
    lead_name: String(lead?.push_name || ""),
    lead_phone: lead?.wa_id ? `+${lead.wa_id}` : "",
    pixxi_lead_id: String(lead?.pixxi_lead_id || ""),
    outcome: String(qualification?.outcome || ""),
    intent: String(qualification?.intent || ""),
    budget_aed: qualification?.budget_aed != null ? String(qualification.budget_aed) : "",
    areas,
    timeline: qualification?.timeline != null ? String(qualification.timeline) : "",
    callback_time: qualification?.callback_time != null ? String(qualification.callback_time) : "",
    lead_engaged: qualification?.lead_engaged === true ? "true" : "false",
    crm_note: String(qualification?.crm_note || ""),
    duration_seconds: call?.duration_seconds != null ? String(call.duration_seconds) : "",
    summary: String(call?.summary || ""),
    recording_url: String(call?.recording_url || ""),
    called_at: call?.started_at || call?.ended_at || call?.created_at || "",
    // Course / Pivot to Tech fields (empty for real-estate calls)
    profile: String(qualification?.profile || ""),
    still_priority:
      qualification?.still_priority === true
        ? "true"
        : qualification?.still_priority === false
          ? "false"
          : "",
    ok_for_consultant:
      qualification?.ok_for_consultant === true
        ? "true"
        : qualification?.ok_for_consultant === false
          ? "false"
          : "",
    interest_track: String(qualification?.interest_track || ""),
    preferred_contact: String(qualification?.preferred_contact || ""),
  };
}

export async function postCallResult(call, lead, qualification, { tenantSlug } = {}) {
  const webhookUrl = resultsWebhookUrlForTenant(tenantSlug);
  if (!webhookUrl) return { synced: false, reason: "webhook_not_configured" };

  const payload = flatPayload(call, lead, qualification, tenantSlug);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[notify/results-hook] POST failed ${response.status}: ${text.slice(0, 200)}`);
      return { synced: false, reason: `http_${response.status}` };
    }

    const supabase = getSupabaseServerClient();
    if (supabase && call?.id) {
      await supabase
        .from("calls")
        .update({
          results_synced: true,
          results_synced_at: new Date().toISOString(),
        })
        .eq("id", call.id);
    }

    console.log(
      `[notify/results-hook] synced call ${call.vapi_call_id || call.id}` +
        (tenantSlug ? ` tenant=${tenantSlug}` : "")
    );
    return { synced: true };
  } catch (error) {
    console.error(`[notify/results-hook] error: ${error.message}`);
    return { synced: false, reason: error.message };
  }
}

export { flatPayload };
