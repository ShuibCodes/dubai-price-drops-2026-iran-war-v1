import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ONBOARD_SESSION_COOKIE,
  verifyOnboardSessionToken,
} from "@/lib/onboard-auth";

export async function isOnboardSessionValid() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ONBOARD_SESSION_COOKIE)?.value;
  return Boolean(token && verifyOnboardSessionToken(token));
}

export function onboardUnauthorizedResponse() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}
