import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UAE2_BASE = "https://uae-real-estate2.p.rapidapi.com";

export async function GET(request) {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost =
    process.env.RAPIDAPI_HOST_UAE_REAL_ESTATE2 ?? "uae-real-estate2.p.rapidapi.com";

  if (!apiKey) {
    return NextResponse.json({ error: "Missing RAPIDAPI_KEY" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query")?.trim();

  if (!query) {
    return NextResponse.json({ error: "query parameter is required" }, { status: 400 });
  }

  const page = searchParams.get("page") ?? "0";
  const langs = searchParams.get("langs") ?? "en";

  const upstream = new URL(`${UAE2_BASE}/locations_search`);
  upstream.searchParams.set("query", query);
  upstream.searchParams.set("page", page);
  upstream.searchParams.set("langs", langs);

  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        "x-rapidapi-host": apiHost,
        "x-rapidapi-key": apiKey,
      },
      cache: "no-store",
      next: { revalidate: 0 },
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Upstream returned non-JSON", status: response.status },
        { status: 502 }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.message ?? "Upstream error", status: response.status },
        { status: response.status >= 400 && response.status < 600 ? response.status : 502 }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("locations_search proxy error", error);
    return NextResponse.json({ error: error.message ?? "Proxy failed" }, { status: 502 });
  }
}
