"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  Cell,
  ReferenceLine,
} from "recharts";
import {
  Building2,
  MapPin,
  TrendingDown,
  TrendingUp,
  BarChart3,
  Calendar,
  Crosshair,
  Home,
  Loader2,
  Lock,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";

const TALLY_PREMIUM_URL = "https://tally.so/r/dWAJPr";

const TRANSACTIONS_FULL_ACCESS =
  process.env.NEXT_PUBLIC_TRANSACTIONS_FULL_ACCESS === "true";

const TABS = [
  { id: "byArea", label: "By Area", icon: MapPin },
  { id: "byProject", label: "By Project", icon: Building2 },
  { id: "timeline", label: "Timeline", icon: Calendar },
  { id: "scatter", label: "Price vs Size", icon: Crosshair },
  { id: "byRooms", label: "Bedrooms", icon: Home },
];

const SCATTER_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#6366f1", "#14b8a6", "#f97316",
];

function formatTick(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatDateTick(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatMini({ icon: Icon, label, value, sub, trend }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.15em] text-white/40">
        <Icon size={13} className="opacity-60" />
        {label}
      </div>
      <div className="text-lg font-semibold text-white">{value}</div>
      {sub && (
        <div className={`text-[11px] ${trend === "down" ? "text-red-400" : trend === "up" ? "text-emerald-400" : "text-white/40"}`}>
          {trend === "down" && <TrendingDown size={11} className="mr-1 inline" />}
          {trend === "up" && <TrendingUp size={11} className="mr-1 inline" />}
          {sub}
        </div>
      )}
    </div>
  );
}

/** horizontalBar: Y = categories (vertical stack) + X = values (right). Mask bottom 60% (Y) + right 60% (values). */
/** horizontalValue: timeline, scatter — mask right 60% along the main reading axis. */
/** verticalPrice: By Rooms — Y = price upward; mask top 60%. */
function PremiumChartGate({ children, compact = false, variant = "horizontalValue" }) {
  if (TRANSACTIONS_FULL_ACCESS) {
    return (
      <div
        className={
          compact
            ? "relative min-h-[52px] w-full"
            : "relative h-full w-full min-h-0"
        }
      >
        <div className={compact ? "min-h-[52px] w-full" : "h-full w-full min-h-0"}>{children}</div>
      </div>
    );
  }

  const isVerticalPrice = variant === "verticalPrice";
  const isHorizontalBar = variant === "horizontalBar";
  const cta = (
    <div className="pointer-events-auto flex max-w-[200px] flex-col items-center gap-2 text-center sm:max-w-[220px] sm:gap-2.5">
      <div className="flex items-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/[0.12] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/95">
        <Lock size={12} className="text-amber-400" aria-hidden />
        Premium
      </div>
      <p className="text-[11px] leading-snug text-white/65 sm:text-xs">
        Full scales and breakdowns are for premium members only.
      </p>
      <a
        href={TALLY_PREMIUM_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 px-3 py-2.5 text-[11px] font-semibold text-black shadow-lg shadow-amber-900/30 transition hover:from-amber-500 hover:to-amber-400 sm:text-xs"
      >
        Request premium access
      </a>
      <p className="text-[10px] text-white/35">Opens secure form · Tally</p>
    </div>
  );

  return (
    <div
      className={
        compact
          ? "relative min-h-[52px] w-full"
          : "relative h-full w-full min-h-0"
      }
    >
      <div className={compact ? "min-h-[52px] w-full" : "h-full w-full min-h-0"}>{children}</div>

      {isVerticalPrice ? (
        <>
          <div
            className="absolute inset-x-0 top-0 z-[5] h-[60%] border-b border-white/[0.12]"
            aria-hidden
          >
            <div className="absolute inset-0 bg-gradient-to-b from-[#07070c]/98 via-[#07070c]/85 to-transparent backdrop-blur-xl" />
          </div>
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[60%] flex-col items-center justify-center px-2 sm:px-4 ${compact ? "py-2" : ""}`}
          >
            {cta}
          </div>
        </>
      ) : (
        <>
          {isHorizontalBar && (
            <div className="absolute inset-x-0 bottom-0 z-[4] h-[60%] border-t border-white/[0.08]" aria-hidden>
              <div className="absolute inset-0 bg-gradient-to-t from-[#07070c]/96 via-[#07070c]/72 to-transparent backdrop-blur-xl" />
            </div>
          )}
          <div
            className="absolute inset-y-0 right-0 z-[5] w-[60%] border-l border-white/[0.12]"
            aria-hidden
          >
            <div className="absolute inset-0 bg-gradient-to-l from-[#07070c]/98 via-[#07070c]/78 to-transparent backdrop-blur-xl" />
          </div>
          <div
            className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[60%] flex-col items-center justify-center px-2 sm:px-4 ${compact ? "py-2" : ""}`}
          >
            {cta}
          </div>
        </>
      )}
    </div>
  );
}

