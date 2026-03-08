"use client";

import { useEffect, useMemo, useState } from "react";
import TopBanner from "@/components/dashboard/top-banner";
import NavBar from "@/components/dashboard/nav-bar";
import AudienceBadges from "@/components/dashboard/audience-badges";
import Hero from "@/components/dashboard/hero";
import FilterBar from "@/components/dashboard/filter-bar";
import StatsCards from "@/components/dashboard/stats-cards";
import TimestampDivider from "@/components/dashboard/timestamp-divider";
import ListingsFeed from "@/components/dashboard/listings-feed";
import { getAreaSummaries, getDashboardStats } from "@/lib/dashboard-data";
import { useDashboardStore } from "@/lib/store";

const emptyDashboardData = {
  listings: [],
  meta: {
    updatedAt: null,
    listingScanVolume: 0,
    liveWatchers: null,
    snapshotDataAvailable: false,
    sourceLabel: "PropertyFinder UAE Data",
  },
};

function getListingTimestamp(listing) {
  return new Date(listing.listedDate ?? listing.lastScanned ?? 0);
}

function sortListings(items, sortBy, snapshotDataAvailable) {
  const sortedItems = [...items];

  sortedItems.sort((left, right) => {
    if (sortBy === "biggestSavings") {
      if (!snapshotDataAvailable) {
        return (right.currentPrice ?? 0) - (left.currentPrice ?? 0);
      }

      return right.dropAmount - left.dropAmount;
    }

    if (sortBy === "newest") {
      return getListingTimestamp(right) - getListingTimestamp(left);
    }

    if (!snapshotDataAvailable) {
      return getListingTimestamp(right) - getListingTimestamp(left);
    }

    return right.dropPercent - left.dropPercent;
  });

  return sortedItems;
}

function applyListingFilters(items, filters, includeArea = true) {
  return items.filter((listing) => {
    if (filters.propertyType !== "all" && listing.type !== filters.propertyType) {
      return false;
    }

    if (
      filters.onlyTenPercentDrops &&
      typeof listing.dropPercent === "number" &&
      listing.dropPercent < 10
    ) {
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
    onlyTenPercentDrops,
    onlyExpatAreas,
    pricePeriod,
    sortBy,
    activeArea,
    setPropertyType,
    toggleTenPercentDrops,
    toggleExpatAreas,
    setPricePeriod,
    setSortBy,
    setActiveArea,
    clearActiveArea,
  } = useDashboardStore();

  const [liveMinutes, setLiveMinutes] = useState(4);
  const [dashboardData, setDashboardData] = useState(emptyDashboardData);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setLiveMinutes((current) => (current >= 12 ? 3 : current + 1));
    }, 20000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadDashboardData() {
      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });
        const payload = await response.json();

        if (!ignore) {
          setDashboardData({
            listings: Array.isArray(payload.listings) ? payload.listings : [],
            meta: {
              ...emptyDashboardData.meta,
              ...payload.meta,
            },
          });
        }
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      }
    }

    loadDashboardData();

    return () => {
      ignore = true;
    };
  }, []);

  const filters = useMemo(
    () => ({
      propertyType,
      onlyTenPercentDrops,
      onlyExpatAreas,
      activeArea,
    }),
    [propertyType, onlyTenPercentDrops, onlyExpatAreas, activeArea]
  );

  const visibleMapListings = useMemo(
    () => applyListingFilters(dashboardData.listings, filters, false),
    [dashboardData.listings, filters]
  );
  const filteredListings = useMemo(
    () =>
      sortListings(
        applyListingFilters(dashboardData.listings, filters, true),
        sortBy,
        dashboardData.meta.snapshotDataAvailable
      ),
    [dashboardData.listings, dashboardData.meta.snapshotDataAvailable, filters, sortBy]
  );
  const areaSummaries = useMemo(() => getAreaSummaries(visibleMapListings), [visibleMapListings]);
  const stats = useMemo(() => getDashboardStats(visibleMapListings), [visibleMapListings]);

  return (
    <main className="dashboard-shell min-h-screen pb-14 text-white">
      <TopBanner listingScanVolume={dashboardData.meta.listingScanVolume} />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <NavBar
          stats={stats}
          liveMinutes={liveMinutes}
          liveWatchers={dashboardData.meta.liveWatchers}
          snapshotDataAvailable={dashboardData.meta.snapshotDataAvailable}
        />
        <AudienceBadges />
        <FilterBar
          propertyType={propertyType}
          onlyTenPercentDrops={onlyTenPercentDrops}
          onlyExpatAreas={onlyExpatAreas}
          pricePeriod={pricePeriod}
          sortBy={sortBy}
          activeArea={activeArea}
          onPropertyTypeChange={setPropertyType}
          onToggleTenPercentDrops={toggleTenPercentDrops}
          onToggleExpatAreas={toggleExpatAreas}
          onPricePeriodChange={setPricePeriod}
          onSortChange={setSortBy}
          onClearArea={clearActiveArea}
          snapshotDataAvailable={dashboardData.meta.snapshotDataAvailable}
        />
        <StatsCards
          stats={stats}
          liveMinutes={liveMinutes}
          listingScanVolume={dashboardData.meta.listingScanVolume}
          snapshotDataAvailable={dashboardData.meta.snapshotDataAvailable}
        />
        <TimestampDivider
          count={filteredListings.length}
          snapshotDataAvailable={dashboardData.meta.snapshotDataAvailable}
        />
        <ListingsFeed
          listings={filteredListings}
          pricePeriod={pricePeriod}
          activeArea={activeArea}
          onClearArea={clearActiveArea}
          snapshotDataAvailable={dashboardData.meta.snapshotDataAvailable}
        />
        <Hero
          activeArea={activeArea}
          clearActiveArea={clearActiveArea}
          onAreaSelect={setActiveArea}
          areaSummaries={areaSummaries}
          snapshotDataAvailable={dashboardData.meta.snapshotDataAvailable}
        />
      </div>
    </main>
  );
}
