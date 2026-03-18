import { formatNumber } from "@/lib/format";

export default function TopBanner({ listingScanVolume }) {
  return (
    <div className="border-b border-white/5 bg-black/80">
      <div className="mx-auto flex h-8 max-w-7xl items-center px-4 text-[10px] uppercase tracking-[0.18em] text-white/55 sm:h-9 sm:px-6 sm:text-[11px] sm:tracking-[0.28em] lg:px-8">
        <p className="truncate text-[#ff2d55]">
          {listingScanVolume
            ? `Tracking ${formatNumber(listingScanVolume)} Dubai rentals in this scan.`
            : "Dubai rental tracking is coming online."}
        </p>
      </div>
    </div>
  );
}
