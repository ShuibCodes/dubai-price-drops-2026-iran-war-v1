"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, MapPin } from "lucide-react";
import { formatCurrency, formatDropAmount, formatGainAmount, formatUnsignedPercent, formatAreaTimestamp } from "@/lib/format";
import { hasValue } from "@/lib/display";
import { getSignalMetrics } from "@/lib/dashboard-data";

const PAGE_SIZE = 6;

export default function ListingsFeed({
  listings,
  pricePeriod,
  activeArea,
  onClearArea,
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [timestamp, setTimestamp] = useState("");

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [listings]);

  useEffect(() => {
    setTimestamp(formatAreaTimestamp(new Date()));
    const interval = window.setInterval(() => {
      setTimestamp(formatAreaTimestamp(new Date()));
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleListings = listings.slice(0, visibleCount);
  const hasMore = listings.length > visibleCount;

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:rounded-[32px] sm:p-6">
      <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
        <div>
          <h2 className="text-base font-semibold text-white sm:text-lg">
            {listings.length} pre-war gaps detected
          </h2>
          {timestamp && (
            <p className="mt-0.5 text-xs text-white/45">{timestamp} GMT+4</p>
          )}
        </div>
        {activeArea ? (
          <button
            onClick={onClearArea}
            className="shrink-0 rounded-full border border-[#00e5ff]/25 bg-[#00e5ff]/10 px-3 py-1.5 text-xs text-white"
          >
            {activeArea} · Clear
          </button>
        ) : (
          <div className="mono shrink-0 text-[10px] uppercase tracking-[0.22em] text-white/30">
            Map click filters
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {listings.length === 0 && (
          <div className="rounded-[20px] border border-dashed border-white/12 bg-black/35 px-6 py-10 text-center text-sm text-white/45">
            No listings match the current filters.
          </div>
        )}

        {visibleListings.map((listing, index) => {
          const signal = getSignalMetrics(listing);
          const isBelowPreWar = signal.hasData && signal.amount > 0;
          const isAbovePreWar = signal.hasData && signal.amount <= 0;

          const priceColor = isBelowPreWar
            ? "text-[#ffd60a]"
            : isAbovePreWar
              ? "text-[#34d399]"
              : "text-white/40";

          const priceLabel = isBelowPreWar
            ? formatDropAmount(signal.amount, { compact: true })
            : isAbovePreWar
              ? formatGainAmount(signal.amount, { compact: true })
              : formatCurrency(listing.currentPrice, { compact: true });

          const pctLabel = isBelowPreWar
            ? `▼ ${formatUnsignedPercent(signal.percent)} below pre-war`
            : isAbovePreWar
              ? `▲ ${formatUnsignedPercent(signal.percent)} above pre-war`
              : null;

          return (
            <motion.article
              key={listing.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.12) }}
              className="rounded-[18px] border border-white/8 bg-black/35 px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <div className="mono mt-0.5 w-7 shrink-0 text-sm font-bold text-[#ffd60a]">
                  #{index + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold leading-snug text-white">
                      {listing.title}
                    </h3>
                    {hasValue(listing.propertyUrl) && (
                      <a
                        href={listing.propertyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-full bg-[#16a34a] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white transition hover:bg-[#15803d]"
                      >
                        View
                      </a>
                    )}
                  </div>

                  <div className="mt-1 flex items-center gap-1.5 text-xs text-white/40">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{listing.community} · {listing.area}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
                      {listing.type}
                    </span>
                    {hasValue(listing.daysOnMarket) && (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
                        {listing.daysOnMarket}d on market
                      </span>
                    )}
                    {listing.validated && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/55">
                        <CheckCircle2 className="h-3 w-3 text-[#00e5ff]" />
                        Verified
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-2 border-t border-white/6 pt-3">
                    <div>
                      <div className={`mono text-lg font-bold leading-none ${priceColor}`}>
                        {priceLabel}
                      </div>
                      {pctLabel && (
                        <div className={`mono mt-1 text-[10px] uppercase tracking-[0.18em] ${priceColor} opacity-75`}>
                          {pctLabel}
                        </div>
                      )}
                    </div>
                   
                  </div>
                </div>
              </div>
            </motion.article>
          );
        })}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-xs uppercase tracking-[0.22em] text-white/55 transition hover:bg-white/[0.06] hover:text-white"
            >
              Show more
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
