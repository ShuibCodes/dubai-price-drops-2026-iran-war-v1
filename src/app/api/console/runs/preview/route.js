import { consoleContext, jsonError } from "@/lib/console/http";
import { previewRunMatch } from "@/lib/console/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const body = await request.json().catch(() => ({}));
    const result = await previewRunMatch(ctx.supabase, {
      tenantId: ctx.session.tenantId,
      sourceType: body.source_type || "whatsapp",
      areas: body.areas || [],
      bedrooms: body.bedrooms || "",
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
