import { normalizePropertyFinderListing } from "@/lib/dashboard-data";

const PROPERTY_FINDER_API_BASE_URL = "https://propertyfinder-uae-data.p.rapidapi.com";
const DEFAULT_LOCATION_ID = "1";
const DEFAULT_PROPERTY_TYPES = ["apartment", "villa"];

function getRapidApiHeaders() {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost =
    process.env.RAPIDAPI_HOST ?? "propertyfinder-uae-data.p.rapidapi.com";

  if (!apiKey) {
    throw new Error("Missing RAPIDAPI_KEY");
  }

  return {
    "x-rapidapi-host": apiHost,
    "x-rapidapi-key": apiKey,
  };
}

async function fetchSearchRentPage({ locationId, propertyType, page }) {
  const searchParams = new URLSearchParams({
    location_id: String(locationId),
    property_type: propertyType,
    page: String(page),
  });

  const response = await fetch(
    `${PROPERTY_FINDER_API_BASE_URL}/search-rent?${searchParams.toString()}`,
    {
      headers: getRapidApiHeaders(),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`PropertyFinder request failed with ${response.status}`);
  }

  const payload = await response.json();

  if (!payload.success || !Array.isArray(payload.data)) {
    throw new Error("PropertyFinder returned an unexpected payload");
  }

  return payload.data;
}

export async function fetchPropertyFinderDashboardData({
  locationId = DEFAULT_LOCATION_ID,
  propertyTypes = DEFAULT_PROPERTY_TYPES,
  pages = 1,
} = {}) {
  const observedAt = new Date().toISOString();
  const requests = [];

  propertyTypes.forEach((propertyType) => {
    for (let page = 1; page <= pages; page += 1) {
      requests.push(fetchSearchRentPage({ locationId, propertyType, page }));
    }
  });

  const results = await Promise.all(requests);
  const rawListings = results.flat();
  const dedupedListings = Array.from(
    new Map(
      rawListings.map((listing) => [
        listing.property_id,
        normalizePropertyFinderListing(listing, observedAt),
      ])
    ).values()
  ).sort((left, right) => new Date(right.listedDate ?? 0) - new Date(left.listedDate ?? 0));

  return {
    listings: dedupedListings,
    meta: {
      updatedAt: observedAt,
      listingScanVolume: dedupedListings.length,
      liveWatchers: null,
      snapshotDataAvailable: false,
      sourceLabel: "PropertyFinder UAE Data",
      locationId: String(locationId),
    },
  };
}
