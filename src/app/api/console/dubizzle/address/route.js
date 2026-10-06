import { consoleContext, jsonError } from "@/lib/console/http";
import { allocateInboundEmail } from "@/lib/dubizzle/inbound-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const { session, supabase } = ctx;

    const inboundEmail = await allocateInboundEmail(supabase, session.tenantId);
    return Response.json({
      inbound_email: inboundEmail,
      tenant: session.tenantSlug,
    });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}
