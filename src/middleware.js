import { NextResponse } from "next/server";
import {
  ONBOARD_SESSION_COOKIE,
  verifyOnboardSessionTokenEdge,
} from "@/lib/onboard-auth-edge";
import {
  COPILOT_SESSION_COOKIE,
  tenantSlugFromCopilotPath,
  verifyCopilotSessionTokenEdge,
} from "@/lib/copilot-auth-edge";
import { tenantSlugFromClaims } from "@/lib/copilot/auth-claims";
import {
  carryAuthCookies,
  createMiddlewareAuthClient,
  isSupabaseAuthConfigured,
} from "@/lib/supabase/auth-server";

async function handleOnboard(request, pathname, isApi) {
  if (pathname === "/onboard/login" || pathname === "/api/onboard/auth") {
    return NextResponse.next();
  }

  const token = request.cookies.get(ONBOARD_SESSION_COOKIE)?.value;
  if (token && (await verifyOnboardSessionTokenEdge(token))) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/onboard/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

async function handleCopilot(request, pathname, isApi) {
  // /api/copilot/auth, /auth/google and /auth/callback all run pre-session.
  if (pathname === "/copilot/login" || pathname.startsWith("/api/copilot/auth")) {
    return NextResponse.next();
  }

  let response = NextResponse.next();
  let tenantFromSession = null;
  let authenticated = false;

  if (isSupabaseAuthConfigured()) {
    try {
      const { supabase, holder } = createMiddlewareAuthClient(request, NextResponse);
      const { data } = await supabase.auth.getUser();
      response = holder.response;
      if (data?.user) {
        authenticated = true;
        tenantFromSession = tenantSlugFromClaims(data.user);
      }
    } catch (error) {
      console.error("[middleware] supabase auth check failed", error?.message);
    }
  }

  if (!authenticated) {
    const token = request.cookies.get(COPILOT_SESSION_COOKIE)?.value;
    const session = token ? await verifyCopilotSessionTokenEdge(token) : null;
    if (session) {
      authenticated = true;
      tenantFromSession = session.tenantSlug;
    }
  }

  if (!authenticated) {
    if (isApi) {
      return carryAuthCookies(
        response,
        NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
      );
    }
    const loginUrl = new URL("/copilot/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return carryAuthCookies(response, NextResponse.redirect(loginUrl));
  }

  const pathTenant = tenantSlugFromCopilotPath(pathname);
  // A null slug means the JWT predates its claims. getSession() re-checks the
  // tenant against the agents row on every request, so defer rather than loop.
  if (pathTenant && tenantFromSession && pathTenant !== tenantFromSession) {
    if (isApi) {
      return carryAuthCookies(
        response,
        NextResponse.json(
          { ok: false, error: "Forbidden for this tenant." },
          { status: 403 }
        )
      );
    }
    return carryAuthCookies(
      response,
      NextResponse.redirect(
        new URL(`/copilot/${encodeURIComponent(tenantFromSession)}`, request.url)
      )
    );
  }

  return response;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isOnboardPage =
    pathname === "/onboard" || pathname.startsWith("/onboard/");
  const isOnboardApi = pathname.startsWith("/api/onboard");
  if (isOnboardPage || isOnboardApi) {
    return handleOnboard(request, pathname, isOnboardApi);
  }

  const isCopilotPage =
    pathname === "/copilot" || pathname.startsWith("/copilot/");
  const isCopilotApi = pathname.startsWith("/api/copilot");
  const isScriptsApi = pathname.startsWith("/api/scripts");
  const isConsoleApi = pathname.startsWith("/api/console");
  if (isCopilotPage || isCopilotApi || isScriptsApi || isConsoleApi) {
    return handleCopilot(request, pathname, isCopilotApi || isScriptsApi || isConsoleApi);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/onboard",
    "/onboard/:path*",
    "/api/onboard",
    "/api/onboard/:path*",
    "/copilot",
    "/copilot/:path*",
    "/api/copilot",
    "/api/copilot/:path*",
    "/api/scripts",
    "/api/scripts/:path*",
    "/api/console",
    "/api/console/:path*",
  ],
};
