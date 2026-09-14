import { actionsCallGuard } from "@/lib/actions/call-guard";
import { getSession } from "@/lib/copilot/session";
import { getTargetLead, startTargetLeadCall } from "@/lib/vapi/client";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    let session = null;
    try {
      session = await getSession(request);
    } catch (error) {
      if (error.status === 403) {
        return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      throw error;
    }
    const gate = actionsCallGuard(session);
    if (!gate.ok) {
      return Response.json({ ok: false, error: gate.error }, { status: gate.status });
    }

    const body = await request.json().catch(() => ({}));
    const requestedLead = String(body?.lead || "").toLowerCase();

    if (!["shuayb", "ahmed"].includes(requestedLead)) {
      return Response.json(
        { error: "Only lead='shuayb' is supported in this v1 flow." },
        { status: 400 }
      );
    }

    const lead = getTargetLead();
    const result = await startTargetLeadCall();

    return Response.json({
      ok: true,
      lead,
      callId: result.callId,
      status: result.status,
      leadContext: result.leadContext,
      message: `Call started for ${lead.name} at ${lead.phoneNumber}.${result.leadContext?.listing_area ? ` Context: listing_area=${result.leadContext.listing_area}.` : ""}`,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error?.message || "Unable to start call",
      },
      { status: 500 }
    );
  }
}
