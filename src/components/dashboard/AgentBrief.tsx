"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, MapPin, Search, Sparkles } from "lucide-react";
import {
  formatCurrency,
  formatDropAmount,
  formatGainAmount,
  formatUnsignedPercent,
} from "@/lib/format";
import { hasValue } from "@/lib/display";

type ParsedFilters = {
  bedrooms: number | null;
  maxPrice: number | null;
  minPrice: number | null;
  area: string | null;
  propertyType: "apartment" | "villa" | null;
  maxDaysOnMarket: number | null;
  belowBaselineOnly: boolean;
};

type Listing = {
  id: string;
  title: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  area: string;
  community: string | null;
  baselinePrice: number | null;
  baselineDiffAmount: number | null;
  baselineDiffPercent: number | null;
  completionStatus: string | null;
  verified: boolean;
  daysOnMarket: number | null;
  coverPhoto: string | null;
  propertyUrl: string | null;
  agencyName: string | null;
  agentName: string | null;
  agentPhone: string | null;
  developerName: string | null;
  type: "apartment" | "villa";
};

type BriefState = {
  filters: ParsedFilters | null;
  results: Listing[];
  error: string | null;
  parseFailed: boolean;
};

const EMPTY_BRIEF_STATE: BriefState = {
  filters: null,
  results: [],
  error: null,
  parseFailed: false,
};

const SEARCH_LIMIT = 3;
const SESSION_ID_STORAGE_KEY = "agentBriefSessionId";

const AREA_ALIASES: Record<string, string[]> = {
  marina: ["marina", "dubai marina"],
  jvc: ["jvc", "jumeirah village circle"],
  jlt: ["jlt", "jumeirah lakes towers"],
  downtown: ["downtown", "downtown dubai"],
  palm: ["palm", "palm jumeirah"],
  businessbay: ["business bay", "businessbay"],
};

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesArea(listing: Listing, areaFilter: string | null) {
  if (!areaFilter) {
    return true;
  }

  const rawFilter = areaFilter.trim().toLowerCase();
  if (!rawFilter) {
    return true;
  }

  const normalizedFilter = normalizeText(rawFilter);
  const aliases = AREA_ALIASES[normalizedFilter] ?? [rawFilter];
  const haystacks = [listing.area, listing.community]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return aliases.some((alias) => {
    const normalizedAlias = normalizeText(alias);
    return haystacks.some((haystack) => {
      const normalizedHaystack = normalizeText(haystack);
      return (
        haystack.includes(alias) ||
        alias.includes(haystack) ||
        normalizedHaystack.includes(normalizedAlias) ||
        normalizedAlias.includes(normalizedHaystack)
      );
    });
  });
}

function matchesFilters(listing: Listing, filters: ParsedFilters) {
  if (filters.bedrooms !== null && listing.bedrooms !== filters.bedrooms) {
    return false;
  }

  if (filters.maxPrice !== null && listing.price > filters.maxPrice) {
    return false;
  }

  if (filters.minPrice !== null && listing.price < filters.minPrice) {
    return false;
  }

  if (filters.propertyType !== null && listing.type !== filters.propertyType) {
    return false;
  }

  if (filters.maxDaysOnMarket !== null) {
    if (listing.daysOnMarket === null || listing.daysOnMarket > filters.maxDaysOnMarket) {
      return false;
    }
  }

  if (filters.belowBaselineOnly && (listing.baselineDiffAmount ?? 0) <= 0) {
    return false;
  }

  if (!matchesArea(listing, filters.area)) {
    return false;
  }

  return true;
}

function rankResults(results: Listing[]) {
  return [...results].sort((left, right) => {
    const leftBelow = (left.baselineDiffAmount ?? 0) > 0;
    const rightBelow = (right.baselineDiffAmount ?? 0) > 0;

    if (leftBelow !== rightBelow) {
      return leftBelow ? -1 : 1;
    }

    return (right.baselineDiffPercent ?? Number.NEGATIVE_INFINITY) - (left.baselineDiffPercent ?? Number.NEGATIVE_INFINITY);
  });
}

