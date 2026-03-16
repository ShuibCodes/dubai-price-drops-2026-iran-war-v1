import clsx from "clsx";
import { ArrowDownWideNarrow, MapPinned, SlidersHorizontal } from "lucide-react";
import { sortOptions } from "@/lib/store";

function PillButton({ active, onClick, disabled = false, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "rounded-full border px-4 py-2 text-sm transition",
        disabled && "cursor-not-allowed opacity-55",
        active
          ? "border-[#ff2d55]/30 bg-[#ff2d55]/14 text-white"
          : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

export default function FilterBar({
  propertyType,
  sortBy,
  activeArea,
  onPropertyTypeChange,
  onSortChange,
  onClearArea,
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-white/35">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </div>
          <PillButton active={propertyType === "all"} onClick={() => onPropertyTypeChange("all")}>
            All
          </PillButton>
          <PillButton
            active={propertyType === "apartment"}
            onClick={() => onPropertyTypeChange("apartment")}
          >
            Apartments
          </PillButton>
          <PillButton active={propertyType === "villa"} onClick={() => onPropertyTypeChange("villa")}>
            Villas
          </PillButton>
          {activeArea && (
            <button
              onClick={onClearArea}
              className="inline-flex items-center gap-2 rounded-full border border-[#00e5ff]/25 bg-[#00e5ff]/10 px-4 py-2 text-sm text-white"
            >
              <MapPinned className="h-4 w-4 text-[#00e5ff]" />
              {activeArea}
            </button>
          )}
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
