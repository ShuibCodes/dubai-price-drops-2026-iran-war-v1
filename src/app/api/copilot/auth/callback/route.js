import { NextResponse } from "next/server";
import {
  findAgentByEmail,
  linkAgentToAuthUser,
  syncAgentClaims,
} from "@/lib/copilot/auth-claims";
import { safeNextPath } from "@/lib/copilot/next-path";
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

function origin(request) {
  const configured = String(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ""
  ).trim();
  return configured ? configured.replace(/\/+$/, "") : request.nextUrl.origin;
}

function loginUrl(request, code) {
  const url = new URL("/copilot/login", origin(request));
  if (code) url.searchParams.set("error", code);
  return url;
}

/**
 * Google is the only enabled provider and always asserts a verified address,
 * but the check is explicit because the email is the whole allowlist key.
 * Verification must belong to the identity that owns user.email — a verified
 * flag on some *other* linked identity says nothing about this address.
 */
function emailIsVerified(user) {
  if (!user?.email) return false;
  if (user.email_confirmed_at) return true;
  const address = user.email.toLowerCase();
  return (user.identities || []).some(
    (identity) =>
      identity?.identity_data?.email_verified === true &&
      String(identity?.identity_data?.email || "").toLowerCase() === address
  );
}

export async function GET(request) {
  if (!isSupabaseAuthConfigured()) {
    return NextResponse.redirect(loginUrl(request, "google_unavailable"));
  }

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  if (params.get("error") || !code) {
    return NextResponse.redirect(loginUrl(request, "google_failed"));
  }

  const { supabase, applyTo } = createRouteAuthClient(request);

  // Any rejection past this point must drop the half-built session, otherwise an
  // unauthorised Google account keeps a valid Supabase cookie.
  async function deny(code) {
    await supabase.auth.signOut();
    return applyTo(NextResponse.redirect(loginUrl(request, code)));
  }

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const user = data?.user;
    if (error || !user) {
      console.error("[copilot/auth/callback] exchange failed", error?.message);
      return deny("google_failed");
    }

    if (!user.email || !emailIsVerified(user)) {
      return deny("google_unverified");
    }

    const admin = getSupabaseServerClient();
    if (!admin) return deny("google_unavailable");

    let agent = await findAgentByEmail(admin, user.email);
    if (!agent?.tenants?.slug) {
      console.warn("[copilot/auth/callback] no agent for verified Google identity");
      return deny("not_authorised");
    }

    if (!agent.auth_user_id) {
      const linked = await linkAgentToAuthUser(admin, agent.id, user.id);
      if (!linked) agent = await findAgentByEmail(admin, user.email);
    }
    if (agent?.auth_user_id !== user.id) {
      console.warn("[copilot/auth/callback] agent already linked to another auth user", {
        agentId: agent?.id,
      });
      return deny("link_conflict");
    }

    const tenantSlug = agent.tenants.slug;
    await syncAgentClaims(admin, user.id, agent, tenantSlug);

    // Claims are minted into the JWT, so the token from the exchange predates
    // them. Middleware's tenant gate reads them, so refresh before redirecting.
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) {
      console.error("[copilot/auth/callback] refresh failed", refreshed.error.message);
      return deny("google_failed");
    }

    await admin
      .from("agents")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", agent.id);

    const target = safeNextPath(params.get("next"), tenantSlug);
    const response = NextResponse.redirect(new URL(target, origin(request)));

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
    return deny("google_failed");
  }
}
