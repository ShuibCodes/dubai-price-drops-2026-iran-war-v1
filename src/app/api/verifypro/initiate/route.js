import { NextResponse } from "next/server";
import { fetchBrokerWithPhone } from "@/lib/property-finder-api";
import { fireVapiCall } from "@/lib/vapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const TEST_PHONE = "+971585690693";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  // Fetch a real broker with a phone number from PropertyFinder
  let listing;
  try {
    listing = await fetchBrokerWithPhone();
  } catch (error) {
    return NextResponse.json(
      { error: error.message ?? "Failed to fetch broker from PropertyFinder" },
      { status: 502 }
    );
  }

  // Pass the user's search query as area context for the AI script
  listing.area = query;

  // Fire Vapi — always calls test phone in Version A
  try {
    const result = await fireVapiCall({ listing, overridePhone: TEST_PHONE });
    return NextResponse.json({
      success: true,
      callId: result.id ?? null,
      phone: TEST_PHONE,
      listing,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message ?? "Vapi call failed" },
      { status: 502 }
    );
  }
}
