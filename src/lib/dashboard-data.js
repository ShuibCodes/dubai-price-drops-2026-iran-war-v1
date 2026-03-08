function toNumber(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
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

  return {
    id: rawListing.property_id,
    sourceId: rawListing.property_id,
    reference: rawListing.reference_number ?? null,
    title: rawListing.title ?? "COMING SOON.",
    area,
    community,
    type: rawListing.property_type?.toLowerCase() ?? "coming soon",
    bedrooms: toNumber(rawListing.bedrooms) ?? 0,
    bathrooms: toNumber(rawListing.bathrooms),
    sqft: toNumber(rawListing.size?.value) ?? 0,
    originalPrice: null,
    currentPrice: toNumber(rawListing.price?.value),
    dropAmount: null,
    dropPercent: null,
    daysOnMarket: getDaysOnMarket(rawListing.listed_date),
    droppedYesterday: null,
    validated: rawListing.is_verified ?? false,
    expatArea: null,
    familyFriendly: null,
    lat: rawListing.address?.coordinates?.lat ?? null,
    lng: rawListing.address?.coordinates?.lon ?? null,
    priceHistory: [],
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
      const listingsWithDropData = listings.filter(
        (listing) =>
          typeof listing.dropPercent === "number" && typeof listing.dropAmount === "number"
      );
      const firstListing = listings[0];
      const avgDropPercent = listingsWithDropData.length
        ? listingsWithDropData.reduce((sum, listing) => sum + listing.dropPercent, 0) /
          listingsWithDropData.length
        : null;
      const avgDropAmount = listingsWithDropData.length
        ? listingsWithDropData.reduce((sum, listing) => sum + listing.dropAmount, 0) /
          listingsWithDropData.length
        : null;

      return {
        area,
        label: area,
        community: firstListing?.community ?? area,
        lat: firstListing?.lat ?? 25.2048,
        lng: firstListing?.lng ?? 55.2708,
        sparkline: buildAreaSparkline(listings.length),
        dropCount: listings.length,
        avgDropPercent:
          avgDropPercent === null ? null : Number(avgDropPercent.toFixed(1)),
        avgDropAmount:
          avgDropAmount === null ? null : Math.round(avgDropAmount),
      };
    })
    .sort((left, right) => {
      if (right.dropCount !== left.dropCount) {
        return right.dropCount - left.dropCount;
      }

      return left.area.localeCompare(right.area);
    });
}

export function getDashboardStats(inputListings = []) {
  const listingsWithDropData = inputListings.filter(
    (listing) => typeof listing.dropPercent === "number" && typeof listing.dropAmount === "number"
  );
  const sortedByPercent = [...listingsWithDropData].sort(
    (left, right) => right.dropPercent - left.dropPercent
  );
  const sortedByAmount = [...listingsWithDropData].sort(
    (left, right) => right.dropAmount - left.dropAmount
  );

  return {
    totalDrops: inputListings.length,
    totalListings: inputListings.length,
    biggestDrop: sortedByPercent[0] ?? null,
    biggestAmountDrop: sortedByAmount[0] ?? null,
    totalSavings: listingsWithDropData.length
      ? listingsWithDropData.reduce((sum, listing) => sum + listing.dropAmount, 0)
      : null,
    averageDrop: listingsWithDropData.length
      ? listingsWithDropData.reduce((sum, listing) => sum + listing.dropPercent, 0) /
        listingsWithDropData.length
      : null,
  };
}
