import { NextResponse } from "next/server";
import {
  ONBOARD_SESSION_COOKIE,
  verifyOnboardSessionTokenEdge,
} from "@/lib/onboard-auth-edge";

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isOnboardPage =
    pathname === "/onboard" || pathname.startsWith("/onboard/");
  const isOnboardApi = pathname.startsWith("/api/onboard");

  if (!isOnboardPage && !isOnboardApi) {
    return NextResponse.next();
  }

  if (pathname === "/onboard/login" || pathname === "/api/onboard/auth") {
    return NextResponse.next();
  }

  const token = request.cookies.get(ONBOARD_SESSION_COOKIE)?.value;
  if (token && (await verifyOnboardSessionTokenEdge(token))) {
    return NextResponse.next();
  }

  if (isOnboardApi) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/onboard/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/onboard", "/onboard/:path*", "/api/onboard", "/api/onboard/:path*"],
};
