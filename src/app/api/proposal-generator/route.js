import { NextResponse } from "next/server";
import {
  scrapeListingForProposal,
  validateListingUrl,
} from "@/lib/proposal/scrape-listing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

function proxyImageUrl(request, imageUrl) {
  const origin = new URL(request.url).origin;
  return `${origin}/api/proposal-generator/image?url=${encodeURIComponent(imageUrl)}`;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const listingUrl = typeof body?.url === "string" ? body.url.trim() : "";
  const agentName = typeof body?.agentName === "string" ? body.agentName.trim() : "";
  const companyName =
    typeof body?.companyName === "string" ? body.companyName.trim() : "";
  const agentPhone =
    typeof body?.agentPhone === "string" ? body.agentPhone.trim() : "";

  const validated = validateListingUrl(listingUrl);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  if (!agentName) {
    return NextResponse.json(
      { error: "Please enter your name." },
      { status: 400 }
    );
  }
  if (!companyName) {
    return NextResponse.json(
      { error: "Please enter your agency / company name." },
      { status: 400 }
    );
  }

  try {
    const listing = await scrapeListingForProposal(validated.url);
    const images = (listing.images || []).map((imageUrl) =>
      proxyImageUrl(request, imageUrl)
    );

    return NextResponse.json({
      ok: true,
      listing: {
        ...listing,
        images,
        originalImages: listing.images || [],
      },
      agent: {
        name: agentName,
        company: companyName,
        phone: agentPhone || null,
      },
    });
  } catch (error) {
    const message = error?.message || "Failed to generate proposal.";
    const status = /FIRECRAWL_API_KEY|Missing/i.test(message) ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
