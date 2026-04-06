/**
 * Normalizes UAE Real Estate 2 `properties_search` items for the sales dashboard.
 */

import { getPreWarBaseline } from "@/lib/prewar-baselines";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhone(value) {
  if (typeof value !== "string") {
    return null;
  }

  const digitsOnly = value.replace(/[^\d+]/g, "");
  return digitsOnly.length >= 7 ? digitsOnly : null;
}

function normalizeCompletionStatus(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "under-construction" ||
    normalized === "under construction" ||
    normalized === "under_construction"
  ) {
    return "Off-plan";
  }

  return trimmed;
}

function getDaysOnMarket(timestamp) {
  if (!timestamp) {
    return null;
  }

  const parsedTimestamp = new Date(timestamp).getTime();
  if (Number.isNaN(parsedTimestamp)) {
    return null;
  }

  const diffInDays = Math.ceil((Date.now() - parsedTimestamp) / (1000 * 60 * 60 * 24));
  return Math.max(diffInDays, 0);
}

export function normalizeSalesListing(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const typeMain = raw.type?.main ?? "";
  const typeSub = raw.type?.sub ?? "";
  const typeSlug =
    typeSub?.toLowerCase().includes("villa") || typeMain?.toLowerCase().includes("villa")
      ? "villa"
      : "apartment";

  const bedrooms = toNumber(raw.details?.bedrooms) ?? 0;
  const bathrooms = toNumber(raw.details?.bathrooms) ?? 0;
  const sqft =
    toNumber(raw.details?.area?.value) ??
    toNumber(raw.details?.size?.value) ??
    toNumber(raw.size?.value) ??
    0;
  const price = toNumber(raw.price) ?? 0;
  const area = raw.location?.community?.name ?? raw.location?.city?.name ?? "Dubai";
  const baselinePrice = price
    ? getPreWarBaseline({
        type: typeSlug,
        bedrooms,
        sqft,
        area,
      })
    : null;
  const baselineDiffAmount =
    baselinePrice && price ? baselinePrice - price : null;
  const baselineDiffPercent =
    baselineDiffAmount !== null && baselinePrice
      ? Number(((baselineDiffAmount / baselinePrice) * 100).toFixed(1))
      : null;
  const coordinates = raw.location?.coordinates ?? raw.location?.geo ?? {};
  const agentName =
    raw.agent?.name ??
    raw.agent_details?.name ??
    raw.contact?.name ??
    raw.broker?.name ??
    null;
  const agentPhone =
    normalizePhone(raw.agent?.phone) ??
    normalizePhone(raw.agent?.mobile) ??
    normalizePhone(raw.agent_details?.phone) ??
    normalizePhone(raw.agent_details?.mobile) ??
    normalizePhone(raw.contact?.phone) ??
    normalizePhone(raw.contact?.mobile) ??
    normalizePhone(raw.broker?.phone) ??
    normalizePhone(raw.broker?.mobile) ??
    null;

  return {
    id: String(raw.id ?? ""),
    title: raw.title ?? "Listing",
    price,
    currentPrice: price,
    type: typeSlug,
    bedrooms,
    bathrooms,
    sqft,
    area,
    community: raw.location?.sub_community?.name ?? raw.location?.cluster?.name ?? null,
    lat: toNumber(coordinates?.lat),
    lng: toNumber(coordinates?.lng ?? coordinates?.lon),
    developerName: raw.project?.developer?.name ?? null,
    developerId: raw.project?.developer?.id ?? null,
    verified: Boolean(raw.verification?.is_verified),
    validated: Boolean(raw.verification?.is_verified),
    verifiedAt: raw.verification?.verified_at ?? null,
    completionStatus: normalizeCompletionStatus(
      raw.details?.completion_status ?? raw.project?.completion_status ?? null
    ),
    propertyUrl: raw.meta?.url ?? null,
    coverPhoto:
      raw.media?.cover_photo ??
      (Array.isArray(raw.media?.photos) ? raw.media.photos[0] : null) ??
      null,
    agencyName: raw.agency?.name ?? null,
    agentName,
    agentPhone,
    listedUpdatedAt: raw.meta?.updated_at ?? null,
    listedDate: raw.meta?.updated_at ?? null,
    lastScanned: raw.meta?.updated_at ?? null,
    daysOnMarket: getDaysOnMarket(raw.meta?.updated_at),
    baselinePrice,
    baselineDiffAmount,
    baselineDiffPercent,
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.lowN]  How many developers with the lowest average ask to include
 * @param {number} [opts.highN] How many developers with the highest average ask to include
 */
export function buildDeveloperStats(listings, { lowN = 4, highN = 4 } = {}) {
  const byName = new Map();

  for (const listing of listings) {
    const name = listing.developerName?.trim() || "Unknown developer";
    const price = listing.price;
    if (!Number.isFinite(price) || price <= 0) {
      continue;
    }

    if (!byName.has(name)) {
      byName.set(name, { prices: [], count: 0 });
    }
    const bucket = byName.get(name);
    bucket.prices.push(price);
    bucket.count += 1;
  }

  const rows = Array.from(byName.entries()).map(([name, { prices, count }]) => {
    const sum = prices.reduce((a, b) => a + b, 0);
    const avg = sum / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return { name, avgPrice: Math.round(avg), minPrice: min, maxPrice: max, count };
  });

  rows.sort((a, b) => a.avgPrice - b.avgPrice);
  const n = rows.length;
  if (n === 0) {
    return [];
  }

  const takeLow = Math.min(lowN, n);
  const takeHigh = Math.min(highN, n);
  const bottom = rows.slice(0, takeLow);
  const top = rows.slice(Math.max(0, n - takeHigh));

  const byKey = new Map();
  for (const row of bottom) {
    byKey.set(row.name, row);
  }
  for (const row of top) {
    byKey.set(row.name, row);
  }

  return Array.from(byKey.values()).sort((a, b) => a.avgPrice - b.avgPrice);
}

function hasBaselineData(listing) {
  return (
    typeof listing.baselineDiffPercent === "number" &&
    typeof listing.baselineDiffAmount === "number"
  );
}

function buildAreaSparkline(count) {
  return Array.from({ length: 7 }, () => count);
}

export function getSalesAreaSummaries(inputListings = []) {
  const groupedListings = inputListings.reduce((areas, listing) => {
    if (!listing.area) {
      return areas;
    }

    if (!areas[listing.area]) {
      areas[listing.area] = [];
    }

    areas[listing.area].push(listing);
    return areas;
  }, {});

  return Object.entries(groupedListings)
    .map(([area, listings]) => {
      const listingsWithData = listings.filter((listing) => hasBaselineData(listing));
      const firstListing = listings[0];
      const avgDropPercent = listingsWithData.length
        ? listingsWithData.reduce(
            (sum, listing) => sum + listing.baselineDiffPercent,
            0
          ) / listingsWithData.length
        : null;
      const avgDropAmount = listingsWithData.length
        ? listingsWithData.reduce(
            (sum, listing) => sum + listing.baselineDiffAmount,
            0
          ) / listingsWithData.length
        : null;

      return {
        area,
        label: area,
        community: firstListing?.community ?? area,
        lat: firstListing?.lat ?? 25.2048,
        lng: firstListing?.lng ?? 55.2708,
        sparkline: buildAreaSparkline(listingsWithData.length || listings.length),
        listingCount: listings.length,
        dropCount: listingsWithData.filter((listing) => listing.baselineDiffAmount > 0).length,
        avgDropPercent:
          avgDropPercent === null ? null : Number(avgDropPercent.toFixed(1)),
        avgDropAmount:
          avgDropAmount === null ? null : Math.round(avgDropAmount),
      };
    })
    .sort((left, right) => {
      const leftCount = left.dropCount || left.listingCount;
      const rightCount = right.dropCount || right.listingCount;

      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      return left.area.localeCompare(right.area);
    });
}
