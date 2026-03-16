import { formatNumber } from "@/lib/format";

export default function TopBanner({ listingScanVolume }) {
  return (
    <div className="border-b border-white/5 bg-black/80">
      <div className="mx-auto flex h-9 max-w-7xl items-center px-4 text-[11px] uppercase tracking-[0.28em] text-white/55 sm:px-6 lg:px-8">
        <p className="truncate text-[#ff2d55]">
          {listingScanVolume
            ? `Now live: tracking ${formatNumber(listingScanVolume)} Dubai rental listings in this scan.`
            : "Now live: Dubai rental listing tracking is coming online."}
        </p>
      </div>
    </div>
  );
}
