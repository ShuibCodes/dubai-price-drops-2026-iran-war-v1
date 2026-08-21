import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";
import { sendAgentCloudMessage, TEMPLATE_RUN } from "@/lib/whatsapp/cloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const id = await routeId(params);

    const [{ data: batch }, { data: tenant }, { data: agent }] = await Promise.all([
      supabase
        .from("call_batches")
        .select("id, tenant_id, counts, scripts(display_name)")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("tenants")
        .select("id, phone_number_id, business_token")
        .eq("id", session.tenantId)
        .maybeSingle(),
      supabase
        .from("agents")
        .select("id, wa_id, name")
        .eq("id", session.agentId)
        .eq("tenant_id", session.tenantId)
        .maybeSingle(),
    ]);
    if (!batch || batch.tenant_id !== session.tenantId) {
      return jsonError("Run not found.", 404);
    }

    const { data: calls } = await supabase
      .from("calls")
      .select("qualification, leads(push_name), jarvis_leads(push_name)")
      .eq("tenant_id", session.tenantId)
      .eq("batch_id", id);

    const worth = (calls || []).filter((call) => {
      const q = call.qualification || {};
      return q.outcome === "qualified" || q.outcome === "callback" || q.lead_engaged;
    });
    const names = worth
      .map((call) => call.leads?.push_name || call.jarvis_leads?.push_name)
      .filter(Boolean)
      .slice(0, 8);
    const scriptName = batch.scripts?.display_name || "your script";
    const body = [
      `${worth.length} worth your time from ${scriptName}.`,
      names.length ? names.join(", ") : "Open the run in the console for recordings.",
    ].join(" ");

    const result = await sendAgentCloudMessage({
      tenant,
      toWaId: agent?.wa_id,
      body,
      templateName: TEMPLATE_RUN,
      templateParams: [String(worth.length), scriptName],
    });
    if (!result.sent) {
      return jsonError(result.reason || "Could not send to WhatsApp.", 502, result);
    }
    return Response.json({ ok: true, count: worth.length, ...result });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
