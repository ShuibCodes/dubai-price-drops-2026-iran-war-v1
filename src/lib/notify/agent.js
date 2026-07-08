import { getSupabaseServerClient } from "@/lib/supabase/server";
import { maskPhone, phoneToWaId } from "@/lib/leads/normalize";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

function truncate(text, max = 300) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function composeAgentMessage(call, lead, qualification) {
  const leadName = lead.push_name || "Lead";
  const phone = lead.wa_id ? `+${lead.wa_id}` : "unknown";
  const outcome = qualification?.outcome || "unknown";
  const intent = qualification?.intent || "unknown";
  const budget = qualification?.budget_aed || "not stated";
  const areas =
    Array.isArray(qualification?.areas) && qualification.areas.length
      ? qualification.areas.join(", ")
      : "not stated";
  const timeline = qualification?.timeline || "not stated";
  const callback = qualification?.callback_time || "not requested";
  const summary = truncate(call.summary, 300);

  return (
    `AgentZero call summary — ${leadName} (${phone}): ${outcome}. ` +
    `${intent}, budget ${budget}, ${areas}, ${timeline}. ` +
    `Callback: ${callback}. ${summary}`
  );
}

async function sendWhatsAppText({ phoneNumberId, businessToken, toWaId, body }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${businessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: { body },
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error?.message || `Graph API error ${response.status}`);
  }
  return result;
}

export async function sendAgentSummary(call, lead, qualification, tenant = null) {
  const outcome = qualification?.outcome;
  if (!["qualified", "callback"].includes(outcome)) return { sent: false, reason: "outcome_not_notifiable" };
  if (!lead?.assigned_agent_phone) return { sent: false, reason: "no_agent_phone" };

  const message = composeAgentMessage(call, lead, qualification);
  const agentWaId = phoneToWaId(lead.assigned_agent_phone);
  if (!agentWaId) {
    console.log(`[notify/agent] invalid agent phone for lead ${lead.id}`);
    return { sent: false, reason: "invalid_agent_phone" };
  }

  let resolvedTenant = tenant;
  if (!resolvedTenant && call.tenant_id) {
    const supabase = getSupabaseServerClient();
    if (supabase) {
      const { data } = await supabase
        .from("tenants")
        .select("id, phone_number_id, business_token")
        .eq("id", call.tenant_id)
        .maybeSingle();
      resolvedTenant = data;
    }
  }

  if (!resolvedTenant?.phone_number_id || !resolvedTenant?.business_token) {
    console.log(
      `[notify/agent] no sender configured — would notify ${maskPhone(lead.assigned_agent_phone)}: ${message}`
    );
    return { sent: false, reason: "no_sender_configured", message };
  }

  try {
    await sendWhatsAppText({
      phoneNumberId: resolvedTenant.phone_number_id,
      businessToken: resolvedTenant.business_token,
      toWaId: agentWaId,
      body: message,
    });
    console.log(`[notify/agent] sent to ${maskPhone(lead.assigned_agent_phone)} for call ${call.vapi_call_id}`);
    return { sent: true };
  } catch (error) {
    console.error(`[notify/agent] send failed: ${error.message}`);
    return { sent: false, reason: error.message, message };
  }
}
