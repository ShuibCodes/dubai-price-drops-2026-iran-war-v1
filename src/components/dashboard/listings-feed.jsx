"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Clock3, MapPin } from "lucide-react";
import { formatCurrency, formatDropAmount, formatGainAmount, formatUnsignedPercent } from "@/lib/format";
import { COMING_SOON, hasValue } from "@/lib/display";
import { getSignalMetrics } from "@/lib/dashboard-data";

const PAGE_SIZE = 6;

function getBedroomLabel(bedrooms) {
  if (bedrooms === 0) {
    return "Studio";
  }

  return `${bedrooms} BR`;
}

function SignalCard({ signal, listing, pricePeriod }) {
  const isBelowPreWar = signal.hasData && signal.amount > 0;
  const isAbovePreWar = signal.hasData && signal.amount <= 0;

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-4 lg:min-w-[280px]">
      <div className={`mono text-3xl font-semibold ${isBelowPreWar ? "text-[#ffd60a]" : isAbovePreWar ? "text-[#34d399]" : "text-white/45"}`}>
        {isBelowPreWar
          ? formatDropAmount(signal.amount, { compact: true })
          : isAbovePreWar
            ? formatGainAmount(signal.amount, { compact: true })
            : "PRE-WAR AVG COMING SOON"}
      </div>
      <div className={`mono mt-2 text-sm uppercase tracking-[0.28em] ${isBelowPreWar ? "text-[#ffd60a]/70" : isAbovePreWar ? "text-[#34d399]/70" : "text-white/35"}`}>
        {isBelowPreWar
          ? `▼ ${formatUnsignedPercent(signal.percent)} below pre-war`
          : isAbovePreWar
            ? `▲ ${formatUnsignedPercent(signal.percent)} above pre-war (buy now)`
            : "PRE-WAR AVG COMING SOON"}
      </div>
      <div className="mt-4 text-sm text-white/55">
        {hasValue(listing.baselinePrice)
          ? `Pre-war avg ${formatCurrency(listing.baselinePrice)}`
          : `Current ask ${formatCurrency(listing.currentPrice)}`}
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-white/45">
        <Clock3 className="h-4 w-4" />
        {`Current ask ${formatCurrency(listing.currentPrice, {
          period: pricePeriod,
          withPeriod: true,
        })}`}
      </div>
    </div>
  );
}

export default function ListingsFeed({
  listings,
  pricePeriod,
  activeArea,
  onClearArea,
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [listings]);

  const visibleListings = listings.slice(0, visibleCount);
  const hasMore = listings.length > visibleCount;

  return (
    <section className="rounded-[32px] border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mono text-[11px] uppercase tracking-[0.32em] text-white/35">
            Listings feed
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            Best pre-war value gaps in view
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">
            Ranked by how far current asking prices sit below our pre-war area averages.
          </p>
        </div>

        {activeArea ? (
          <button
            onClick={onClearArea}
            className="rounded-full border border-[#00e5ff]/25 bg-[#00e5ff]/10 px-4 py-2 text-sm text-white"
          >
            Viewing {activeArea} • Clear area
          </button>
        ) : (
          <div className="mono text-[11px] uppercase tracking-[0.28em] text-white/35">
            Map click filters this feed
          </div>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {listings.length === 0 && (
          <div className="rounded-[28px] border border-dashed border-white/12 bg-black/35 px-6 py-12 text-center text-white/45">
            No listings match the current filters. Try widening the property type or turning off
            the 10%+ drop filter.
          </div>
        )}

        {visibleListings.map((listing, index) => {
          const signal = getSignalMetrics(listing);

          return (
            <motion.article
              key={listing.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.16) }}
              className="rounded-[28px] border border-white/10 bg-black/35 p-4 sm:p-5"
            >
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex gap-4">
                <div className="mono min-w-[52px] text-2xl font-semibold text-[#ffd60a]">
                  #{index + 1}
                </div>

                <div>
                  <div className="flex flex-wrap items-start gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{listing.title}</h3>
                      <div className="mt-1 flex items-center gap-2 text-sm text-white/45">
                        <MapPin className="h-4 w-4" />
                        {listing.community} · {listing.area}
                      </div>
                    </div>

                    {hasValue(listing.propertyUrl) && (
                      <a
                        href={listing.propertyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs uppercase tracking-[0.24em] text-white/55 transition hover:text-white"
                      >
                        Enquire Now
                      </a>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.22em]">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                      {listing.type}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                      {getBedroomLabel(listing.bedrooms)}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                      {listing.sqft ? `${listing.sqft.toLocaleString()} sqft` : COMING_SOON}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                      {hasValue(listing.daysOnMarket)
                        ? `${listing.daysOnMarket}d on market`
                        : COMING_SOON}
                    </span>
                    {listing.validated && (
                      <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#00e5ff]" />
                        Validated
                      </span>
                    )}
                    {listing.expatArea && (
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                        Expat area
                      </span>
                    )}
                    {listing.familyFriendly && (
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-white/65">
                        Family friendly
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <SignalCard signal={signal} listing={listing} pricePeriod={pricePeriod} />
            </div>
            </motion.article>
          );
        })}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm uppercase tracking-[0.24em] text-white/55 transition hover:bg-white/[0.06] hover:text-white"
            >
              Show more
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
