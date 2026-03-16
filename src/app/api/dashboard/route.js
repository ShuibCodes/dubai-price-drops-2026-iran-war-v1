import { NextResponse } from "next/server";
import { fetchPropertyFinderDashboardData } from "@/lib/propertyfinder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DASHBOARD_CACHE_TTL_MS = 15 * 1000;

let cachedDashboardPayload = null;
let cachedDashboardAt = 0;
let inFlightDashboardPromise = null;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId") ?? "1";
  const rawLocationIds = searchParams.get("locationIds");
  const envLocationIds = process.env.RAPIDAPI_LOCATION_IDS ?? "";
  const locationIdsInput = rawLocationIds ?? envLocationIds;
  const locationIds = locationIdsInput
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedPages = Number(searchParams.get("pages") ?? "3");
  const pages = Number.isFinite(requestedPages)
    ? Math.min(Math.max(requestedPages, 1), 6)
    : 3;
  const forceRefresh = searchParams.get("force") === "1";

  try {
    if (
      !forceRefresh &&
      cachedDashboardPayload &&
      Date.now() - cachedDashboardAt < DASHBOARD_CACHE_TTL_MS
    ) {
      return NextResponse.json(cachedDashboardPayload);
    }

    if (!inFlightDashboardPromise) {
      inFlightDashboardPromise = (async () => {
        const dashboardData = await fetchPropertyFinderDashboardData({
          locationId,
          locationIds,
          pages,
        });

        const payload = {
          listings: dashboardData.listings,
          meta: dashboardData.meta,
        };

        cachedDashboardPayload = payload;
        cachedDashboardAt = Date.now();

        return payload;
      })();
    }

    const payload = await inFlightDashboardPromise;
    inFlightDashboardPromise = null;

    return NextResponse.json(payload);
  } catch (error) {
    inFlightDashboardPromise = null;

    if (cachedDashboardPayload) {
      return NextResponse.json(cachedDashboardPayload);
    }

    return NextResponse.json(
      {
        error: error.message,
        listings: [],
        meta: {
          updatedAt: new Date().toISOString(),
          listingScanVolume: 0,
          liveWatchers: null,
          sourceLabel: "PropertyFinder UAE Data",
          locationId,
          locationIds,
        },
      },
      { status: 500 }
    );
  }
}
