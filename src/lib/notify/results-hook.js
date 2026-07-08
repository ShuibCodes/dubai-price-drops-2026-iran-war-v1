import { getSupabaseServerClient } from "@/lib/supabase/server";

function flatPayload(call, lead, qualification) {
  const areas = Array.isArray(qualification?.areas)
    ? qualification.areas.join(", ")
    : String(qualification?.areas || "");

  return {
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
    duration_seconds: call?.duration_seconds != null ? String(call.duration_seconds) : "",
    summary: String(call?.summary || ""),
    recording_url: String(call?.recording_url || ""),
    called_at: call?.started_at || call?.ended_at || call?.created_at || "",
  };
}

export async function postCallResult(call, lead, qualification) {
  const webhookUrl = process.env.RESULTS_WEBHOOK_URL;
  if (!webhookUrl) return { synced: false, reason: "webhook_not_configured" };

  const payload = flatPayload(call, lead, qualification);

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

    console.log(`[notify/results-hook] synced call ${call.vapi_call_id || call.id}`);
    return { synced: true };
  } catch (error) {
    console.error(`[notify/results-hook] error: ${error.message}`);
    return { synced: false, reason: error.message };
  }
}

export { flatPayload };
