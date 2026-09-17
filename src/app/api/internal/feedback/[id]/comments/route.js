import { jsonError } from "@/lib/console/http";
import { internalContext } from "@/lib/internal/http";
import { routeId } from "@/lib/scripts/http";
import { FeedbackError } from "@/lib/feedback/access";
import {
  addTicketComment,
  loadStaffTicket,
  publicComment,
} from "@/lib/feedback/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const ctx = await internalContext(request);
    if (ctx.response) return ctx.response;
    const id = await routeId(params);
    const ticket = await loadStaffTicket(ctx.supabase, id);
    const body = await request.json().catch(() => ({}));
    const comment = await addTicketComment(ctx.supabase, {
      tenantId: ticket.tenant_id,
      ticketId: ticket.id,
      authorKind: "staff",
      body: body.body,
    });
    return Response.json({ comment: publicComment(comment) }, { status: 201 });
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}
