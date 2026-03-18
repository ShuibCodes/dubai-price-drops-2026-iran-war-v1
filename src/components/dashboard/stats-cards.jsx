"use client";

import { motion } from "framer-motion";
import {
  formatCurrency,
  formatDropAmount,
  formatNumber,
  formatSignedPercent,
} from "@/lib/format";

const cardMeta = [
  { key: "biggestPercent", label: "Top Gap", emoji: "🔥", accent: "border-[#ff2d55]" },
  { key: "biggestAmount", label: "Top AED", emoji: "💰", accent: "border-[#ffd60a]" },
  { key: "scanVolume", label: "Scanned", emoji: "📊", accent: "border-white/25" },
  { key: "totalSavings", label: "Total Gap", emoji: "🦋", accent: "border-[#ff2d55]" },
];

export default function StatsCards({ stats, lastUpdatedSeconds, listingScanVolume }) {
  const values = {
    biggestPercent: {
      value: formatSignedPercent(stats.biggestDrop?.baselineDiffPercent ?? 0),
      subtitle: `${stats.biggestDrop?.community ?? "Dubai"} · ${stats.biggestDrop?.bedrooms ?? 0}BR`,
      color: "text-[#ff2d55]",
    },
    biggestAmount: {
      value: formatDropAmount(stats.biggestAmountDrop?.baselineDiffAmount ?? 0, { compact: true }),
      subtitle: `Pre-war avg ${formatCurrency(stats.biggestAmountDrop?.baselinePrice ?? 0, {
        compact: true,
      })} · ${stats.biggestAmountDrop?.area ?? "Dubai"}`,
      color: "text-[#ffd60a]",
    },
    scanVolume: {
      value: formatNumber(listingScanVolume),
      subtitle:
        lastUpdatedSeconds === null
          ? "Updated: --"
          : `Updated: ${lastUpdatedSeconds}s ago`,
      color: "text-white",
    },
    totalSavings: {
      value: formatDropAmount(stats.totalSavings ?? 0, { compact: true }),
      subtitle: `Across ${formatNumber(stats.totalDrops)} below-average listings`,
      color: "text-[#ff2d55]",
    },
  };

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cardMeta.map((card, index) => {
        const content = values[card.key];

        return (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.06 }}
            className={`rounded-[24px] border border-white/10 border-t-2 ${card.accent} bg-white/[0.03] p-4 sm:p-5`}
          >
            <div className="flex items-center justify-between">
              <div className="mono text-[11px] uppercase tracking-[0.28em] text-white/40">
                {card.label}
              </div>
              <div className="text-lg leading-none">{card.emoji}</div>
            </div>
            <div className={`mono mt-4 text-xl font-semibold sm:mt-6 sm:text-3xl ${content.color}`}>
              {content.value}
            </div>
            <div className="mt-2 text-xs text-white/45 sm:mt-3 sm:text-sm">{content.subtitle}</div>
          </motion.div>
        );
      })}
    </section>
  );
}
