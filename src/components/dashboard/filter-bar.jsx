import { ArrowDownWideNarrow, MapPin, MapPinned } from "lucide-react";
import { sortOptions } from "@/lib/store";

export default function FilterBar({
  sortBy,
  activeArea,
  areaOptions = [],
  onSortChange,
  onAreaChange,
  onClearArea,
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-2 flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/35">
              <MapPin className="h-4 w-4" />
              Area filter
            </div>
            {activeArea && (
              <button
                type="button"
                onClick={onClearArea}
                className="inline-flex items-center gap-2 rounded-full border border-[#00e5ff]/25 bg-[#00e5ff]/10 px-4 py-2 text-sm text-white"
              >
                <MapPinned className="h-4 w-4 text-[#00e5ff]" />
                {activeArea} · Clear map
              </button>
            )}
          </div>

          <label className="flex w-full max-w-md flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="inline-flex shrink-0 items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/40">
              <MapPin className="h-3.5 w-3.5" />
              Select area
            </span>
            <select
              value={activeArea ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) {
                  onClearArea();
                } else {
                  onAreaChange(value);
                }
              }}
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/35 px-4 py-2.5 text-sm text-white outline-none transition focus:border-[#ff2d55]/40"
            >
              <option value="" className="bg-[#111111]">
                All areas (current scan)
              </option>
              {areaOptions.map((name) => (
                <option key={name} value={name} className="bg-[#111111]">
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/35 px-4 py-2 text-sm text-white/70">
            <ArrowDownWideNarrow className="h-4 w-4 text-white/40" />
            <span>Sort:</span>
            <select
              value={sortBy}
              onChange={(event) => onSortChange(event.target.value)}
              className="bg-transparent text-white outline-none"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-[#111111]">
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}
