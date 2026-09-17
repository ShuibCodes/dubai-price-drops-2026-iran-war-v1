import { jsonError } from "@/lib/console/http";
import { internalContext } from "@/lib/internal/http";
import { routeId } from "@/lib/scripts/http";
import { FeedbackError } from "@/lib/feedback/access";
import {
  listTicketAttachments,
  listTicketComments,
  loadStaffTicket,
  publicAttachment,
  publicComment,
  publicTicket,
  updateStaffTicket,
} from "@/lib/feedback/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function staffPayload(ticket, comments, attachments) {
  return {
    ticket: {
      ...publicTicket(ticket, { staff: true }),
      tenant_slug: ticket.tenants?.slug || null,
      tenant_name: ticket.tenants?.name || null,
    },
    comments: comments.map(publicComment),
    attachments: attachments.map(publicAttachment),
  };
}

export async function GET(request, { params }) {
  try {
    const ctx = await internalContext(request);
    if (ctx.response) return ctx.response;
    const id = await routeId(params);
    const ticket = await loadStaffTicket(ctx.supabase, id);
    const [comments, attachments] = await Promise.all([
      listTicketComments(ctx.supabase, ticket.tenant_id, ticket.id),
      listTicketAttachments(ctx.supabase, ticket.tenant_id, ticket.id),
    ]);
    return Response.json(staffPayload(ticket, comments, attachments));
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}

export async function PATCH(request, { params }) {
  try {
    const ctx = await internalContext(request);
    if (ctx.response) return ctx.response;
    const id = await routeId(params);
    const body = await request.json().catch(() => ({}));
    const ticket = await updateStaffTicket(ctx.supabase, id, body);
    return Response.json({
      ticket: {
        ...publicTicket(ticket, { staff: true }),
        tenant_slug: ticket.tenants?.slug || null,
        tenant_name: ticket.tenants?.name || null,
      },
    });
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}