function ChartTooltipContent({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.12] bg-[#0b0b0f]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
      <p className="mb-1.5 text-xs font-medium text-white/80">{formatter?.label?.(label) ?? label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-[11px] text-white/60">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-medium text-white">{formatter?.value?.(entry.value) ?? entry.value}</span>
        </p>
      ))}
    </div>
  );
}

function ByAreaChart({ data }) {
  const top = data.slice(0, 15);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }} barGap={2}>
        <defs>
          <linearGradient id="areaBarPre" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1e40af" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="areaBarPost" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#92400e" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={formatTick} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
        <YAxis type="category" dataKey="area" width={140} tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltipContent formatter={{ label: (l) => l, value: (v) => formatCurrency(v, { compact: true }) }} />} />
        <Bar dataKey="preAvg" name="Pre-war avg" fill="url(#areaBarPre)" radius={[0, 4, 4, 0]} maxBarSize={14} animationDuration={1200} />
        <Bar dataKey="postAvg" name="Post-war avg" fill="url(#areaBarPost)" radius={[0, 4, 4, 0]} maxBarSize={14} animationDuration={1200} animationBegin={300} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ByProjectChart({ data }) {
  const top = data.slice(0, 15);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={top} layout="vertical" margin={{ top: 4, right: 20, left: 4, bottom: 4 }} barGap={2}>
        <defs>
          <linearGradient id="projBarPre" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#4c1d95" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
          <linearGradient id="projBarPost" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#065f46" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={formatTick} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
        <YAxis type="category" dataKey="project" width={160} tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltipContent formatter={{ label: (l) => l, value: (v) => formatCurrency(v, { compact: true }) }} />} />
        <Bar dataKey="preAvg" name="Pre-war avg" fill="url(#projBarPre)" radius={[0, 4, 4, 0]} maxBarSize={14} animationDuration={1200} />
        <Bar dataKey="postAvg" name="Post-war avg" fill="url(#projBarPost)" radius={[0, 4, 4, 0]} maxBarSize={14} animationDuration={1200} animationBegin={300} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TimelineChart({ data, warStart }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
        <defs>
          <linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="timelineAvgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={formatDateTick} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} interval={2} />
        <YAxis yAxisId="count" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={formatTick} axisLine={false} tickLine={false} />
        <YAxis yAxisId="avg" orientation="right" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 10 }} tickFormatter={formatTick} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltipContent formatter={{
          label: (l) => formatDateTick(l),
          value: (v) => typeof v === "number" ? (v > 10000 ? formatCurrency(v, { compact: true }) : v.toLocaleString()) : v,
        }} />} />
        {warStart && (
          <ReferenceLine
            x={warStart}
            yAxisId="count"
            stroke="#ef4444"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            label={{ value: "War starts", position: "top", fill: "#ef4444", fontSize: 10, dy: 5 }}
          />
        )}
        <Area yAxisId="count" type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#timelineGrad)" name="Transactions" animationDuration={1400} />
        <Area yAxisId="avg" type="monotone" dataKey="avgPrice" stroke="#f59e0b" strokeWidth={1.5} fill="url(#timelineAvgGrad)" name="Avg price" animationDuration={1400} animationBegin={400} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ScatterPlot({ data }) {
  const roomSet = useMemo(() => [...new Set(data.map((d) => d.rooms))].sort(), [data]);
  const colorMap = useMemo(() => {
    const map = {};
    roomSet.forEach((r, i) => { map[r] = SCATTER_COLORS[i % SCATTER_COLORS.length]; });
    return map;
  }, [roomSet]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 px-1">
        {roomSet.map((r) => (
          <span key={r} className="flex items-center gap-1.5 text-[10px] text-white/50">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colorMap[r] }} />
            {r || "N/A"}
          </span>
        ))}
      </div>
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="size" name="Size (sqm)" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={(v) => `${v}`} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} label={{ value: "Size (sqm)", position: "bottom", offset: -2, fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
            <YAxis type="number" dataKey="amount" name="Price (AED)" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={formatTick} axisLine={false} tickLine={false} label={{ value: "Price (AED)", angle: -90, position: "insideLeft", offset: 10, fill: "rgba(255,255,255,0.3)", fontSize: 10 }} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div className="rounded-xl border border-white/[0.12] bg-[#0b0b0f]/95 px-4 py-3 shadow-2xl backdrop-blur-md">
                  <p className="text-xs font-medium text-white">{d.project || d.area}</p>
                  <p className="mt-1 text-[11px] text-white/50">{d.area} · {d.rooms}</p>
                  <p className="text-[11px] text-white/60">Price: <span className="text-white">{formatCurrency(d.amount, { compact: true })}</span></p>
                  <p className="text-[11px] text-white/60">Size: <span className="text-white">{d.size} sqm</span></p>
                  <p className="text-[11px] text-white/60">Period: <span className={d.period === "pre" ? "text-blue-400" : "text-amber-400"}>{d.period === "pre" ? "Pre-war" : "Post-war"}</span></p>
                </div>
              );
            }} />
            <Scatter data={data} animationDuration={1400}>
              {data.map((entry, idx) => (
                <Cell key={idx} fill={colorMap[entry.rooms] || "#3b82f6"} fillOpacity={entry.period === "pre" ? 0.7 : 0.9} stroke={entry.period === "post" ? "#f59e0b" : "transparent"} strokeWidth={entry.period === "post" ? 1 : 0} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ByRoomsChart({ data }) {
  const ROOM_COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1"];
  const top = data.filter((d) => d.count >= 10).slice(0, 8);

  return (
    <div className="flex h-full flex-col gap-4 sm:flex-row">
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top} margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="roomsBar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#0e7490" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="rooms" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,0.08)" }} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }} tickFormatter={formatTick} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltipContent formatter={{ label: (l) => l, value: (v) => formatCurrency(v, { compact: true }) }} />} />
            <Bar dataKey="avgPrice" name="Avg price" radius={[8, 8, 0, 0]} maxBarSize={48} animationDuration={1200}>
              {top.map((_, i) => (
                <Cell key={i} fill={ROOM_COLORS[i % ROOM_COLORS.length]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-48">
        {top.map((r, i) => (
          <div key={r.rooms} className="flex items-center gap-2 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROOM_COLORS[i % ROOM_COLORS.length] }} />
            <div className="flex-1">
              <p className="text-[11px] font-medium text-white/70">{r.rooms}</p>
              <p className="text-[10px] text-white/40">{r.count.toLocaleString()} sales</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TransactionsExplorer() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("byArea");
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/transactions-csv")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load transaction data");
        return r.json();
      })
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const pctChange = useMemo(() => {
    if (!data?.summary) return null;
    const { preWarAvg, postWarAvg } = data.summary;
    if (!preWarAvg) return null;
    return ((postWarAvg - preWarAvg) / preWarAvg) * 100;
  }, [data]);

  if (loading) {
    return (
      <section>
        <div className="flex h-[320px] items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.03]">
          <Loader2 size={24} className="animate-spin text-white/30" />
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section>
        <div className="flex h-[200px] items-center justify-center rounded-[24px] border border-dashed border-red-500/20 bg-red-500/[0.04] text-sm text-red-300/70">
          {error || "No transaction data available"}
        </div>
      </section>
    );
  }

  return (
    <section>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:p-6"
      >
        {/* Animated accent line */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent opacity-60"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        />

        {/* Header */}
        <div className="relative z-[1] mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <BarChart3 size={18} className="text-amber-400" />
                <h3 className="text-lg font-semibold text-white">Transaction Explorer</h3>
              </div>
              <p className="text-xs text-white/40">
                {data.summary.totalTransactions.toLocaleString()} transactions · Feb 16 — Apr 2, 2026 · Pre-war vs post-war comparison
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-medium text-blue-300">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                Pre-war
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Post-war
              </span>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="relative z-[1] mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatMini
            icon={BarChart3}
            label="Total transactions"
            value={data.summary.totalTransactions.toLocaleString()}
            sub={`${formatCurrency(data.summary.totalValue, { compact: true })} volume`}
          />
          <StatMini
            icon={Building2}
            label="Avg price"
            value={formatCurrency(data.summary.avgPrice, { compact: true })}
            sub={pctChange !== null ? `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}% post-war` : undefined}
            trend={pctChange > 0 ? "up" : pctChange < 0 ? "down" : undefined}
          />
          <StatMini
            icon={TrendingDown}
            label="Pre-war avg"
            value={formatCurrency(data.summary.preWarAvg, { compact: true })}
            sub={`${data.summary.preWarCount.toLocaleString()} transactions`}
          />
          <StatMini
            icon={TrendingUp}
            label="Post-war avg"
            value={formatCurrency(data.summary.postWarAvg, { compact: true })}
            sub={`${data.summary.postWarCount.toLocaleString()} transactions`}
          />
        </div>

        {/* Tab bar */}
        <div className="relative z-[1] mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.06] bg-black/30 p-1 scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-medium transition-all ${
                  isActive
                    ? "bg-white/[0.08] text-white shadow-sm"
                    : "text-white/40 hover:bg-white/[0.03] hover:text-white/60"
                }`}
              >
                <Icon size={13} className={isActive ? "text-amber-400" : "opacity-50"} />
                {tab.label}
                {isActive && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    className="absolute inset-0 rounded-xl border border-white/[0.08]"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Chart area — right half gated for premium */}
        <div className="relative z-[1] h-[380px] w-full sm:h-[440px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="h-full w-full"
            >
              <PremiumChartGate
                variant={
                  activeTab === "byRooms"
                    ? "verticalPrice"
                    : activeTab === "byArea" || activeTab === "byProject"
                      ? "horizontalBar"
                      : "horizontalValue"
                }
              >
                {activeTab === "byArea" && <ByAreaChart data={data.byArea} />}
                {activeTab === "byProject" && <ByProjectChart data={data.byProject} />}
                {activeTab === "timeline" && <TimelineChart data={data.timeline} warStart={data.summary.warStart} />}
                {activeTab === "scatter" && <ScatterPlot data={data.scatter} />}
                {activeTab === "byRooms" && <ByRoomsChart data={data.byRooms} />}
              </PremiumChartGate>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Type breakdown mini-bar — same premium gate */}
        {data.bySubType?.length > 0 && (
          <div className="relative z-[1] mt-5 min-h-[52px]">
            <PremiumChartGate compact>
              <div className="flex min-h-[52px] items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.015] px-4 py-3">
                <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/30">Types</span>
                <div className="flex flex-1 gap-1 overflow-hidden rounded-full">
                  {data.bySubType.map((s) => {
                    const pct = (s.count / data.summary.totalTransactions) * 100;
                    if (pct < 1) return null;
                    const color = s.type === "Flat" ? "#3b82f6" : s.type === "Villa" ? "#10b981" : s.type === "Office" ? "#f59e0b" : "#8b5cf6";
                    return (
                      <div
                        key={s.type}
                        className="h-2 rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: color, minWidth: 4 }}
                        title={`${s.type}: ${s.count.toLocaleString()} (${pct.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>
                <div className="hidden gap-3 sm:flex">
                  {data.bySubType.slice(0, 4).map((s) => {
                    const color = s.type === "Flat" ? "#3b82f6" : s.type === "Villa" ? "#10b981" : s.type === "Office" ? "#f59e0b" : "#8b5cf6";
                    return (
                      <span key={s.type} className="flex items-center gap-1 text-[10px] text-white/40">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                        {s.type}
                      </span>
                    );
                  })}
                </div>
              </div>
            </PremiumChartGate>
          </div>
        )}
      </motion.div>
    </section>
  );
}
