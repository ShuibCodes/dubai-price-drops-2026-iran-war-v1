"use client";

import clsx from "clsx";

export default function DashboardViewToggle({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[20px] border border-white/10 bg-black/40 p-1.5 sm:gap-3">
      <span className="mono hidden pl-2 text-[10px] uppercase tracking-[0.28em] text-white/35 sm:inline">
        Market
      </span>
      <button
        type="button"
        onClick={() => onChange("rent")}
        className={clsx(
          "rounded-2xl px-5 py-2.5 text-sm font-semibold transition",
          value === "rent"
            ? "bg-[#ff2d55] text-white shadow-[0_8px_24px_rgba(255,45,85,0.35)]"
            : "text-white/55 hover:text-white"
        )}
      >
        Rent
      </button>
      <button
        type="button"
        onClick={() => onChange("sales")}
        className={clsx(
          "rounded-2xl px-5 py-2.5 text-sm font-semibold transition",
          value === "sales"
            ? "bg-[#2563eb] text-white shadow-[0_8px_24px_rgba(37,99,235,0.35)]"
            : "text-white/55 hover:text-white"
        )}
      >
        Sales
      </button>
    </div>
  );
}
