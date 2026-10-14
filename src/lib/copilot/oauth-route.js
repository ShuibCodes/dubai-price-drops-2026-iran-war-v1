import { NextResponse } from "next/server";
import { COPILOT_LOGIN_PATH } from "@/lib/copilot-auth-constants";
import { isSocialProviderConfigured } from "@/lib/copilot/social-auth";
import { createRouteAuthClient } from "@/lib/supabase/auth-server";

export function oauthOrigin(request) {
  const configured = String(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ""
  ).trim();
  return configured ? configured.replace(/\/+$/, "") : request.nextUrl.origin;
}

export function oauthLoginRedirect(request, code) {
  const url = new URL(COPILOT_LOGIN_PATH, oauthOrigin(request));
  if (code) url.searchParams.set("error", code);
  return NextResponse.redirect(url);
}

export function createOAuthHandler(provider) {
  return async function GET(request) {
    if (!isSocialProviderConfigured(provider)) {
      return oauthLoginRedirect(request, `${provider}_unavailable`);
    }

    try {
      const callback = new URL("/api/copilot/auth/callback", oauthOrigin(request));
      callback.searchParams.set("provider", provider);
      const next = request.nextUrl.searchParams.get("next");
      if (next && next.startsWith("/copilot/") && !next.startsWith("//")) {
        callback.searchParams.set("next", next);
      }

      const { supabase, applyTo } = createRouteAuthClient(request);
      const options = {
        redirectTo: callback.toString(),
        skipBrowserRedirect: true,
      };
      if (provider === "google") {
        options.queryParams = { prompt: "select_account" };
      } else if (provider === "facebook") {
        // Facebook does not return an email unless this permission is granted.
        // The callback still verifies that the returned identity owns it.
        options.scopes = "email";
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options,
      });
      if (error || !data?.url) {
        console.error(`[copilot/auth/${provider}] authorize failed`, error?.message);
        return oauthLoginRedirect(request, `${provider}_unavailable`);
      }

      // Carries the HttpOnly PKCE verifier cookie into the eventual callback.
      return applyTo(NextResponse.redirect(data.url));
    } catch (error) {
      console.error(`[copilot/auth/${provider}]`, error?.message);
      return oauthLoginRedirect(request, `${provider}_unavailable`);
    }
  };
}
