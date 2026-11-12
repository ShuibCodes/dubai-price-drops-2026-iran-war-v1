import { consoleContext, jsonError } from "@/lib/console/http";
import { retireInboundEmail } from "@/lib/dubizzle/inbound-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    if (ctx.session.role !== "admin") {
      return jsonError("Regenerating the inbound address requires an admin.", 403);
    }
    const { session, supabase } = ctx;

    const inboundEmail = await retireInboundEmail(supabase, session.tenantId);
    return Response.json({
      inbound_email: inboundEmail,
      tenant: session.tenantSlug,
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
