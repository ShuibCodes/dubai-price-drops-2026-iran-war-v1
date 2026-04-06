"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, MapPin, X, Loader2, ExternalLink, History } from "lucide-react";
import { formatCurrency, formatDropAmount, formatGainAmount, formatUnsignedPercent, formatAreaTimestamp, formatNumber } from "@/lib/format";
import { hasValue } from "@/lib/display";
import { getSignalMetrics } from "@/lib/dashboard-data";

function TransactionModal({ listing, onClose }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null });

  useEffect(() => {
    if (!listing?.propertyUrl) {
      setState({ loading: false, rows: [], error: "No listing URL available" });
      return;
    }

    let cancelled = false;
    setState({ loading: true, rows: [], error: null });

    fetch("/api/listing-transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: listing.propertyUrl }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.status === "ok" && data.rows?.length > 0) {
          setState({ loading: false, rows: data.rows, error: null });
        } else if (data.status === "ok") {
          setState({ loading: false, rows: [], error: null });
        } else {
          setState({ loading: false, rows: [], error: data.message ?? "Could not fetch transactions" });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, rows: [], error: err.message ?? "Network error" });
      });

    return () => { cancelled = true; };
  }, [listing?.propertyUrl]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-[#0e1117] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Transaction History</h3>
            <p className="mt-0.5 truncate text-xs text-white/40">{listing?.title}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {state.loading && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-7 w-7 animate-spin text-[#00e5ff]" />
            <p className="text-xs text-white/45">Fetching transaction history…</p>
          </div>
        )}

        {!state.loading && state.error && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-white/50">{state.error}</p>
            {hasValue(listing?.propertyUrl) && (
              <a
                href={listing.propertyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
              >
                <ExternalLink className="h-3 w-3" />
                Open listing
              </a>
            )}
          </div>
        )}

        {!state.loading && !state.error && state.rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-white/50">No transactions found for this property.</p>
            {hasValue(listing?.propertyUrl) && (
              <a
                href={listing.propertyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
              >
                <ExternalLink className="h-3 w-3" />
                View on PropertyFinder
              </a>
            )}
          </div>
        )}

        {!state.loading && !state.error && state.rows.length > 0 && (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-white/8 [scrollbar-width:thin]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[#0e1117]">
                <tr className="border-b border-white/8 text-[10px] uppercase tracking-[0.14em] text-white/35">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium text-right">Area (sqft)</th>
                  <th className="px-3 py-2 font-medium text-right">Price (AED)</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((row, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2 text-white/60">{row.date ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-white/60">
                      {row.areaSqft != null ? formatNumber(row.areaSqft) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-white/80">
                      {row.priceAed != null ? `AED ${formatNumber(row.priceAed)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default function ListingsFeed({
  listings,
  pricePeriod,
  activeArea,
  onClearArea,
}) {
  const [timestamp, setTimestamp] = useState("");
  const [historyListing, setHistoryListing] = useState(null);
  const [completionFilter, setCompletionFilter] = useState("all");

  useEffect(() => {
    setTimestamp(formatAreaTimestamp(new Date()));
    const interval = window.setInterval(() => {
      setTimestamp(formatAreaTimestamp(new Date()));
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const filteredListings = completionFilter === "all"
    ? listings
    : listings.filter((l) => {
        const status = (l.completionStatus ?? "").toLowerCase();
        const isOffPlan = status === "off-plan" || status === "offplan" || status === "off plan" || status === "under-construction" || status === "under construction";
        return completionFilter === "offplan" ? isOffPlan : !isOffPlan;
      });

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:rounded-[32px] sm:p-6">
      <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
        <div>
          <h2 className="text-base font-semibold text-white sm:text-lg">
            {filteredListings.length} pre-war gaps detected
          </h2>
          {timestamp && (
            <p className="mt-0.5 text-xs text-white/45">{timestamp} GMT+4</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeArea ? (
            <button
              onClick={onClearArea}
              className="rounded-full border border-[#00e5ff]/25 bg-[#00e5ff]/10 px-3 py-1.5 text-xs text-white"
            >
              {activeArea} · Clear
            </button>
          ) : (
            <div className="mono text-[10px] uppercase tracking-[0.22em] text-white/30">
              Map click filters
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 pb-2">
        {["all", "ready", "offplan"].map((value) => {
          const label = value === "all" ? "All" : value === "ready" ? "Ready" : "Off-plan";
          const isActive = completionFilter === value;
          return (
            <button
              key={value}
              onClick={() => setCompletionFilter(value)}
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.14em] transition ${
                isActive
                  ? "border border-[#00e5ff]/40 bg-[#00e5ff]/15 text-white"
                  : "border border-white/8 bg-white/[0.03] text-white/40 hover:bg-white/[0.06] hover:text-white/60"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {filteredListings.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-white/12 bg-black/35 px-6 py-10 text-center text-sm text-white/45">
            No listings match the current filters.
          </div>
        ) : (
          filteredListings.map((listing, index) => {
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
              className="rounded-[18px] border border-white/8 bg-black/35 px-4 py-2.5"
            >
              <div className="flex items-start gap-3">
                <div className="mono mt-0.5 w-7 shrink-0 text-sm font-bold text-[#ffd60a]">
                  #{index + 1}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/45">
                        {hasValue(listing.coverPhoto) ? (
                          <img
                            src={listing.coverPhoto}
                            alt={listing.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[9px] uppercase tracking-[0.12em] text-white/30">
                            No img
                          </div>
                        )}
                      </div>
                      <h3 className="min-w-0 text-sm font-semibold leading-snug text-white">
                        {listing.title}
                      </h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {hasValue(listing.propertyUrl) && (
                        <button
                          onClick={() => setHistoryListing(listing)}
                          className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/60 transition hover:bg-white/10 hover:text-white"
                        >
                          <History className="inline-block h-3 w-3 mr-1 -mt-px" />
                          History
                        </button>
                      )}
                      {hasValue(listing.propertyUrl) && (
                        <a
                          href={listing.propertyUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-[#16a34a] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white transition hover:bg-[#15803d]"
                        >
                          View
                        </a>
                      )}
                    </div>
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
        })
        )}
      </div>

      <AnimatePresence>
        {historyListing && (
          <TransactionModal
            listing={historyListing}
            onClose={() => setHistoryListing(null)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
