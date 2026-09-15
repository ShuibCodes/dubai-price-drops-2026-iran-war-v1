"use client";

import { motion } from "framer-motion";

const TALLY_ALERTS_URL = "https://v37rb5zaj0q.typeform.com/to/sNvd0VTd";

export default function AlertButton() {
  return (
    <motion.a
      href={TALLY_ALERTS_URL}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.8 }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.96 }}
      className="fixed bottom-6 right-5 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-[#ff2d55] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(255,45,85,0.45)] transition-shadow hover:shadow-[0_12px_40px_rgba(255,45,85,0.6)] sm:bottom-8 sm:right-8 sm:px-5 sm:py-3.5 sm:text-base"
    >
      <span className="text-base leading-none sm:text-lg">🔔</span>
      <span>Get Alerts</span>
    </motion.a>
  );
}
