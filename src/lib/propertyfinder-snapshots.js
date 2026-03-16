import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const SNAPSHOT_DIRECTORY = path.join(process.cwd(), ".data");
const SNAPSHOT_FILE_PATH = path.join(
  SNAPSHOT_DIRECTORY,
  "propertyfinder-dashboard-snapshots.json"
);
const MAX_HISTORY_ENTRIES = 12;

function createEmptyStore() {
  return {
    listings: {},
  };
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function diffInHours(left, right) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) / (1000 * 60 * 60);
}

export async function readSnapshotStore() {
  try {
    const rawStore = await readFile(SNAPSHOT_FILE_PATH, "utf8");
    const parsedStore = JSON.parse(rawStore);
    return parsedStore?.listings ? parsedStore : createEmptyStore();
  } catch (error) {
    return createEmptyStore();
  }
}

export async function writeSnapshotStore(store) {
  await mkdir(SNAPSHOT_DIRECTORY, { recursive: true });
  await writeFile(SNAPSHOT_FILE_PATH, JSON.stringify(store, null, 2));
}

function nextHistory(existingHistory, currentPrice, observedAt) {
  const history = [...(existingHistory ?? [])];
  const lastEntry = history.at(-1);

  if (!lastEntry || lastEntry.price !== currentPrice) {
    history.push({
      observedAt,
      price: currentPrice,
    });
  }

  return history.slice(-MAX_HISTORY_ENTRIES);
}

function getDropState(previousEntry, currentPrice, observedAt) {
  if (!previousEntry || !isNumber(currentPrice) || !isNumber(previousEntry.lastPrice)) {
    return {
      currentDropOriginPrice: null,
      currentDropDetectedAt: null,
    };
  }

  const previousPrice = previousEntry.lastPrice;
  const existingOriginPrice = previousEntry.currentDropOriginPrice;
  const existingDetectedAt = previousEntry.currentDropDetectedAt;

  if (currentPrice < previousPrice) {
    return {
      currentDropOriginPrice: isNumber(existingOriginPrice) ? existingOriginPrice : previousPrice,
      currentDropDetectedAt: existingDetectedAt ?? observedAt,
    };
  }

  if (currentPrice > previousPrice) {
    if (isNumber(existingOriginPrice) && currentPrice < existingOriginPrice) {
      return {
        currentDropOriginPrice: existingOriginPrice,
        currentDropDetectedAt: existingDetectedAt ?? observedAt,
      };
    }

    return {
      currentDropOriginPrice: null,
      currentDropDetectedAt: null,
    };
  }

  return {
    currentDropOriginPrice: existingOriginPrice ?? null,
    currentDropDetectedAt: existingDetectedAt ?? null,
  };
}

export function mergeListingsWithSnapshots(listings, store, observedAt) {
  const nextStore = createEmptyStore();
  const hadAnySnapshots = Object.keys(store.listings ?? {}).length > 0;

  const enrichedListings = listings.map((listing) => {
    const previousEntry = store.listings?.[listing.id];
    const history = nextHistory(previousEntry?.history, listing.currentPrice, observedAt);
    const dropState = getDropState(previousEntry, listing.currentPrice, observedAt);
    const originalPrice =
      isNumber(dropState.currentDropOriginPrice) && dropState.currentDropOriginPrice > listing.currentPrice
        ? dropState.currentDropOriginPrice
        : null;
    const dropAmount =
      isNumber(originalPrice) && isNumber(listing.currentPrice)
        ? originalPrice - listing.currentPrice
        : null;
    const dropPercent =
      isNumber(dropAmount) && isNumber(originalPrice) && originalPrice > 0
        ? Number(((dropAmount / originalPrice) * 100).toFixed(1))
        : null;
    const droppedYesterday =
      dropState.currentDropDetectedAt !== null
        ? diffInHours(dropState.currentDropDetectedAt, observedAt) <= 24
        : false;

    nextStore.listings[listing.id] = {
      lastPrice: listing.currentPrice,
      currentDropOriginPrice: dropState.currentDropOriginPrice,
      currentDropDetectedAt: dropState.currentDropDetectedAt,
      firstSeenAt: previousEntry?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      history,
    };

    return {
      ...listing,
      originalPrice,
      dropAmount,
      dropPercent,
      droppedYesterday,
      priceHistory: history.map((entry) => ({
        date: entry.observedAt,
        price: entry.price,
      })),
      lastScanned: observedAt,
    };
  });

  const hasAnyDropData = enrichedListings.some((listing) => isNumber(listing.dropPercent));

  return {
    listings: enrichedListings,
    store: nextStore,
    snapshotDataAvailable: hadAnySnapshots,
    hasAnyDropData,
  };
}
