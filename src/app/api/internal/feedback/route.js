import { jsonError } from "@/lib/console/http";
import { internalContext } from "@/lib/internal/http";
import { FeedbackError } from "@/lib/feedback/access";
import { isFeedbackStatus, isFeedbackType } from "@/lib/feedback/constants";
import { listStaffTickets } from "@/lib/feedback/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await internalContext(request);
    if (ctx.response) return ctx.response;
    const url = new URL(request.url);
    const tenantId = String(url.searchParams.get("tenant") || "").trim();
    const type = String(url.searchParams.get("type") || "").trim();
    const status = String(url.searchParams.get("status") || "").trim();
    const tickets = await listStaffTickets(ctx.supabase, {
      tenantId: tenantId || undefined,
      type: type && isFeedbackType(type) ? type : undefined,
      status: status && isFeedbackStatus(status) ? status : undefined,
    });
    return Response.json({ tickets });
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}
