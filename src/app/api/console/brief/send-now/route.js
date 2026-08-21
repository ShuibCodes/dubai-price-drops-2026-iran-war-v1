import { sendMorningBrief } from "@/lib/brief/send";
import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const [{ data: tenant, error: tenantError }, { data: agent, error: agentError }] =
      await Promise.all([
        supabase
          .from("tenants")
          .select("id, phone_number_id, business_token, waba_id")
          .eq("id", session.tenantId)
          .maybeSingle(),
        supabase
          .from("agents")
          .select("id, name, wa_id, tz, brief_enabled")
          .eq("id", session.agentId)
          .eq("tenant_id", session.tenantId)
          .maybeSingle(),
      ]);
    if (tenantError) throw new Error(tenantError.message);
    if (agentError) throw new Error(agentError.message);
    if (!agent) return jsonError("Agent not found.", 404);

    const result = await sendMorningBrief({ supabase, tenant, agent });
    if (!result.sent) {
      return jsonError(result.reason || "Could not send the brief.", 502, result);
    }
    return Response.json(result);
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
