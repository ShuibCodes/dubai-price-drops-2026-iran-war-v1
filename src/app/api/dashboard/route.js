import { NextResponse } from "next/server";
import { fetchPropertyFinderDashboardData } from "@/lib/propertyfinder";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId") ?? "1";
  const requestedPages = Number(searchParams.get("pages") ?? "1");
  const pages = Number.isFinite(requestedPages)
    ? Math.min(Math.max(requestedPages, 1), 3)
    : 1;

  try {
    const dashboardData = await fetchPropertyFinderDashboardData({
      locationId,
      pages,
    });

    return NextResponse.json(dashboardData);
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message,
        listings: [],
        meta: {
          updatedAt: new Date().toISOString(),
          listingScanVolume: 0,
          liveWatchers: null,
          snapshotDataAvailable: false,
          sourceLabel: "PropertyFinder UAE Data",
          locationId,
        },
      },
      { status: 500 }
    );
  }
}
