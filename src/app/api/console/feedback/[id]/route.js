import { consoleContext, jsonError } from "@/lib/console/http";
import { routeId } from "@/lib/scripts/http";
import { FeedbackError } from "@/lib/feedback/access";
import {
  listTicketAttachments,
  listTicketComments,
  loadTenantTicket,
  publicAttachment,
  publicComment,
  publicTicket,
} from "@/lib/feedback/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const id = await routeId(params);
    const ticket = await loadTenantTicket(
      ctx.supabase,
      ctx.session.tenantId,
      id
    );
    const [comments, attachments] = await Promise.all([
      listTicketComments(ctx.supabase, ctx.session.tenantId, ticket.id),
      listTicketAttachments(ctx.supabase, ctx.session.tenantId, ticket.id),
    ]);
    return Response.json({
      ticket: publicTicket(ticket),
      comments: comments.map(publicComment),
      attachments: attachments.map(publicAttachment),
    });
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}
