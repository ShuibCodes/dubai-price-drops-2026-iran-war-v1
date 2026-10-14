import { consoleContext, jsonError } from "@/lib/console/http";
import { FeedbackError } from "@/lib/feedback/access";
import {
  createTenantTicket,
  listTenantTickets,
  publicTicket,
  rejectClientStaffFields,
} from "@/lib/feedback/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const tickets = await listTenantTickets(
      ctx.supabase,
      ctx.session.tenantId
    );
    return Response.json({ tickets });
  } catch (error) {
    return jsonError(error.message || "Unexpected error", error.status || 500);
  }
}

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const body = await request.json().catch(() => ({}));
    rejectClientStaffFields(body);
    const ticket = await createTenantTicket(ctx.supabase, ctx.session, body);
    return Response.json({ ticket: publicTicket(ticket) }, { status: 201 });
  } catch (error) {
    const status = error instanceof FeedbackError ? error.status : error.status || 500;
    return jsonError(error.message || "Unexpected error", status);
  }
}
