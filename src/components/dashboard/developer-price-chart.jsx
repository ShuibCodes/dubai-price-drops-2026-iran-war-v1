"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/format";

function formatTick(value) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

export default function DeveloperPriceChart({ developerStats }) {
  const data = useMemo(() => {
    return [...(developerStats ?? [])]
      .map((row) => ({
        ...row,
        shortName:
          row.name.length > 22 ? `${row.name.slice(0, 20)}…` : row.name,
      }))
      .reverse();
  }, [developerStats]);

  if (!data.length) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-[24px] border border-dashed border-white/15 text-sm text-white/45">
        No developer stats yet — wait for data or refresh.
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <motion.div
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[#3b82f6] to-transparent opacity-80"
        animate={{ x: ["-100%", "100%"] }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      <div className="relative z-[1] mb-4">
        <h3 className="text-lg font-semibold text-white">Developers by avg ask</h3>
        <p className="mt-1 text-xs text-white/45">
          4 lowest &amp; 4 highest average listing price (AED). Hourly refresh.
        </p>
      </div>

      <div className="relative z-[1] h-[min(340px,55vh)] w-full min-h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
            barCategoryGap={10}
          >
            <defs>
              <linearGradient id="barBlue" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1d4ed8" />
                <stop offset="100%" stopColor="#60a5fa" />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis
              type="number"
              dataKey="avgPrice"
              tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
              tickFormatter={formatTick}
              axisLine={{ stroke: "rgba(255,255,255,0.12)" }}
            />
            <YAxis
              type="category"
              dataKey="shortName"
              width={118}
              tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(59,130,246,0.08)" }}
              contentStyle={{
                background: "#0b0b0f",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelStyle={{ color: "#fff" }}
              formatter={(val) => [formatCurrency(val, { compact: true }), "Avg"]}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.name ?? ""}
            />
            <Bar
              dataKey="avgPrice"
              fill="url(#barBlue)"
              radius={[0, 8, 8, 0]}
              maxBarSize={22}
              animationDuration={1400}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
