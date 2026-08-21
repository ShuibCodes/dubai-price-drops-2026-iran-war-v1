import {
  sendAgentCloudMessage,
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
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, push_name, wa_id, source, intent_score, budget, areas, last_message_at")
    .eq("tenant_id", tenantId)
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

export async function sendMorningBrief({ supabase, tenant, agent }) {
  const toWaId = String(agent.wa_id || "").replace(/\D/g, "");
  if (!toWaId) return { sent: false, reason: "no_agent_wa_id" };

  const built = await buildMorningBrief(supabase, {
    tenantId: tenant.id,
    agent,
  });
  const result = await sendAgentCloudMessage({
    tenant,
    toWaId,
    body: built.body,
    templateName: TEMPLATE_BRIEF,
    templateParams: [agent.name || "there", String(built.count)],
  });
  if (result.sent) {
    const today = new Date().toISOString().slice(0, 10);
    await supabase
      .from("agents")
      .update({ last_brief_sent_on: today })
      .eq("id", agent.id)
      .eq("tenant_id", tenant.id);
  }
  return { ...result, count: built.count, body: built.body };
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
