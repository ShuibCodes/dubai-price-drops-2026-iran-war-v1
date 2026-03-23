"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, ExternalLink, MapPin } from "lucide-react";
import {
  formatCurrency,
  formatAreaTimestamp,
  formatDropAmount,
  formatGainAmount,
  formatUnsignedPercent,
} from "@/lib/format";
import { hasValue } from "@/lib/display";

const PAGE_SIZE = 8;

export default function SalesListingsFeed({ listings }) {
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

  const visible = listings.slice(0, visibleCount);
  const hasMore = listings.length > visibleCount;

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:rounded-[32px] sm:p-6">
      <div className="flex flex-col gap-2 border-b border-white/8 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white sm:text-lg">
            {listings.length} sales listings · pre-war comparison
          </h2>
          {timestamp && (
            <p className="mt-0.5 text-xs text-white/45">{timestamp} GMT+4</p>
          )}
        </div>
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[#60a5fa]/80">
          For sale · Bayut / UAE RE2
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {listings.length === 0 && (
          <div className="rounded-[20px] border border-dashed border-white/12 bg-black/35 px-6 py-10 text-center text-sm text-white/45">
            No sales data loaded. Check API key and try refresh.
          </div>
        )}

        {visible.map((listing, index) => (
          <motion.article
            key={listing.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: Math.min(index * 0.02, 0.1) }}
            className="rounded-[18px] border border-white/8 bg-black/35 px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <div className="mono mt-0.5 w-7 shrink-0 text-sm font-bold text-[#60a5fa]">
                #{index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-snug text-white">
                    {listing.title}
                  </h3>
                  {hasValue(listing.propertyUrl) && (
                    <a
                      href={listing.propertyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#2563eb] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white transition hover:bg-[#1d4ed8]"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View
                    </a>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/50">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span>
                    {listing.community ? `${listing.community} · ` : ""}
                    {listing.area}
                  </span>
                  {listing.developerName && (
                    <>
                      <span className="text-white/25">·</span>
                      <span className="text-white/65">{listing.developerName}</span>
                    </>
                  )}
                  {listing.verified && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#2563eb]/40 bg-[#2563eb]/25 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#93c5fd]">
                      <BadgeCheck className="h-3 w-3" />
                      Verified
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
                    {listing.type}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
                    {listing.bedrooms}BR · {listing.bathrooms}BA
                  </span>
                  {listing.completionStatus && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
                      {listing.completionStatus}
                    </span>
                  )}
                </div>

                <div className="mt-3 border-t border-white/6 pt-3">
                  <div className="mono text-lg font-bold text-[#93c5fd]">
                    {formatCurrency(listing.price, { compact: true })}
                  </div>
                  {typeof listing.baselinePrice === "number" && (
                    <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/40">
                      Pre-war avg {formatCurrency(listing.baselinePrice, { compact: true })}
                    </div>
                  )}
                  {typeof listing.baselineDiffAmount === "number" && (
                    <div
                      className={`mt-1 text-[11px] font-semibold ${
                        listing.baselineDiffAmount > 0 ? "text-[#fbbf24]" : "text-[#34d399]"
                      }`}
                    >
                      {listing.baselineDiffAmount > 0
                        ? `${formatDropAmount(listing.baselineDiffAmount, { compact: true })} (${formatUnsignedPercent(
                            listing.baselineDiffPercent ?? 0
                          )} below pre-war)`
                        : `${formatGainAmount(listing.baselineDiffAmount, { compact: true })} (${formatUnsignedPercent(
                            listing.baselineDiffPercent ?? 0
                          )} above pre-war)`}
                    </div>
                  )}
                  {listing.agencyName && (
                    <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
                      {listing.agencyName}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.article>
        ))}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => setVisibleCount((p) => p + PAGE_SIZE)}
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