function getRelaxedResults(listings: Listing[], filters: ParsedFilters) {
  const strictResults = listings.filter((listing) => matchesFilters(listing, filters));
  if (strictResults.length > 0) {
    return { results: rankResults(strictResults), strategy: "strict" as const };
  }

  // Relax area first because upstream area naming is often sparse/inconsistent.
  if (filters.area) {
    const withoutAreaFilters = { ...filters, area: null };
    const noAreaResults = listings.filter((listing) => matchesFilters(listing, withoutAreaFilters));
    if (noAreaResults.length > 0) {
      return { results: rankResults(noAreaResults), strategy: "no-area" as const };
    }
  }

  // Then relax bedrooms from exact to "at least", while preserving other constraints.
  if (filters.bedrooms !== null) {
    const atLeastBedroomResults = listings.filter((listing) => {
      if (listing.bedrooms < filters.bedrooms) {
        return false;
      }
      if (filters.maxPrice !== null && listing.price > filters.maxPrice) {
        return false;
      }
      if (filters.minPrice !== null && listing.price < filters.minPrice) {
        return false;
      }
      if (filters.propertyType !== null && listing.type !== filters.propertyType) {
        return false;
      }
      if (
        filters.maxDaysOnMarket !== null &&
        (listing.daysOnMarket === null || listing.daysOnMarket > filters.maxDaysOnMarket)
      ) {
        return false;
      }
      if (filters.belowBaselineOnly && (listing.baselineDiffAmount ?? 0) <= 0) {
        return false;
      }
      if (filters.area && !matchesArea(listing, filters.area)) {
        return false;
      }
      return true;
    });

    if (atLeastBedroomResults.length > 0) {
      return { results: rankResults(atLeastBedroomResults), strategy: "bedrooms-at-least" as const };
    }
  }

  return { results: [], strategy: "none" as const };
}

function summarizeFilterMisses(listings: Listing[], filters: ParsedFilters) {
  const misses = {
    bedrooms: 0,
    maxPrice: 0,
    minPrice: 0,
    propertyType: 0,
    maxDaysOnMarket: 0,
    belowBaselineOnly: 0,
    area: 0,
  };

  for (const listing of listings) {
    if (filters.bedrooms !== null && listing.bedrooms !== filters.bedrooms) {
      misses.bedrooms += 1;
      continue;
    }

    if (filters.maxPrice !== null && listing.price > filters.maxPrice) {
      misses.maxPrice += 1;
      continue;
    }

    if (filters.minPrice !== null && listing.price < filters.minPrice) {
      misses.minPrice += 1;
      continue;
    }

    if (filters.propertyType !== null && listing.type !== filters.propertyType) {
      misses.propertyType += 1;
      continue;
    }

    if (filters.maxDaysOnMarket !== null) {
      if (listing.daysOnMarket === null || listing.daysOnMarket > filters.maxDaysOnMarket) {
        misses.maxDaysOnMarket += 1;
        continue;
      }
    }

    if (filters.belowBaselineOnly && (listing.baselineDiffAmount ?? 0) <= 0) {
      misses.belowBaselineOnly += 1;
      continue;
    }

    if (!matchesArea(listing, filters.area)) {
      misses.area += 1;
    }
  }

  return misses;
}

function countMatching(
  listings: Listing[],
  predicate: (listing: Listing) => boolean
) {
  let count = 0;
  for (const listing of listings) {
    if (predicate(listing)) {
      count += 1;
    }
  }
  return count;
}

function formatFilterSummary(filters: ParsedFilters | null) {
  if (!filters) {
    return null;
  }

  const bits = [
    filters.bedrooms !== null ? `${filters.bedrooms}BR` : null,
    filters.propertyType ? filters.propertyType : null,
    filters.area ? filters.area : null,
    filters.maxPrice !== null ? `under ${formatCurrency(filters.maxPrice, { compact: true })}` : null,
    filters.minPrice !== null ? `from ${formatCurrency(filters.minPrice, { compact: true })}` : null,
    filters.maxDaysOnMarket !== null ? `<= ${filters.maxDaysOnMarket}d on market` : null,
    filters.belowBaselineOnly ? "below baseline only" : null,
  ].filter(Boolean);

  return bits.length ? bits.join(" · ") : null;
}

function toWhatsAppLink(phone: string | null) {
  if (!phone) {
    return null;
  }

  const normalized = phone.replace(/[^\d]/g, "");
  if (!normalized) {
    return null;
  }

  return `https://wa.me/${normalized}`;
}

