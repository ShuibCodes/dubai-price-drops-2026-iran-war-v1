import { COPILOT_LOGIN_PATH } from "@/lib/copilot-auth-constants";
import { startCalendarConnect } from "@/lib/calendar/oauth";
import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const ctx = await consoleContext(request);
    if (ctx.response) {
      if (ctx.response.status === 401) {
        return Response.redirect(new URL(COPILOT_LOGIN_PATH, request.url), 302);
      }
      return ctx.response;
    }
    const next = new URL(request.url).searchParams.get("next");
    const started = startCalendarConnect(ctx.session, { returnTo: next });
    if (started.error) {
      return jsonError(started.error, started.status || 500);
    }
    return Response.redirect(started.url, 302);
  } catch (error) {
    return jsonError(error.message || "Could not start Google Calendar connect.", 500);
  }
}
