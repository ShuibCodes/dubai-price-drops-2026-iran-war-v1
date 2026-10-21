import {
  calendarReturnPath,
  completeCalendarCallback,
  settingsRedirect,
} from "@/lib/calendar/oauth";
import { COPILOT_LOGIN_PATH } from "@/lib/copilot-auth-constants";
import { consoleContext, jsonError } from "@/lib/console/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    const ctx = await consoleContext(request);
    if (ctx.response) {
      if (ctx.response.status === 401) {
        return Response.redirect(new URL(COPILOT_LOGIN_PATH, request.url), 302);
      }
      return ctx.response;
    }

    const result = await completeCalendarCallback(ctx.supabase, ctx.session, {
      code,
      state,
      error: oauthError,
    });
    if (result.redirect) {
      return Response.redirect(new URL(result.redirect, request.url), 302);
    }
    if (result.error) {
      const dest = calendarReturnPath(ctx.session.tenantSlug, "settings", "calendar=error");
      if (result.status === 403 || result.status === 400) {
        return Response.redirect(new URL(dest, request.url), 302);
      }
      return jsonError(result.error, result.status || 500);
    }
    return Response.redirect(
      new URL(settingsRedirect(ctx.session.tenantSlug, "calendar=error"), request.url),
      302
    );
  } catch (error) {
    console.error("[calendar/callback]", error.message);
    try {
      const ctx = await consoleContext(request);
      if (ctx.session?.tenantSlug) {
        return Response.redirect(
          new URL(settingsRedirect(ctx.session.tenantSlug, "calendar=error"), request.url),
          302
        );
      }
    } catch {
      // fall through
    }
    return jsonError("Calendar connection failed.", 500);
  }
}
