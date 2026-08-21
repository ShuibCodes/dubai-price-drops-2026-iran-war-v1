import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const { data, error } = await supabase
      .from("leads")
      .select("push_name, wa_id, source, budget, areas, bedrooms, timeline, opted_out, last_message_at")
      .eq("tenant_id", session.tenantId)
      .order("last_message_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const header = [
      "name",
      "phone",
      "source",
      "budget",
      "areas",
      "bedrooms",
      "timeline",
      "opted_out",
      "last_message_at",
    ];
    const lines = [header.join(",")];
    for (const row of data || []) {
      const cells = [
        row.push_name || "",
        row.wa_id ? `+${row.wa_id}` : "",
        row.source || "",
        row.budget ?? "",
        Array.isArray(row.areas) ? row.areas.join(";") : "",
        row.bedrooms || "",
        row.timeline || "",
        row.opted_out ? "true" : "false",
        row.last_message_at || "",
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leads-${session.tenantSlug}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