export default function AgentBrief() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [briefState, setBriefState] = useState<BriefState>(EMPTY_BRIEF_STATE);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchesUsed, setSearchesUsed] = useState(0);
  const [sessionId, setSessionId] = useState("");

  const filterSummary = useMemo(
    () => formatFilterSummary(briefState.filters),
    [briefState.filters]
  );
  const searchesRemaining = Math.max(0, SEARCH_LIMIT - searchesUsed);
  const limitReached = searchesRemaining <= 0;

  useEffect(() => {
    const existingId = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existingId) {
      setSessionId(existingId);
      return;
    }

    const generatedId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, generatedId);
    setSessionId(generatedId);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading || limitReached) {
      setHasSearched(true);
      setBriefState({
        filters: null,
        results: [],
        error: "Free brief limit reached. Click Get Alerts to unlock paid unlimited deal matching soon.",
        parseFailed: false,
      });
      return;
    }

    const trimmedQuery = query.trim();
    // #region agent log
    fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
      body: JSON.stringify({
        sessionId: "6e29d8",
        runId: "pre-fix",
        hypothesisId: "H5",
        location: "src/components/dashboard/AgentBrief.tsx:handleSubmit:start",
        message: "Agent brief submit started",
        data: { queryLength: trimmedQuery.length, isEmpty: trimmedQuery.length === 0 },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (!trimmedQuery) {
      setHasSearched(true);
      setBriefState({
        filters: null,
        results: [],
        error: null,
        parseFailed: true,
      });
      return;
    }

    setLoading(true);
    setHasSearched(true);
    setBriefState(EMPTY_BRIEF_STATE);

    try {
      const parseResponse = await fetch("/api/agent-brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Brief-Session": sessionId || "anonymous-session",
        },
        body: JSON.stringify({ message: trimmedQuery }),
      });
      const parsePayload = await parseResponse.json();
      if (typeof parsePayload?.searchesUsed === "number") {
        setSearchesUsed(parsePayload.searchesUsed);
      }
      // #region agent log
      fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
        body: JSON.stringify({
          sessionId: "6e29d8",
          runId: "pre-fix",
          hypothesisId: "H1_H2",
          location: "src/components/dashboard/AgentBrief.tsx:handleSubmit:parseResponse",
          message: "Agent brief parse response received",
          data: {
            ok: parseResponse.ok,
            status: parseResponse.status,
            parsed: Boolean(parsePayload?.parsed),
            hasFilters: Boolean(parsePayload?.filters),
            error: parsePayload?.error ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      if (!parseResponse.ok) {
        throw new Error(parsePayload?.error ?? "Failed to parse brief");
      }

      const filters = parsePayload?.filters as ParsedFilters | undefined;
      if (!parsePayload?.parsed || !filters) {
        setBriefState({
          filters: filters ?? null,
          results: [],
          error: null,
          parseFailed: true,
        });
        return;
      }

      const salesResponse = await fetch("/api/sales-search", {
        cache: "no-store",
      });
      const salesPayload = await salesResponse.json();
      // #region agent log
      fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
        body: JSON.stringify({
          sessionId: "6e29d8",
          runId: "pre-fix",
          hypothesisId: "H3",
          location: "src/components/dashboard/AgentBrief.tsx:handleSubmit:salesResponse",
          message: "Sales listings response received",
          data: {
            ok: salesResponse.ok,
            status: salesResponse.status,
            listingsCount: Array.isArray(salesPayload?.listings) ? salesPayload.listings.length : -1,
            error: salesPayload?.error ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      if (!salesResponse.ok || salesPayload?.error) {
        throw new Error(salesPayload?.error ?? "Failed to load listings");
      }

      const listings = Array.isArray(salesPayload?.listings) ? (salesPayload.listings as Listing[]) : [];
      const { results, strategy } = getRelaxedResults(listings, filters);
      const misses = summarizeFilterMisses(listings, filters);
      const afterBedroomsExact = countMatching(listings, (listing) =>
        filters.bedrooms !== null ? listing.bedrooms === filters.bedrooms : true
      );
      const afterBedroomsAtLeast = countMatching(listings, (listing) =>
        filters.bedrooms !== null ? listing.bedrooms >= filters.bedrooms : true
      );
      const afterArea = countMatching(listings, (listing) => matchesArea(listing, filters.area));
      const afterBelowBaseline = countMatching(
        listings,
        (listing) => !filters.belowBaselineOnly || (listing.baselineDiffAmount ?? 0) > 0
      );
      const resultsAtLeastBedrooms = countMatching(listings, (listing) => {
        if (filters.bedrooms !== null && listing.bedrooms < filters.bedrooms) {
          return false;
        }
        if (filters.maxPrice !== null && listing.price > filters.maxPrice) {
          return false;
        }
        if (filters.minPrice !== null && listing.price < filters.minPrice) {
          return false;
        }
        if (filters.propertyType !== null && listing.type !== filters.propertyType) {
          return false;
        }
        if (
          filters.maxDaysOnMarket !== null &&
          (listing.daysOnMarket === null || listing.daysOnMarket > filters.maxDaysOnMarket)
        ) {
          return false;
        }
        if (filters.belowBaselineOnly && (listing.baselineDiffAmount ?? 0) <= 0) {
          return false;
        }
        if (!matchesArea(listing, filters.area)) {
          return false;
        }
        return true;
      });
      // #region agent log
      fetch("http://127.0.0.1:7865/ingest/e04b9682-c76b-4acd-938a-a9a5c58c5e33", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6e29d8" },
        body: JSON.stringify({
          sessionId: "6e29d8",
          runId: "pre-fix",
          hypothesisId: "H4",
          location: "src/components/dashboard/AgentBrief.tsx:handleSubmit:filtering",
          message: "Filtering complete for parsed brief",
          data: {
            totalListings: listings.length,
            resultsCount: results.length,
            strategy,
            filters,
            misses,
            funnel: {
              afterBedroomsExact,
              afterBedroomsAtLeast,
              afterArea,
              afterBelowBaseline,
              resultsAtLeastBedrooms,
            },
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      setBriefState({
        filters,
        results,
        error: null,
        parseFailed: false,
      });
      setQuery("");
    } catch (error) {
      setBriefState({
        filters: null,
        results: [],
        error: error instanceof Error ? error.message : "Something went wrong",
        parseFailed: false,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] sm:rounded-[32px]">
      <div className="border-b border-white/8 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.24em] text-[#60a5fa]/80">
              Agent brief chat
            </div>
            <h2 className="mt-1 text-lg font-semibold text-white">Describe the deal you want</h2>
            <p className="mt-1 text-sm text-white/55">
              Type a natural brief like <span className="text-white">2bed Marina under 2M below market</span>.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#60a5fa]/25 bg-[#2563eb]/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.16em] text-[#93c5fd]">
            <Sparkles className="h-3.5 w-3.5" />
            AI ranked matches
          </div>
        </div>
        <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/45">
          {limitReached
            ? "Free brief limit reached. Click Get Alerts for paid access soon."
            : `${searchesRemaining} free brief${searchesRemaining === 1 ? "" : "s"} left this session`}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-h-[220px] space-y-3">
          {!hasSearched && (
            <div className="rounded-[20px] border border-dashed border-white/12 bg-black/35 px-5 py-10 text-center text-sm text-white/45">
              Start with a brief and the app will turn it into filters, fetch live listings, and rank the best pricing gaps.
            </div>
          )}

          {briefState.error && (
            <div className="rounded-[20px] border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {briefState.error}
            </div>
          )}

          {briefState.parseFailed && (
            <div className="rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              Try something like: 2bed Marina under 2M
            </div>
          )}

          {!briefState.error && !briefState.parseFailed && filterSummary && (
            <div className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-xs text-white/60">
              {filterSummary}
            </div>
          )}

          {!briefState.error && !briefState.parseFailed && hasSearched && !loading && briefState.results.length === 0 && (
            <div className="rounded-[20px] border border-dashed border-white/12 bg-black/35 px-6 py-10 text-center text-sm text-white/45">
              No results found
            </div>
          )}

          {!briefState.error && !briefState.parseFailed && briefState.results.length > 0 && (
            <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {briefState.results.map((listing) => {
                const belowBaseline = (listing.baselineDiffAmount ?? 0) > 0;
                const gapTone = belowBaseline ? "text-[#34d399]" : "text-[#f87171]";
                const whatsappLink = toWhatsAppLink(listing.agentPhone);

                return (
                  <article
                    key={listing.id}
                    className="overflow-hidden rounded-[20px] border border-white/8 bg-black/35"
                  >
                    <div className="px-4 py-4 sm:px-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex items-start gap-3">
                              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/50">
                                {hasValue(listing.coverPhoto) ? (
                                  <img
                                    src={listing.coverPhoto ?? ""}
                                    alt={listing.title}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.12em] text-white/30">
                                    No image
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-base font-semibold text-white">{listing.title}</h3>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/50">
                                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                                  <span>
                                    {listing.community ? `${listing.community} · ` : ""}
                                    {listing.area}
                                  </span>
                                  {listing.developerName && (
                                    <>
                                      <span className="text-white/25">·</span>
                                      <span>{listing.developerName}</span>
                                    </>
                                  )}
                                  {listing.agencyName && (
                                    <>
                                      <span className="text-white/25">·</span>
                                      <span>{listing.agencyName}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="text-left sm:text-right">
                            <div className="mono text-xl font-bold text-[#93c5fd]">
                              {formatCurrency(listing.price, { compact: true })}
                            </div>
                            <div className={`mono mt-1 text-lg font-bold ${gapTone}`}>
                              {listing.baselineDiffPercent !== null
                                ? `${belowBaseline ? "▼" : "▲"} ${formatUnsignedPercent(listing.baselineDiffPercent)}`
                                : "N/A"}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-white/55">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {listing.bedrooms}BR / {listing.bathrooms}BA / {listing.sqft} sqft
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            {listing.type}
                          </span>
                          {listing.daysOnMarket !== null && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                              {listing.daysOnMarket} days on market
                            </span>
                          )}
                          {listing.completionStatus && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                              {listing.completionStatus}
                            </span>
                          )}
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                              Baseline price
                            </div>
                            <div className="mt-2 text-sm font-semibold text-white">
                              {listing.baselinePrice !== null
                                ? formatCurrency(listing.baselinePrice, { compact: true })
                                : "Not available"}
                            </div>
                          </div>

                          <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                              Pricing gap
                            </div>
                            <div className={`mt-2 text-sm font-semibold ${gapTone}`}>
                              {listing.baselineDiffAmount === null
                                ? "Not available"
                                : belowBaseline
                                  ? `${formatDropAmount(listing.baselineDiffAmount, { compact: true })} below baseline`
                                  : `${formatGainAmount(listing.baselineDiffAmount, { compact: true })} above baseline`}
                            </div>
                          </div>
                        </div>

                        {(hasValue(listing.agentName) || hasValue(whatsappLink)) && (
                          <div className="mt-4">
                            <div className="flex flex-wrap items-center gap-3">
                              {hasValue(listing.agentName) && (
                                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/65">
                                  {listing.agentName}
                                </span>
                              )}
                              {hasValue(whatsappLink) && (
                                <a
                                  href={whatsappLink ?? "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`WhatsApp ${listing.agentName ?? "agent"}`}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#25d366]/35 bg-[#25d366]/20 text-[#86efac] transition hover:bg-[#25d366]/30"
                                >
                                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 fill-current" aria-hidden="true">
                                    <path d="M20.5 3.5A11.9 11.9 0 0 0 12 .5C5.7.5.6 5.6.6 11.9c0 2 .5 3.9 1.4 5.6L.5 23.5l6.2-1.6a11.4 11.4 0 0 0 5.3 1.3h.1c6.3 0 11.4-5.1 11.4-11.4 0-3-1.2-5.9-3-8.3zm-8.4 17.8h-.1c-1.7 0-3.4-.5-4.9-1.4l-.4-.2-3.7 1 1-3.6-.2-.4a9.6 9.6 0 0 1-1.5-5.1c0-5.3 4.3-9.6 9.6-9.6 2.6 0 5 1 6.8 2.8a9.5 9.5 0 0 1 2.8 6.8c0 5.3-4.3 9.7-9.4 9.7zm5.3-7.2c-.3-.2-1.8-.9-2.1-1s-.5-.2-.7.2-.8 1-1 1.2c-.2.2-.4.2-.7.1a7.7 7.7 0 0 1-2.3-1.4 8.6 8.6 0 0 1-1.6-2c-.2-.3 0-.5.1-.7.1-.1.3-.3.4-.5l.3-.4c.1-.2 0-.4 0-.5s-.7-1.8-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.4s-.9.9-.9 2.1c0 1.2.9 2.4 1 2.6.1.2 1.8 2.8 4.3 3.9.6.2 1 .4 1.4.5.6.2 1.2.2 1.6.1.5-.1 1.8-.7 2-1.4.3-.7.3-1.2.2-1.3-.1-.1-.3-.2-.7-.4z" />
                                  </svg>
                                </a>
                              )}
                            </div>
                          </div>
                        )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[22px] border border-white/10 bg-black/40 p-3 sm:p-4"
        >
          <div className="flex flex-col gap-3">
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="2bed Marina under 2M below market"
              disabled={loading || limitReached}
              className="min-h-[88px] w-full resize-none rounded-[18px] border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#2563eb]/40"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-white/35">
                {limitReached
                  ? "Free searches used. Tap Get Alerts to continue with paid access soon."
                  : "One brief in. Ranked sales matches out."}
              </p>
              <button
                type="submit"
                disabled={loading || limitReached}
                className="inline-flex items-center gap-2 rounded-full bg-[#2563eb] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {loading ? "Searching..." : "Send"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
