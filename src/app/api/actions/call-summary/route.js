import { getLatestTargetLeadCallSummary } from "@/lib/vapi/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await getLatestTargetLeadCallSummary();
    if (!result.found) {
      return Response.json(
        {
          ok: true,
          found: false,
          message: result.message,
        },
        { status: 200 }
      );
    }

    return Response.json({
      ok: true,
      found: true,
      callId: result.callId,
      status: result.status,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      summary: result.summary,
      transcript: result.transcript,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Unable to fetch call summary",
      },
      { status: 500 }
    );
  }
}
