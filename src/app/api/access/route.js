import { NextResponse } from "next/server";
import { hasLifetimeAccess } from "@/lib/access-store";

export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  return NextResponse.json({
    hasLifetimeAccess: await hasLifetimeAccess(email),
  });
}
