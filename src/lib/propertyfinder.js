import { normalizePropertyFinderListing } from "@/lib/dashboard-data";

const PROPERTY_FINDER_API_BASE_URL = "https://propertyfinder-uae-data.p.rapidapi.com";
const DEFAULT_LOCATION_ID = "1";
const DEFAULT_PROPERTY_TYPES = ["apartment", "villa"];
const DEFAULT_LOCATION_IDS = [DEFAULT_LOCATION_ID, "2", "3"];

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

const FETCH_TIMEOUT_MS = 10_000;

async function fetchSearchRentPage({ locationId, propertyType, page }) {
  const searchParams = new URLSearchParams({
    location_id: String(locationId),
    property_type: propertyType,
    page: String(page),
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(
      `${PROPERTY_FINDER_API_BASE_URL}/search-rent?${searchParams.toString()}`,
      {
        headers: getRapidApiHeaders(),
        cache: "no-store",
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

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
  locationIds = DEFAULT_LOCATION_IDS,
  propertyTypes = DEFAULT_PROPERTY_TYPES,
  pages = 3,
} = {}) {
  const observedAt = new Date().toISOString();
  const requests = [];
  const safeLocationIds = Array.isArray(locationIds) && locationIds.length
    ? locationIds
    : [locationId];

  safeLocationIds.forEach((currentLocationId) => {
    propertyTypes.forEach((propertyType) => {
      for (let page = 1; page <= pages; page += 1) {
        requests.push(fetchSearchRentPage({ locationId: currentLocationId, propertyType, page }));
      }
    });
  });

  const settledResults = await Promise.allSettled(requests);
  const successfulResults = settledResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  if (!successfulResults.length) {
    const firstFailure = settledResults.find((result) => result.status === "rejected");
    throw new Error(firstFailure?.reason?.message ?? "All PropertyFinder requests failed");
  }

  const rawListings = successfulResults.flat();
  const dedupedListings = Array.from(
    new Map(
      rawListings
        .filter((listing) => listing?.property_id)
        .map((listing) => [listing.property_id, normalizePropertyFinderListing(listing, observedAt)])
    ).values()
  ).sort((left, right) => new Date(right.listedDate ?? 0) - new Date(left.listedDate ?? 0));

  return {
    listings: dedupedListings,
    meta: {
      updatedAt: observedAt,
      listingScanVolume: dedupedListings.length,
      liveWatchers: null,
      sourceLabel: "PropertyFinder UAE Data",
      locationId: String(locationId),
      locationIds: safeLocationIds,
      requestCount: requests.length,
      successfulRequestCount: successfulResults.length,
    },
  };
}
