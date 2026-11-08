import { createClient } from "@supabase/supabase-js";
import { processMeetingReminders } from "@/lib/calendar/reminders";
import { timingSafeEqual } from "@/lib/security/timing-safe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request) {
  const expected = process.env.CRON_SECRET || process.env.CALL_QUEUE_CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-cron-secret");
  return timingSafeEqual(provided, expected);
}

export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return Response.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const outcome = await processMeetingReminders({ supabase });
    return Response.json(outcome);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request) {
  if (!authorized(request)) {
    return Response.json({
      ok: true,
      message: "Meeting reminders cron is healthy. POST with secret to trigger run.",
    });
  }
  return POST(request);
}
