import { NextResponse } from "next/server";
import { fetchPropertyFinderDashboardData } from "@/lib/propertyfinder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DASHBOARD_CACHE_TTL_MS = 60 * 1000;
const ANOMALOUS_MIN_LISTINGS = 12;
const ANOMALOUS_DROP_RATIO = 0.35;

let cachedDashboardPayload = null;
let cachedDashboardAt = 0;
let inFlightDashboardPromise = null;

function getPayloadSignals(payload) {
  const listings = Array.isArray(payload?.listings) ? payload.listings : [];
  const baselineCount = listings.filter(
    (listing) =>
      typeof listing?.baselineDiffAmount === "number" &&
      typeof listing?.baselineDiffPercent === "number"
  ).length;

  return {
    listingsCount: listings.length,
    baselineCount,
  };
}

function isAnomalousPayload(nextPayload, previousPayload) {
  if (!previousPayload) {
    return false;
  }

  const next = getPayloadSignals(nextPayload);
  const previous = getPayloadSignals(previousPayload);

  if (previous.listingsCount === 0) {
    return false;
  }

  if (next.listingsCount === 0) {
    return true;
  }

  const listingFloor = Math.max(
    ANOMALOUS_MIN_LISTINGS,
    Math.floor(previous.listingsCount * ANOMALOUS_DROP_RATIO)
  );
  if (next.listingsCount < listingFloor) {
    return true;
  }

  if (previous.baselineCount > 0) {
    const baselineFloor = Math.max(
      ANOMALOUS_MIN_LISTINGS,
      Math.floor(previous.baselineCount * ANOMALOUS_DROP_RATIO)
    );
    if (next.baselineCount < baselineFloor) {
      return true;
    }
  }

  return false;
}

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

        if (isAnomalousPayload(payload, cachedDashboardPayload)) {
          return {
            ...cachedDashboardPayload,
            meta: {
              ...cachedDashboardPayload.meta,
              fallbackToLastGoodData: true,
              fallbackReason: "anomalous-fresh-payload",
            },
          };
        }

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
