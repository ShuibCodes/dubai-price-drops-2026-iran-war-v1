import {
  sendCloudTemplate,
  sendCloudText,
  TEMPLATE_BRIEF,
} from "@/lib/whatsapp/cloud";

function rankScore(lead) {
  if (lead.intent_score != null && Number.isFinite(Number(lead.intent_score))) {
    return Number(lead.intent_score);
  }
  const last = lead.last_message_at ? new Date(lead.last_message_at).getTime() : 0;
  return last / 1e12;
}

export async function buildMorningBrief(supabase, { tenantId, agent, limit = 5 }) {
  if (!tenantId || !agent?.id) {
    throw new Error("Brief requires tenant and agent scope");
  }
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, push_name, wa_id, source, intent_score, budget, areas, last_message_at")
    .eq("tenant_id", tenantId)
    .eq("assigned_agent_id", agent.id)
    .eq("opted_out", false)
    .order("last_message_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(`Brief lead query failed: ${error.message}`);

  const ranked = [...(leads || [])].sort((a, b) => rankScore(b) - rankScore(a));
  const top = ranked.slice(0, limit);

  const name = agent?.name || "there";
  const lines = top.map((lead, index) => {
    const who = lead.push_name || `+${lead.wa_id}`;
    const area = Array.isArray(lead.areas) && lead.areas[0] ? ` · ${lead.areas[0]}` : "";
    const budget = lead.budget ? ` · AED ${lead.budget}` : "";
    return `${index + 1}. ${who}${area}${budget}`;
  });

  const body =
    top.length === 0
      ? `Morning ${name} — overnight scan is quiet. No new pipeline names worth a call yet.`
      : [
          `Morning ${name} — overnight pipeline, ranked for you:`,
          ...lines,
          "Reply with a name to hear more, or `call <name>` to dial.",
        ].join("\n");

  return { body, count: top.length, leads: top };
}

function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function claimNotificationDay(supabase, tenantId, agentId, today) {
  const { data, error } = await supabase
    .from("agents")
    .update({ last_brief_sent_on: today })
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .or(`last_brief_sent_on.is.null,last_brief_sent_on.neq.${today}`)
    .select("id, last_brief_sent_on")
    .maybeSingle();
  if (error) throw new Error(`Brief notification claim failed: ${error.message}`);
  return Boolean(data?.id);
}

async function releaseNotificationDay(
  supabase,
  tenantId,
  agentId,
  today,
  previousDay
) {
  await supabase
    .from("agents")
    .update({ last_brief_sent_on: previousDay || null })
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .eq("last_brief_sent_on", today);
}

export async function sendMorningBriefNotification({
  supabase,
  tenant,
  agent,
  now = new Date(),
  sendTemplate = sendCloudTemplate,
}) {
  const toWaId = String(agent.wa_id || "").replace(/\D/g, "");
  if (!toWaId) return { sent: false, reason: "no_agent_wa_id" };

  const today = utcDate(now);
  const claimed = await claimNotificationDay(
    supabase,
    tenant.id,
    agent.id,
    today
  );
  if (!claimed) {
    return { sent: false, reason: "already_sent_today" };
  }

  try {
    // Static product copy: "Your AgentZero morning brief is ready" +
    // quick reply. Do not send body variables unless Shuayb's approved
    // template actually defines them — then set them here, not guessed.
    await sendTemplate({
      phoneNumberId: tenant.phone_number_id,
      businessToken: tenant.business_token,
      toWaId,
      name: TEMPLATE_BRIEF,
      bodyParams: [],
    });
    return {
      sent: true,
      via: "template",
      template: TEMPLATE_BRIEF,
    };
  } catch (error) {
    await releaseNotificationDay(
      supabase,
      tenant.id,
      agent.id,
      today,
      agent.last_brief_sent_on
    );
    return { sent: false, reason: error.message };
  }
}

export async function sendRequestedMorningBrief({
  supabase,
  tenant,
  agent,
  sendText = sendCloudText,
}) {
  const toWaId = String(agent.wa_id || "").replace(/\D/g, "");
  if (!toWaId) return { sent: false, reason: "no_agent_wa_id" };

  const built = await buildMorningBrief(supabase, {
    tenantId: tenant.id,
    agent,
  });
  try {
    await sendText({
      phoneNumberId: tenant.phone_number_id,
      businessToken: tenant.business_token,
      toWaId,
      body: built.body,
    });
    return { sent: true, via: "text", count: built.count, body: built.body };
  } catch (error) {
    return { sent: false, reason: error.message, count: built.count };
  }
}

export function briefDueToday(agent, now = new Date()) {
  if (!agent?.brief_enabled) return false;
  if (agent.last_brief_sent_on === now.toISOString().slice(0, 10)) return false;
  const tz = agent.tz || "Asia/Dubai";
  const time = String(agent.brief_time || "07:30").slice(0, 5);
  const [hh, mm] = time.split(":").map((n) => Number(n));
  let local;
  try {
    local = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    return false;
  }
  const pick = (type) => Number(local.find((p) => p.type === type)?.value);
  const localMinutes = pick("hour") * 60 + pick("minute");
  const dueMinutes = (Number.isFinite(hh) ? hh : 7) * 60 + (Number.isFinite(mm) ? mm : 30);
  return localMinutes >= dueMinutes;
}
