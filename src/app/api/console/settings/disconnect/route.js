import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    if (ctx.session.role !== "admin") {
      return jsonError("Disconnect requires an admin.", 403);
    }
    const { session, supabase } = ctx;

    const { error } = await supabase
      .from("tenants")
      .update({
        waba_id: null,
        phone_number_id: null,
        business_token: null,
      })
      .eq("id", session.tenantId);
    if (error) throw new Error(error.message);
    await supabase
      .from("tenants")
      .update({ display_phone: null })
      .eq("id", session.tenantId);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
