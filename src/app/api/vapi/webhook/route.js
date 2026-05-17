import { extractCallRecord, writeCallRecord } from "@/lib/kb/calls";
import { clearKbCache } from "@/lib/kb/loader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PERSISTED_EVENT_TYPES = new Set([
  "end-of-call-report",
  "call.ended",
  "call-end",
  "status-update",
]);

function verifySecret(request) {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided =
    request.headers.get("x-vapi-secret") ||
    request.headers.get("x-vapi-signature") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return provided === expected;
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "VAPI webhook is healthy. POST end-of-call-report payloads here.",
  });
}

export async function POST(request) {
  try {
    if (!verifySecret(request)) {
      return Response.json({ ok: false, error: "Invalid secret" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const eventType =
      payload?.message?.type ||
      payload?.type ||
      payload?.event ||
      "unknown";

    const shouldPersist =
      PERSISTED_EVENT_TYPES.has(String(eventType)) ||
      Boolean(payload?.message?.endedReason) ||
      Boolean(payload?.message?.summary) ||
      Boolean(payload?.message?.transcript);

    if (!shouldPersist) {
      return Response.json({ ok: true, persisted: false, eventType });
    }

    const record = extractCallRecord(payload);
    if (!record.summary && !record.transcript) {
      return Response.json({
        ok: true,
        persisted: false,
        eventType,
        reason: "No summary or transcript yet",
      });
    }

    const { fileName, fullPath } = writeCallRecord(record);
    clearKbCache();

    return Response.json({
      ok: true,
      persisted: true,
      eventType,
      callId: record.callId,
      leadName: record.leadName,
      fileName,
      fullPath,
    });
  } catch (error) {
    console.error("VAPI webhook error:", error);
    return Response.json(
      { ok: false, error: error?.message || "Webhook handler error" },
      { status: 500 }
    );
  }
}
