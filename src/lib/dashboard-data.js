import { getPreWarBaseline } from "@/lib/prewar-baselines";

function toNumber(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function hasBaselineData(listing) {
  return (
    typeof listing.baselineDiffPercent === "number" &&
    typeof listing.baselineDiffAmount === "number"
  );
}

export function getSignalMetrics(listing) {
  return {
    amount: listing.baselineDiffAmount,
    percent: listing.baselineDiffPercent,
    comparisonPrice: listing.baselinePrice,
    hasData: hasBaselineData(listing),
  };
}

function getDaysOnMarket(listedDate) {
  if (!listedDate) {
    return null;
  }

  const timestamp = new Date(listedDate).getTime();

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const diffInDays = Math.ceil((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  return Math.max(diffInDays, 0);
}

function buildAreaSparkline(count) {
  return Array.from({ length: 7 }, () => count);
}

function getAreaAndCommunity(locationTree = [], addressFullName = "") {
  const areaNode = locationTree.find((node) => node.level === "1") ?? locationTree[1];
  const deepestNode = locationTree.at(-1);
  const addressLead = addressFullName.split(",")[0]?.trim();

  const area = areaNode?.name ?? "Dubai";
  const community =
    deepestNode?.name && deepestNode.name !== area ? deepestNode.name : addressLead || area;

  return { area, community };
}

export function normalizePropertyFinderListing(rawListing, observedAt) {
  const { area, community } = getAreaAndCommunity(
    rawListing.location_tree,
    rawListing.address?.full_name
  );

  const sqft = toNumber(rawListing.size?.value) ?? 0;
  const currentPrice = toNumber(rawListing.price?.value);
  const baselineListing = {
    area,
    type: rawListing.property_type?.toLowerCase() ?? "coming soon",
    bedrooms: toNumber(rawListing.bedrooms) ?? 0,
    sqft,
  };
  const baselinePrice = currentPrice ? getPreWarBaseline(baselineListing) : null;
  const baselineDiffAmount =
    baselinePrice && currentPrice ? baselinePrice - currentPrice : null;
  const baselineDiffPercent =
    baselineDiffAmount !== null && baselinePrice
      ? Number(((baselineDiffAmount / baselinePrice) * 100).toFixed(1))
      : null;

  return {
    id: rawListing.property_id,
    sourceId: rawListing.property_id,
    reference: rawListing.reference_number ?? null,
    title: rawListing.title ?? "COMING SOON.",
    area,
    community,
    type: baselineListing.type,
    bedrooms: toNumber(rawListing.bedrooms) ?? 0,
    bathrooms: toNumber(rawListing.bathrooms),
    sqft,
    currentPrice,
    baselinePrice,
    baselineDiffAmount,
    baselineDiffPercent,
    daysOnMarket: getDaysOnMarket(rawListing.listed_date),
    validated: rawListing.is_verified ?? false,
    expatArea: null,
    familyFriendly: null,
    lat: rawListing.address?.coordinates?.lat ?? null,
    lng: rawListing.address?.coordinates?.lon ?? null,
    listedDate: rawListing.listed_date ?? null,
    lastScanned: observedAt,
    imageUrl: rawListing.images?.[0] ?? null,
    propertyUrl: rawListing.property_url ?? null,
    address: rawListing.address?.full_name ?? null,
    brokerId: rawListing.broker_id ?? null,
    agent: rawListing.agent_details?.name ?? null,
    pricePeriod: rawListing.price?.period ?? null,
    isAvailable: rawListing.is_available ?? true,
  };
}

export function getAreaSummaries(inputListings = []) {
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
        dropCount: listingsWithData.length,
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

export function getDashboardStats(inputListings = []) {
  const listingsWithData = inputListings.filter((listing) => hasBaselineData(listing));
  const sortedByPercent = [...listingsWithData].sort(
    (left, right) => right.baselineDiffPercent - left.baselineDiffPercent
  );
  const sortedByAmount = [...listingsWithData].sort(
    (left, right) => right.baselineDiffAmount - left.baselineDiffAmount
  );

  return {
    totalDrops: listingsWithData.length,
    totalListings: inputListings.length,
    biggestDrop: sortedByPercent[0] ?? null,
    biggestAmountDrop: sortedByAmount[0] ?? null,
    totalSavings: listingsWithData.length
      ? listingsWithData.reduce(
          (sum, listing) => sum + listing.baselineDiffAmount,
          0
        )
      : null,
    averageDrop: listingsWithData.length
      ? listingsWithData.reduce(
          (sum, listing) => sum + listing.baselineDiffPercent,
          0
        ) / listingsWithData.length
      : null,
  };
}
