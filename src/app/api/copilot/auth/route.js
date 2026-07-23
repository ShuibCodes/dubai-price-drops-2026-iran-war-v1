import { NextResponse } from "next/server";
import {
  COPILOT_SESSION_COOKIE,
  copilotSessionCookieOptions,
  createCopilotSessionToken,
  verifyCopilotCredentials,
} from "@/lib/copilot-auth";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const user = verifyCopilotCredentials(body?.username, body?.password);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Invalid login." },
        { status: 401 }
      );
    }

    const token = createCopilotSessionToken({
      username: user.username,
      tenantSlug: user.tenantSlug,
    });
    const response = NextResponse.json({
      ok: true,
      tenantSlug: user.tenantSlug,
    });
    response.cookies.set(COPILOT_SESSION_COOKIE, token, copilotSessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Copilot auth error:", error?.message);
    return NextResponse.json(
      {
        ok: false,
        error: error?.message?.includes("COPILOT")
          ? "Login is not configured on the server."
          : "Unable to sign in.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COPILOT_SESSION_COOKIE, "", {
    ...copilotSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
