import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;
    const id = await routeId(params);

    const { data: batch } = await supabase
      .from("call_batches")
      .select("id, tenant_id")
      .eq("id", id)
      .maybeSingle();
    if (!batch || batch.tenant_id !== session.tenantId) {
      return jsonError("Run not found.", 404);
    }

    const { data: calls, error } = await supabase
      .from("calls")
      .select(
        "status, summary, qualification, created_at, leads(push_name, wa_id), jarvis_leads(push_name, wa_id)"
      )
      .eq("tenant_id", session.tenantId)
      .eq("batch_id", id);
    if (error) throw new Error(error.message);

    const header = ["name", "phone", "status", "intent", "budget", "areas", "timeline", "summary"];
    const lines = [header.join(",")];
    for (const call of calls || []) {
      const person = call.leads || call.jarvis_leads || {};
      const q = call.qualification || {};
      const cells = [
        person.push_name || "",
        person.wa_id ? `+${person.wa_id}` : "",
        call.status || "",
        q.intent || "",
        q.budget_aed || "",
        Array.isArray(q.areas) ? q.areas.join(";") : "",
        q.timeline || "",
        call.summary || "",
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="run-${id.slice(0, 8)}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
