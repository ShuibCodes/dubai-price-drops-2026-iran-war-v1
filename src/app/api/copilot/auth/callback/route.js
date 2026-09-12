import { NextResponse } from "next/server";
import { syncAgentClaims } from "@/lib/copilot/auth-claims";
import { safeNextPath } from "@/lib/copilot/next-path";
import {
  isSocialProviderConfigured,
  resolveOrProvisionSocialAgent,
  socialAuthErrorCode,
  verifiedSocialIdentity,
} from "@/lib/copilot/social-auth";
import { oauthLoginRedirect, oauthOrigin } from "@/lib/copilot/oauth-route";
import {
  COPILOT_SESSION_COOKIE,
  copilotSessionCookieOptions,
} from "@/lib/copilot-auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createRouteAuthClient,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/auth-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!isSupabaseAuthConfigured()) {
    return oauthLoginRedirect(request, "social_unavailable");
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  if (params.get("error") || !code) {
    return oauthLoginRedirect(request, "social_failed");
  }

  const { supabase, applyTo } = createRouteAuthClient(request);

  // Any rejection past this point must drop the half-built session, otherwise an
  // rejected social account keeps a valid Supabase cookie.
  async function deny(code) {
    const response = oauthLoginRedirect(request, code);
    try {
      const { error } = await supabase.auth.signOut();
      if (!error) return applyTo(response);
      console.error("[copilot/auth/callback] sign-out failed", error.message);
    } catch (error) {
      console.error("[copilot/auth/callback] sign-out failed", error?.message);
    }

    // Do not apply pending exchange cookies if revocation failed. Expire every
    // Supabase cookie already present on the request as a second fail-closed
    // barrier; this includes chunked sessions and the PKCE verifier.
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
      }
    }
    return response;
  }

  let provider = "social";
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const user = data?.user;
    if (error || !user) {
      console.error("[copilot/auth/callback] exchange failed", error?.message);
      return deny("social_failed");
    }

    const identity = verifiedSocialIdentity(user, params.get("provider"));
    if (!identity) {
      return deny("social_unverified");
    }
    provider = identity.provider;
    if (!isSocialProviderConfigured(provider)) {
      return deny(`${provider}_unavailable`);
    }

    const admin = getSupabaseServerClient();
    if (!admin) return deny("social_unavailable");

    const agent = await resolveOrProvisionSocialAgent(admin, {
      authUserId: user.id,
      email: identity.email,
      displayName: identity.displayName,
    });
    const tenantSlug = agent.tenant_slug;
    await syncAgentClaims(admin, user.id, agent, tenantSlug);

    // Claims are minted into the JWT, so the token from the exchange predates
    // them. Middleware's tenant gate reads them, so refresh before redirecting.
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) {
      console.error("[copilot/auth/callback] refresh failed", refreshed.error.message);
      return deny(`${provider}_failed`);
    }

    await admin
      .from("agents")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", agent.id);

    // A newly-created owner always enters setup. Client-controlled next is only
    // considered for identities that already belonged to an AgentZero agent.
    const target = agent.was_created
      ? `/copilot/${encodeURIComponent(tenantSlug)}/join`
      : safeNextPath(params.get("next"), tenantSlug);
    const response = NextResponse.redirect(new URL(target, oauthOrigin(request)));

    // The Supabase session now owns this browser's identity; a leftover legacy
    // cookie for a different agent would only sow confusion after logout.
    if (request.cookies.get(COPILOT_SESSION_COOKIE)) {
      response.cookies.set(COPILOT_SESSION_COOKIE, "", {
        ...copilotSessionCookieOptions(),
        maxAge: 0,
      });
    }

    return applyTo(response);
  } catch (error) {
    console.error("[copilot/auth/callback]", error?.message);
    return deny(socialAuthErrorCode(error, provider));
  }
}
