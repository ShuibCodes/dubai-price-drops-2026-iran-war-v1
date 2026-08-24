"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";

function formatDateTick(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatMonthYear(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatRange(start, end) {
  const a = formatMonthYear(start);
  const b = formatMonthYear(end);
  if (!a && !b) return "";
  if (a === b) return a;
  return `${a} — ${b}`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-xl border border-white/[0.12] bg-[#0b0b0f]/95 px-3 py-2 shadow-2xl backdrop-blur-md">
      <p className="text-xs font-medium text-white">{formatDateTick(label)}</p>
      <p className="mt-1 text-[11px] text-white/60">
        Sales: <span className="font-medium text-white">{row?.count?.toLocaleString()}</span>
      </p>
      <p className="text-[11px] text-white/60">
        Avg price: <span className="font-medium text-white">{formatCurrency(row?.avgPrice, { compact: true })}</span>
      </p>
    </div>
  );
}

export default function MacroTimelineChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/transactions-csv")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load transaction data");
        return r.json();
      })
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setData(payload);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const pctChange = useMemo(() => {
    if (!data?.summary?.preWarAvg) return null;
    return ((data.summary.postWarAvg - data.summary.preWarAvg) / data.summary.preWarAvg) * 100;
  }, [data]);

  if (loading) {
    return (
      <div className="mb-4 flex h-[200px] items-center justify-center rounded-[20px] border border-white/8 bg-black/20">
        <Loader2 size={20} className="animate-spin text-white/30" />
      </div>
    );
  }

  if (error || !data?.timeline?.length) {
    return null;
  }

  const { summary, timeline } = data;

  return (
    <div className="mb-5 rounded-[20px] border border-white/8 bg-black/25 p-3 sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.22em] text-white/35">
            Macro view
          </p>
          <h3 className="mt-1 text-sm font-semibold text-white sm:text-base">
            Dubai sales since conflict began
          </h3>
          <p className="mt-0.5 text-[11px] text-white/45">
            {summary.totalTransactions.toLocaleString()} transactions
            {formatRange(summary.dateStart, summary.dateEnd)
              ? ` · ${formatRange(summary.dateStart, summary.dateEnd)}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em]">
          <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2.5 py-1 text-blue-300">
            Pre-war {formatCurrency(summary.preWarAvg, { compact: true })}
          </span>
          <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-amber-300">
            Post-war {formatCurrency(summary.postWarAvg, { compact: true })}
            {pctChange !== null && (
              <span className="ml-1 text-white/50">
                ({pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%)
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="h-[min(220px,38vh)] w-full min-h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
              tickFormatter={formatDateTick}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<ChartTooltip />} />
            {summary.warStart && (
              <ReferenceLine
                x={summary.warStart}
                stroke="#ef4444"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{
                  value: "Conflict",
                  position: "insideTopRight",
                  fill: "#ef4444",
                  fontSize: 10,
                  dy: 8,
                }}
              />
            )}
            <Line
              type="monotone"
              dataKey="count"
              name="Daily sales"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 1 }}
              animationDuration={900}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
