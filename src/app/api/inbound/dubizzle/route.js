import { waitUntil } from "@vercel/functions";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { handleDubizzleInbound } from "@/lib/dubizzle/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Public Resend inbound webhook. Not under Copilot middleware.
 * Acknowledges quickly; body fetch is scheduled with waitUntil.
 */
export async function POST(request) {
  const rawBody = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") || request.headers.get("webhook-id"),
    "svix-timestamp":
      request.headers.get("svix-timestamp") ||
      request.headers.get("webhook-timestamp"),
    "svix-signature":
      request.headers.get("svix-signature") ||
      request.headers.get("webhook-signature"),
  };

  const result = await handleDubizzleInbound({
    rawBody,
    headers,
    supabase: getSupabaseServerClient(),
    waitUntil,
  });

  return Response.json(result.body, { status: result.status });
}
