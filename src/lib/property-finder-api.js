const PF6_BASE = "https://property-finder6.p.rapidapi.com";

// Known PropertyFinder location IDs for Dubai communities
const AREA_LOCATION_IDS = {
  marina: 60,
  "dubai marina": 60,
  downtown: 50,
  "downtown dubai": 50,
  jvc: 50,
  "jumeirah village circle": 50,
  jlt: 50,
  "jumeirah lake towers": 50,
  palm: 50,
  "palm jumeirah": 50,
  "business bay": 50,
};

function getLocationId(area) {
  if (!area) return 50;
  return AREA_LOCATION_IDS[area.toLowerCase().trim()] ?? 50;
}

function pf6Headers() {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) throw new Error("Missing RAPIDAPI_KEY");
  return {
    "Content-Type": "application/json",
    "x-rapidapi-host": "property-finder6.p.rapidapi.com",
    "x-rapidapi-key": apiKey,
  };
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: pf6Headers() });
  let data;
  try { data = await res.json(); } catch { throw new Error(`Non-JSON response from ${url}`); }
  if (!res.ok) throw new Error(data?.message ?? `API error ${res.status}`);
  return data;
}

async function getBrokerPhone(locationId) {
  const data = await fetchJSON(
    `${PF6_BASE}/search-brokers-detailed?page=1&sort=featured&location_id=${locationId}`
  );
  const broker = (data.data ?? []).find((b) => b.phone);
  return broker ? { phone: broker.phone, name: broker.name } : null;
}

async function getAgentListings(locationId, { bedrooms = null, maxPrice = null, area = null } = {}) {
  // Get agents for this location
  const agentsData = await fetchJSON(
    `${PF6_BASE}/search-agents?category=residential_sale&page=1&location_id=${locationId}&sort=most_sales`
  );
  const agents = agentsData.data ?? [];
  if (!agents.length) return null;

  // Try each agent until we find a matching listing
  for (const agent of agents.slice(0, 5)) {
    const listingsData = await fetchJSON(
      `${PF6_BASE}/agent-properties?sort=newest&page=1&category=residential_sale&agent_id=${agent.id}`
    );
    const listings = listingsData.data ?? [];
    if (!listings.length) continue;

    // Filter by user criteria
    const matched = listings.filter((l) => {
      const beds = Number(l.bedrooms);
      const price = l.price?.value;
      const loc = (l.location?.full_name ?? "").toLowerCase();

      if (bedrooms !== null && beds !== bedrooms) return false;
      if (maxPrice !== null && price > maxPrice) return false;
      if (area && !loc.includes(area.toLowerCase())) return false;
      return true;
    });

    const listing = matched[0] ?? listings[0];
    if (listing) {
      return {
        title: listing.title ?? "Property listing",
        price: listing.price?.value ?? null,
        type: (listing.property_type ?? "apartment").toLowerCase(),
        bedrooms: Number(listing.bedrooms) || null,
        area: listing.location?.full_name ?? area ?? "Dubai",
        agentName: agent.name,
        agencyName: agent.broker_name,
        coverPhoto: listing.images?.[0] ?? null,
        propertyUrl: listing.share_url ?? null,
      };
    }
  }

  return null;
}

export async function fetchListingAndPhone({ area = null, bedrooms = null, maxPrice = null } = {}) {
  const locationId = getLocationId(area);

  const [broker, listing] = await Promise.all([
    getBrokerPhone(locationId),
    getAgentListings(locationId, { bedrooms, maxPrice, area }),
  ]);

  if (!broker) throw new Error("No broker with phone found for that area");

  return {
    agentPhone: broker.phone,
    agencyName: broker.name,
    title: listing?.title ?? `${area ?? "Dubai"} property`,
    price: listing?.price ?? null,
    type: listing?.type ?? "property",
    bedrooms: listing?.bedrooms ?? bedrooms,
    area: listing?.area ?? area ?? "Dubai",
    agentName: listing?.agentName ?? broker.name,
    coverPhoto: listing?.coverPhoto ?? null,
    propertyUrl: listing?.propertyUrl ?? null,
  };
}
