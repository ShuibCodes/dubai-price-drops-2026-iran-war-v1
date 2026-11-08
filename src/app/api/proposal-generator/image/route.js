import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_HOST_HINTS = [
  "propertyfinder",
  "bayut",
  "dubizzle",
  "cloudinary",
  "imgix",
  "akamai",
  "cdn",
  "amazonaws.com",
  "googleusercontent.com",
  "fbcdn",
  "twimg",
];

function isAllowedImageUrl(raw) {
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_HOST_HINTS.some((hint) => host.includes(hint))) return true;
    // Allow any https image host that looks like media, but block localhost/private IPs
    if (
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|0\.0\.0\.0)/i.test(
        host
      )
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  if (!isAllowedImageUrl(imageUrl)) {
    return NextResponse.json({ error: "Image URL not allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentZeroProposalBot/1.0; +https://agentzero.ae)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: new URL(imageUrl).origin,
      },
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream image failed (${upstream.status})` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
      return NextResponse.json(
        { error: "URL did not return an image" },
        { status: 400 }
      );
    }

    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to proxy image" },
      { status: 502 }
    );
  }
}
