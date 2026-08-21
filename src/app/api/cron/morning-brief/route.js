import { createClient } from "@supabase/supabase-js";
import { briefDueToday, sendMorningBrief } from "@/lib/brief/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request) {
  const expected = process.env.CRON_SECRET || process.env.CALL_QUEUE_CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-cron-secret");
  return provided === expected;
}

export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: agents, error } = await supabase
    .from("agents")
    .select(
      "id, name, wa_id, tenant_id, brief_enabled, brief_time, tz, last_brief_sent_on, tenants(id, phone_number_id, business_token, waba_id)"
    )
    .eq("brief_enabled", true);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const results = [];
  for (const agent of agents || []) {
    if (!briefDueToday(agent, now)) continue;
    const tenant = agent.tenants;
    if (!tenant) continue;
    try {
      const sent = await sendMorningBrief({
        supabase,
        tenant,
        agent,
      });
      results.push({ agentId: agent.id, ...sent });
    } catch (err) {
      results.push({ agentId: agent.id, sent: false, reason: err.message });
    }
  }

  return Response.json({ ok: true, sent: results.filter((r) => r.sent).length, results });
}

export async function GET(request) {
  return POST(request);
}
