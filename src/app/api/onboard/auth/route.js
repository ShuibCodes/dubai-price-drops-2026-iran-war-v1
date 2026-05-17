import { NextResponse } from "next/server";
import {
  createOnboardSessionToken,
  onboardSessionCookieOptions,
  ONBOARD_SESSION_COOKIE,
  verifyOnboardCredentials,
} from "@/lib/onboard-auth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const username = body?.username;
    const password = body?.password;

    if (!verifyOnboardCredentials(username, password)) {
      return NextResponse.json(
        { ok: false, error: "Invalid username or password." },
        { status: 401 }
      );
    }

    const token = createOnboardSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
      ONBOARD_SESSION_COOKIE,
      token,
      onboardSessionCookieOptions()
    );
    return response;
  } catch (error) {
    console.error("Onboard auth error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error?.message?.includes("ONBOARD_AUTH")
            ? "Login is not configured on the server."
            : "Unable to sign in.",
      },
      { status: 500 }
    );
  }
}
