"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import DeveloperPriceChart from "@/components/dashboard/developer-price-chart";
import SalesListingsFeed from "@/components/dashboard/sales-listings-feed";
import { formatNumber } from "@/lib/format";

const REFRESH_MS = 60 * 60 * 1000;

const emptySales = {
  listings: [],
  developerStats: [],
  meta: { updatedAt: null, resultCount: 0 },
};

export default function SalesDashboard({ homeHref = "/live-updates" }) {
  const [data, setData] = useState(emptySales);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nextRefreshIn, setNextRefreshIn] = useState(null);

  const load = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/sales-search${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error ?? "Sales API failed");
      }
      setData({
        listings: Array.isArray(json.listings) ? json.listings : [],
        developerStats: Array.isArray(json.developerStats) ? json.developerStats : [],
        meta: json.meta ?? {},
      });
    } catch (e) {
      console.error(e);
      setError(e.message ?? "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => load(false), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const expires = data.meta?.cacheExpiresAt
      ? new Date(data.meta.cacheExpiresAt).getTime()
      : null;
    if (!expires) {
      setNextRefreshIn(null);
      return;
    }
    const tick = () => {
      const sec = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
      setNextRefreshIn(sec);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [data.meta?.cacheExpiresAt]);

  return (
    <div className="dashboard-shell min-h-screen pb-10 text-white sm:pb-14">
      <div className="border-b border-white/5 bg-black/80">
        <div className="mx-auto flex h-auto min-h-8 max-w-7xl flex-col gap-1 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-white/55 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-[11px] lg:px-8">
          <p className="text-[#60a5fa]">
            {data.meta?.resultCount
              ? `${formatNumber(data.meta.resultCount)} Dubai for-sale listings with pre-war vs post-war pricing.`
              : "Loading sales snapshot…"}
          </p>
          {nextRefreshIn != null && (
            <p className="text-white/40">
              Cache refresh in {Math.floor(nextRefreshIn / 60)}m {nextRefreshIn % 60}s
            </p>
          )}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-5 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <p className="mono text-[10px] uppercase tracking-[0.24em] text-white/35">
              Developer view
            </p>
            <h1 className="mt-1 text-xl font-bold text-white sm:text-2xl">
              Dubai developers · sales charts
            </h1>
          </motion.div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={homeHref}
              className="inline-flex items-center justify-center rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/70 transition hover:text-white"
            >
              Main view
            </Link>
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading}
              className="shrink-0 rounded-full border border-[#2563eb]/40 bg-[#2563eb]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#93c5fd] transition hover:bg-[#2563eb]/25 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Force refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <DeveloperPriceChart developerStats={data.developerStats} />
        <SalesListingsFeed listings={data.listings} />
      </div>
    </div>
  );
}
