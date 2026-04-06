import { NextResponse } from "next/server";
import { buildDeveloperStats, normalizeSalesListing } from "@/lib/uae-sales-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UAE2_BASE = "https://uae-real-estate2.p.rapidapi.com";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGES = 3;

const DEFAULT_SEARCH_BODY = {
  purpose: "for-sale",
  categories: ["apartments", "villas"],
  locations_ids: [2],
  index: "popular",
  rooms: [0, 1, 2, 3, 4, 5],
  baths: [0, 1, 2, 3, 4],
  price_min: 400_000,
  price_max: 50_000_000,
  has_video: false,
  has_360_tour: false,
  has_floorplan: false,
  area_min: 200,
  area_max: 25_000,
  sale_type: "any",
};

const responseCache = new Map();

async function fetchPropertiesPage(apiKey, apiHost, page) {
  const url = new URL(`${UAE2_BASE}/properties_search`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("langs", "en");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": apiHost,
        "x-rapidapi-key": apiKey,
      },
      body: JSON.stringify(DEFAULT_SEARCH_BODY),
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Upstream properties_search returned non-JSON");
    }

    if (!response.ok) {
      throw new Error(json?.message ?? `properties_search failed ${response.status}`);
    }

    return Array.isArray(json.results) ? json.results : [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request) {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost =
    process.env.RAPIDAPI_HOST_UAE_REAL_ESTATE2 ?? "uae-real-estate2.p.rapidapi.com";

  if (!apiKey) {
    return NextResponse.json({ error: "Missing RAPIDAPI_KEY" }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "1";
  const requestedPagesRaw = Number.parseInt(searchParams.get("pages") ?? String(MAX_PAGES), 10);
  const requestedPages = Math.min(
    MAX_PAGES,
    Math.max(1, Number.isFinite(requestedPagesRaw) ? requestedPagesRaw : MAX_PAGES)
  );
  const cacheKey = String(requestedPages);
  const cachedEntry = responseCache.get(cacheKey) ?? null;

  if (!force && cachedEntry && Date.now() - cachedEntry.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      ...cachedEntry.payload,
      meta: {
        ...cachedEntry.payload.meta,
        servedFromCache: true,
        cacheExpiresAt: new Date(cachedEntry.cachedAt + CACHE_TTL_MS).toISOString(),
      },
    });
  }

  try {
    const pageResults = await Promise.allSettled(
      Array.from({ length: requestedPages }, (_, index) => fetchPropertiesPage(apiKey, apiHost, index))
    );
    const successfulChunks = pageResults
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const failedChunks = pageResults.filter((result) => result.status === "rejected");

    if (successfulChunks.length === 0) {
      throw failedChunks[0]?.reason ?? new Error("sales-search failed");
    }

    const merged = new Map();
    for (const chunk of successfulChunks) {
      for (const item of chunk) {
        if (item?.id != null) {
          merged.set(item.id, item);
        }
      }
    }

    const rawListings = Array.from(merged.values());
    const listings = rawListings
      .map(normalizeSalesListing)
      .filter(Boolean)
      .sort((left, right) => {
        const leftScore = Math.abs(left.baselineDiffAmount ?? 0);
        const rightScore = Math.abs(right.baselineDiffAmount ?? 0);
        return rightScore - leftScore;
      });

    const developerStats = buildDeveloperStats(listings, { lowN: 4, highN: 4 });
    const updatedAt = new Date().toISOString();

    const payload = {
      listings,
      developerStats,
      meta: {
        updatedAt,
        resultCount: listings.length,
        pagesRequested: requestedPages,
        pagesFetched: successfulChunks.length,
        partialFailure: failedChunks.length > 0,
        sourceLabel: "UAE Real Estate 2 · for-sale · pre-war baseline",
        servedFromCache: false,
        cacheExpiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      },
    };

    responseCache.set(cacheKey, {
      payload,
      cachedAt: Date.now(),
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("sales-search error", error);

    if (cachedEntry) {
      return NextResponse.json({
        ...cachedEntry.payload,
        meta: {
          ...cachedEntry.payload.meta,
          error: error.message,
          servedFromCache: true,
          staleFallback: true,
        },
      });
    }

    return NextResponse.json(
      { error: error.message ?? "sales-search failed", listings: [], developerStats: [] },
      { status: 502 }
    );
  }
}
