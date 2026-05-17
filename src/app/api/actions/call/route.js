import { getTargetLead, startTargetLeadCall } from "@/lib/vapi/client";

export const runtime = "nodejs";

export async function POST(request) {
  try {
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
