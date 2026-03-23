"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopBanner from "@/components/dashboard/top-banner";
import NavBar from "@/components/dashboard/nav-bar";
import Hero from "@/components/dashboard/hero";
import FilterBar from "@/components/dashboard/filter-bar";
import StatsCards from "@/components/dashboard/stats-cards";
import ListingsFeed from "@/components/dashboard/listings-feed";
import { getSignalMetrics } from "@/lib/dashboard-data";
import { useDashboardStore } from "@/lib/store";
import { getSalesAreaSummaries } from "@/lib/uae-sales-data";

const AUTO_REFRESH_MS = 60 * 1000;

const emptyDashboardData = {
  listings: [],
  meta: {
    updatedAt: null,
    resultCount: 0,
    sourceLabel: "UAE Real Estate 2 · for-sale · pre-war baseline",
  },
};

function getListingTimestamp(listing) {
  return new Date(listing.listedDate ?? listing.lastScanned ?? 0);
}

function sortListings(items, sortBy) {
  const sortedItems = [...items];

  sortedItems.sort((left, right) => {
    const leftSignal = getSignalMetrics(left);
    const rightSignal = getSignalMetrics(right);

    if (sortBy === "biggestSavings") {
      return (rightSignal.amount ?? -1) - (leftSignal.amount ?? -1);
    }

    if (sortBy === "newest") {
      return getListingTimestamp(right) - getListingTimestamp(left);
    }

    return (rightSignal.percent ?? -1) - (leftSignal.percent ?? -1);
  });

  return sortedItems;
}

function applyListingFilters(items, filters, includeArea = true) {
  return items.filter((listing) => {
    const signal = getSignalMetrics(listing);

    if (filters.propertyType !== "all" && listing.type !== filters.propertyType) {
      return false;
    }

    if (filters.onlyTenPercentDrops && (typeof signal.percent !== "number" || signal.percent < 10)) {
      return false;
    }

    if (filters.onlyExpatAreas && listing.expatArea === false) {
      return false;
    }

    if (includeArea && filters.activeArea && listing.area !== filters.activeArea) {
      return false;
    }

    return true;
  });
}

function getSalesDashboardStats(inputListings = []) {
  const listingsBelowBaseline = inputListings.filter((listing) => {
    const signal = getSignalMetrics(listing);
    return signal.hasData && (signal.amount ?? 0) > 0;
  });

  const sortedByPercent = [...listingsBelowBaseline].sort(
    (left, right) => (right.baselineDiffPercent ?? 0) - (left.baselineDiffPercent ?? 0)
  );
  const sortedByAmount = [...listingsBelowBaseline].sort(
    (left, right) => (right.baselineDiffAmount ?? 0) - (left.baselineDiffAmount ?? 0)
  );

  return {
    totalDrops: listingsBelowBaseline.length,
    totalListings: inputListings.length,
    biggestDrop: sortedByPercent[0] ?? null,
    biggestAmountDrop: sortedByAmount[0] ?? null,
    totalSavings: listingsBelowBaseline.length
      ? listingsBelowBaseline.reduce((sum, listing) => sum + (listing.baselineDiffAmount ?? 0), 0)
      : null,
    averageDrop: listingsBelowBaseline.length
      ? listingsBelowBaseline.reduce((sum, listing) => sum + (listing.baselineDiffPercent ?? 0), 0) /
        listingsBelowBaseline.length
      : null,
  };
}

export default function SalesMainDashboard({
  developerHref = "/live-updates?view=developers",
}) {
  const {
    pricePeriod,
    sortBy,
    activeArea,
    setPropertyType,
    setPricePeriod,
    setSortBy,
    setActiveArea,
    clearActiveArea,
  } = useDashboardStore();

  const [dashboardData, setDashboardData] = useState(emptyDashboardData);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [error, setError] = useState(null);

  const loadDashboardData = useCallback(async ({ force = false } = {}) => {
    try {
      setIsRefreshing(true);
      setError(null);

      const response = await fetch(`/api/sales-search${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Sales dashboard request failed");
      }

      setDashboardData({
        listings: Array.isArray(payload.listings) ? payload.listings : [],
        meta: {
          ...emptyDashboardData.meta,
          ...payload.meta,
        },
      });
      setClockMs(Date.now());
    } catch (loadError) {
      console.error("Failed to load sales dashboard data", loadError);
      setError(loadError.message ?? "Failed to load sales dashboard");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
    const refreshInterval = window.setInterval(() => {
      loadDashboardData();
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(refreshInterval);
  }, [loadDashboardData]);

  useEffect(() => {
    const clockInterval = window.setInterval(() => {
      setClockMs(Date.now());
    }, 1000);

    return () => window.clearInterval(clockInterval);
  }, []);

  useEffect(() => {
    setPropertyType("all");
  }, [setPropertyType]);

  const filters = useMemo(
    () => ({
      propertyType: "all",
      activeArea,
      onlyTenPercentDrops: false,
      onlyExpatAreas: false,
    }),
    [activeArea]
  );

  const visibleMapListings = useMemo(
    () => applyListingFilters(dashboardData.listings, filters, false),
    [dashboardData.listings, filters]
  );
  const filteredListings = useMemo(
    () => sortListings(applyListingFilters(dashboardData.listings, filters, true), sortBy),
    [dashboardData.listings, filters, sortBy]
  );
  const areaSummaries = useMemo(
    () => getSalesAreaSummaries(visibleMapListings),
    [visibleMapListings]
  );
  const areaOptions = useMemo(
    () => areaSummaries.map((summary) => summary.area).sort((left, right) => left.localeCompare(right)),
    [areaSummaries]
  );
  const stats = useMemo(
    () => getSalesDashboardStats(visibleMapListings),
    [visibleMapListings]
  );
  const lastUpdatedSeconds = useMemo(() => {
    if (!dashboardData.meta.updatedAt) {
      return null;
    }

    const updatedAtMs = new Date(dashboardData.meta.updatedAt).getTime();
    if (Number.isNaN(updatedAtMs)) {
      return null;
    }

    return Math.max(0, Math.floor((clockMs - updatedAtMs) / 1000));
  }, [dashboardData.meta.updatedAt, clockMs]);

  return (
    <>
      <TopBanner listingScanVolume={dashboardData.meta.resultCount} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-5 lg:px-8">
        <NavBar
          stats={stats}
          lastUpdatedSeconds={lastUpdatedSeconds}
          onRefresh={() => loadDashboardData({ force: true })}
          isRefreshing={isRefreshing}
          developerHref={developerHref}
        />
        <FilterBar
          pricePeriod={pricePeriod}
          sortBy={sortBy}
          activeArea={activeArea}
          areaOptions={areaOptions}
          onPricePeriodChange={setPricePeriod}
          onSortChange={setSortBy}
          onAreaChange={setActiveArea}
          onClearArea={clearActiveArea}
        />
        {error && (
          <div className="rounded-[24px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        <StatsCards
          stats={stats}
          lastUpdatedSeconds={lastUpdatedSeconds}
          listingScanVolume={dashboardData.meta.resultCount}
        />
        <ListingsFeed
          listings={filteredListings}
          pricePeriod={pricePeriod}
          activeArea={activeArea}
          onClearArea={clearActiveArea}
        />
        <Hero
          activeArea={activeArea}
          clearActiveArea={clearActiveArea}
          onAreaSelect={setActiveArea}
          areaSummaries={areaSummaries}
        />
      </div>
    </>
  );
}
