"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopBanner from "@/components/dashboard/top-banner";
import NavBar from "@/components/dashboard/nav-bar";
import AudienceBadges from "@/components/dashboard/audience-badges";
import Hero from "@/components/dashboard/hero";
import FilterBar from "@/components/dashboard/filter-bar";
import StatsCards from "@/components/dashboard/stats-cards";
import TimestampDivider from "@/components/dashboard/timestamp-divider";
import ListingsFeed from "@/components/dashboard/listings-feed";
import { getAreaSummaries, getDashboardStats, getSignalMetrics } from "@/lib/dashboard-data";
import { useDashboardStore } from "@/lib/store";

const emptyDashboardData = {
  listings: [],
  meta: {
    updatedAt: null,
    listingScanVolume: 0,
    liveWatchers: null,
    sourceLabel: "PropertyFinder UAE Data",
  },
};
const AUTO_REFRESH_MS = 20 * 1000;
const DEFAULT_PAGES = 3;
const DEFAULT_LOCATION_IDS = "1,2,3";

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

export default function DashboardPage() {
  const {
    propertyType,
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

  const loadDashboardData = useCallback(async (options = {}) => {
    const { force = false, attempt = 0 } = options;

    try {
      setIsRefreshing(true);
      const response = await fetch(
        `/api/dashboard?pages=${DEFAULT_PAGES}&locationIds=${encodeURIComponent(
          DEFAULT_LOCATION_IDS
        )}${force ? "&force=1" : ""}`,
        { cache: "no-store" }
      );
      const payload = await response.json();

      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? "Dashboard API request failed");
      }

      setDashboardData({
        listings: Array.isArray(payload.listings) ? payload.listings : [],
        meta: {
          ...emptyDashboardData.meta,
          ...payload.meta,
        },
      });
      setClockMs(Date.now());
    } catch (error) {
      console.error("Failed to load dashboard data", error);

      if (attempt < 3) {
        window.setTimeout(() => {
          loadDashboardData({ force, attempt: attempt + 1 });
        }, 1200 * (attempt + 1));
      }
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

  const filters = useMemo(
    () => ({
      propertyType,
      activeArea,
    }),
    [propertyType, activeArea]
  );

  const visibleMapListings = useMemo(
    () => applyListingFilters(dashboardData.listings, filters, false),
    [dashboardData.listings, filters]
  );
  const filteredListings = useMemo(
    () =>
      sortListings(
        applyListingFilters(dashboardData.listings, filters, true),
        sortBy
      ),
    [dashboardData.listings, filters, sortBy]
  );
  const areaSummaries = useMemo(
    () => getAreaSummaries(visibleMapListings),
    [visibleMapListings]
  );
  const stats = useMemo(
    () => getDashboardStats(visibleMapListings),
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
    <main className="dashboard-shell min-h-screen pb-14 text-white">
      <TopBanner listingScanVolume={dashboardData.meta.listingScanVolume} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <NavBar
          stats={stats}
          lastUpdatedSeconds={lastUpdatedSeconds}
          onRefresh={() => loadDashboardData({ force: true })}
          isRefreshing={isRefreshing}
          liveWatchers={dashboardData.meta.liveWatchers}
        />
        <AudienceBadges />
        <FilterBar
          propertyType={propertyType}
          pricePeriod={pricePeriod}
          sortBy={sortBy}
          activeArea={activeArea}
          onPropertyTypeChange={setPropertyType}
          onPricePeriodChange={setPricePeriod}
          onSortChange={setSortBy}
          onClearArea={clearActiveArea}
        />
        <StatsCards
          stats={stats}
          lastUpdatedSeconds={lastUpdatedSeconds}
          listingScanVolume={dashboardData.meta.listingScanVolume}
        />
        <TimestampDivider count={filteredListings.length} />
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
    </main>
  );
}
