import { NextResponse } from "next/server";
import { COPILOT_LOGIN_PATH } from "@/lib/copilot-auth-constants";
import {
  createRouteAuthClient,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches dial.js: APP_URL wins so the redirect URI is stable behind a proxy. */
function origin(request) {
  const configured = String(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ""
  ).trim();
  return configured ? configured.replace(/\/+$/, "") : request.nextUrl.origin;
}

function loginRedirect(request, code) {
  // Directly to the login page — the /copilot/login stub drops ?error=.
  const url = new URL(COPILOT_LOGIN_PATH, origin(request));
  if (code) url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export async function GET(request) {
  if (!isSupabaseAuthConfigured()) {
    return loginRedirect(request, "google_unavailable");
  }

  try {
    const base = origin(request);
    const callback = new URL("/api/copilot/auth/callback", base);
    const next = request.nextUrl.searchParams.get("next");
    if (next && next.startsWith("/copilot/") && !next.startsWith("//")) {
      callback.searchParams.set("next", next);
    }

    const { supabase, applyTo } = createRouteAuthClient(request);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        skipBrowserRedirect: true,
        // Agents have personal and work Google accounts; never silently reuse one.
        queryParams: { prompt: "select_account" },
      },
    });

    if (error || !data?.url) {
      console.error("[copilot/auth/google] authorize failed", error?.message);
      return loginRedirect(request, "google_unavailable");
    }

    // applyTo carries the PKCE verifier cookie; without it the exchange fails.
    return applyTo(NextResponse.redirect(data.url));
  } catch (error) {
    console.error("[copilot/auth/google]", error?.message);
    return loginRedirect(request, "google_unavailable");
  }
}
