# Snapshot Feature Plan

## What it does
Track historical price changes for rental listings over time by storing rolling price snapshots (max 12 entries per listing) in `.data/propertyfinder-dashboard-snapshots.json`.

When a listing's price drops below a previously observed price, it calculates:
- `originalPrice` — highest price before the current drop sequence began
- `dropAmount` / `dropPercent` — absolute and percentage change
- `droppedYesterday` — boolean flag if detected within 24h
- `priceHistory` — array of date/price pairs for sparkline visualization

## Key files
- `src/lib/propertyfinder-snapshots.js` — core logic: `readSnapshotStore()`, `mergeListingsWithSnapshots()`, `writeSnapshotStore()`
- `src/app/api/dashboard/route.js` — orchestrates snapshot read/merge/write on each API call

## Current context in `dashboard-data.js`
- `src/lib/dashboard-data.js` is currently a **pre-war only** data-normalization layer.
- `normalizePropertyFinderListing()` enriches live API listings with:
  - `baselinePrice`
  - `baselineDiffAmount`
  - `baselineDiffPercent`
- `getSignalMetrics()` now returns **only baseline metrics**:
  - `amount` -> `baselineDiffAmount`
  - `percent` -> `baselineDiffPercent`
  - `comparisonPrice` -> `baselinePrice`
- `getAreaSummaries()` and `getDashboardStats()` are both aggregating only baseline fields right now.
- Snapshot fields are no longer present in the normalized listing shape returned by this file.

### Meaning for future re-enable work
- To restore snapshot mode, `dashboard-data.js` will need to become dual-mode again rather than baseline-only.
- The most important functions to revisit are:
  - `normalizePropertyFinderListing()`
  - `getSignalMetrics()`
  - `getAreaSummaries()`
  - `getDashboardStats()`
- Snapshot support should reintroduce these listing-level fields:
  - `originalPrice`
  - `dropAmount`
  - `dropPercent`
  - `droppedYesterday`
  - `priceHistory`
- The safest implementation is:
  1. keep baseline fields as-is
  2. merge snapshot-derived fields onto the same listing objects in the API layer
  3. make `getSignalMetrics()` accept a mode again and choose baseline vs snapshot fields

## How it worked with the UI
- `signalMode` toggle in store (`"snapshot"` vs `"baseline"`) let users switch between snapshot drops and pre-war comparisons
- `snapshotDataAvailable` flag in API response controlled whether to show drop data or fallback to "live listings" mode
- All components had conditional rendering based on `signalMode` and `snapshotDataAvailable`

## What needs to happen to re-enable
1. Re-integrate `propertyfinder-snapshots.js` into the API route (read → merge → write)
2. Add `snapshotDataAvailable` / `hasAnyDropData` back to API response meta
3. Re-add `signalMode` toggle to store and NavBar
4. Update `getSignalMetrics()` in `dashboard-data.js` to support both modes again
5. Add conditional rendering back to: NavBar, StatsCards, ListingsFeed, TimestampDivider, DubaiMap, Hero
6. The snapshot fields on each listing: `originalPrice`, `dropAmount`, `dropPercent`, `droppedYesterday`, `priceHistory`

## Data model (snapshot store)
```json
{
  "listings": {
    "<listing_id>": {
      "lastPrice": 85000,
      "currentDropOriginPrice": 95000,
      "currentDropDetectedAt": "2026-03-10T12:00:00Z",
      "firstSeenAt": "2026-03-01T12:00:00Z",
      "lastSeenAt": "2026-03-11T12:00:00Z",
      "history": [
        { "observedAt": "2026-03-01T12:00:00Z", "price": 95000 },
        { "observedAt": "2026-03-10T12:00:00Z", "price": 85000 }
      ]
    }
  }
}
```
