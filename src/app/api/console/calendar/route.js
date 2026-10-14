import { disconnectCalendar, getCalendarStatus } from "@/lib/calendar/oauth";
import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const status = await getCalendarStatus(ctx.supabase, ctx.session);
    if (status.error) return jsonError(status.error, status.status || 500);
    return Response.json(status);
  } catch (error) {
    return jsonError(error.message || "Could not load calendar.", error.status || 500);
  }
}

export async function POST(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) return ctx.response;
    const status = await disconnectCalendar(ctx.supabase, ctx.session);
    if (status.error) return jsonError(status.error, status.status || 500);
    return Response.json(status);
  } catch (error) {
    return jsonError(error.message || "Could not disconnect calendar.", error.status || 500);
  }
}
