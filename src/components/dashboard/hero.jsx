"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";

const DubaiMap = dynamic(() => import("@/components/dashboard/dubai-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-[28px] border border-white/10 bg-black/60 text-sm uppercase tracking-[0.28em] text-white/40">
      Loading Dubai map
    </div>
  ),
});

export default function Hero({
  activeArea,
  clearActiveArea,
  onAreaSelect,
  areaSummaries,
}) {
  return (
    <section>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="rounded-[24px] border border-white/10 bg-white/[0.03] p-2 sm:rounded-[32px] sm:p-4"
      >
        <div className="h-[280px] overflow-hidden rounded-[20px] border border-white/10 bg-black/50 shadow-[0_30px_90px_rgba(0,0,0,0.42)] sm:h-[420px] sm:rounded-[28px] lg:h-[520px]">
          <DubaiMap
            activeArea={activeArea}
            clearActiveArea={clearActiveArea}
            onAreaSelect={onAreaSelect}
            areaSummaries={areaSummaries}
          />
        </div>
      </motion.div>
    </section>
  );
}
