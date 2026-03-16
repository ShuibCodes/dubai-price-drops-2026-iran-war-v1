const AREA_MULTIPLIERS = {
  "Dubai Marina": 1.45,
  "Palm Jumeirah": 2.35,
  Jumeirah: 1.9,
  "Jumeirah Park": 1.5,
  "Jumeirah Islands": 1.9,
  "Jumeirah Village Circle": 0.95,
  JVC: 0.95,
  "Dubai Hills Estate": 1.5,
  "Dubai Hills": 1.5,
  "Business Bay": 1.3,
  Downtown: 1.65,
  "Downtown Dubai": 1.65,
  Arjan: 0.9,
  "Dubai Land": 0.88,
  "Dubailand": 0.88,
  "Dubai Land Residence Complex": 0.84,
  "Dubai Sports City": 0.92,
  "Motor City": 1.0,
  "Town Square": 0.9,
  "Al Furjan": 1.05,
  "Dubai Creek Harbour": 1.25,
  "DAMAC Lagoons": 1.18,
  "The Valley": 1.1,
  "Al Barari": 1.7,
  "Arabian Ranches": 1.55,
  "Dubai Silicon Oasis": 0.9,
  "Deira": 0.92,
  "Mirdif": 1.02,
  DIFC: 1.7,
};

const BASE_PRICE_BY_TYPE_AND_BEDS = {
  apartment: {
    0: 62000,
    1: 84000,
    2: 128000,
    3: 182000,
    4: 255000,
    5: 340000,
  },
  villa: {
    1: 145000,
    2: 180000,
    3: 235000,
    4: 320000,
    5: 430000,
    6: 560000,
  },
  townhouse: {
    2: 165000,
    3: 215000,
    4: 295000,
    5: 390000,
  },
  penthouse: {
    2: 280000,
    3: 390000,
    4: 560000,
    5: 760000,
  },
};

const EXPECTED_SQFT_BY_TYPE_AND_BEDS = {
  apartment: {
    0: 460,
    1: 760,
    2: 1180,
    3: 1750,
    4: 2500,
    5: 3200,
  },
  villa: {
    1: 1200,
    2: 1850,
    3: 2600,
    4: 3600,
    5: 5000,
    6: 6500,
  },
  townhouse: {
    2: 1700,
    3: 2300,
    4: 3100,
    5: 3900,
  },
  penthouse: {
    2: 2200,
    3: 3200,
    4: 4400,
    5: 6000,
  },
};

function getClosestDefinedValue(table, bedrooms) {
  if (!table) {
    return null;
  }

  if (table[bedrooms]) {
    return table[bedrooms];
  }

  const sortedKeys = Object.keys(table)
    .map(Number)
    .sort((left, right) => left - right);
  const fallbackKey = sortedKeys.find((key) => key >= bedrooms) ?? sortedKeys.at(-1);

  return fallbackKey !== undefined ? table[fallbackKey] : null;
}

export function getPreWarBaseline(listing) {
  const normalizedType = listing.type?.toLowerCase() ?? "apartment";
  const normalizedBedrooms = Number.isFinite(listing.bedrooms) ? listing.bedrooms : 0;
  const basePrice = getClosestDefinedValue(
    BASE_PRICE_BY_TYPE_AND_BEDS[normalizedType] ?? BASE_PRICE_BY_TYPE_AND_BEDS.apartment,
    normalizedBedrooms
  );

  if (!basePrice) {
    return null;
  }

  const areaMultiplier = AREA_MULTIPLIERS[listing.area] ?? 1;
  const expectedSqft = getClosestDefinedValue(
    EXPECTED_SQFT_BY_TYPE_AND_BEDS[normalizedType] ?? EXPECTED_SQFT_BY_TYPE_AND_BEDS.apartment,
    normalizedBedrooms
  );
  const sizeRatio =
    expectedSqft && listing.sqft ? Math.min(Math.max(listing.sqft / expectedSqft, 0.75), 1.35) : 1;

  return Math.round(basePrice * areaMultiplier * sizeRatio);
}
