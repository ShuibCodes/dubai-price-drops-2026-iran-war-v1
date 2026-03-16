import { Activity, TrendingDown } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/format";
import { COMING_SOON } from "@/lib/display";

function StatChip({ label, value, accent = "text-white" }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="mono text-[10px] uppercase tracking-[0.24em] text-white/35">{label}</div>
      <div className={`mono mt-1 text-sm font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

export default function NavBar({
  stats,
  lastUpdatedSeconds,
  isRefreshing,
  onRefresh,
  liveWatchers,
}) {
  return (
    <header className="rounded-[28px] border border-white/10 bg-white/[0.03] px-4 py-4 backdrop-blur sm:px-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#ffd60a]/30 bg-[#ffd60a]/10">
              <TrendingDown className="h-5 w-5 text-[#ffd60a]" />
            </div>
            <div>
              <div className="mono text-[10px] uppercase tracking-[0.34em] text-white/35">
                Live Rental Intelligence
              </div>
              <div className="flex items-center gap-2 text-lg font-semibold sm:text-xl">
                <span className="text-[#ffd60a]">PRE-WAR DEALS</span>
                <span className="text-white">DUBAI</span>
              </div>
            </div>
          </div>

          <div className="inline-flex w-fit items-center rounded-full border border-white/10 bg-black/50 p-1">
            <span className="rounded-full px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/25">
              Buy
            </span>
            <span className="rounded-full border border-[#ffd60a]/30 bg-[#ffd60a]/12 px-4 py-2 text-xs uppercase tracking-[0.28em] text-white">
              Rent
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:items-end">
          <div className="flex flex-wrap gap-2">
            <StatChip
              label="Deals Found"
              value={formatNumber(stats.totalDrops)}
            />
            <StatChip
              label="Avg Discount"
              value={formatPercent(stats.averageDrop ?? 0)}
              accent="text-[#ffd60a]"
            />
            <StatChip
              label="Biggest Deal"
              value={formatPercent(stats.biggestDrop?.baselineDiffPercent ?? 0)}
              accent="text-[#ff2d55]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.22em] text-white/50">
            <div className="flex items-center gap-2 text-[#00e5ff]">
              <span className="live-dot h-2.5 w-2.5 rounded-full bg-[#00e5ff]" />
              <span>Scanning Live</span>
            </div>
            <div>
              {lastUpdatedSeconds === null
                ? "Last updated: --"
                : `Last updated: ${lastUpdatedSeconds}s ago`}
            </div>
            <div>
              {liveWatchers ? `${formatNumber(liveWatchers)} watching` : `${COMING_SOON} watchers`}
            </div>
            <div className="flex items-center gap-2 text-white/35">
              <Activity className="h-3.5 w-3.5" />
              Apartments + villas only
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="rounded-full border border-white/10 px-3 py-1 text-[11px] tracking-[0.16em] text-white/70 transition hover:text-white disabled:opacity-50"
            >
              {isRefreshing ? "Refreshing..." : "Refresh now"}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
