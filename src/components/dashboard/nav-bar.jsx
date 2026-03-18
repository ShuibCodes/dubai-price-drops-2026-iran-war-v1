// import { Activity, TrendingDown } from "lucide-react";
// import { formatPercent } from "@/lib/format";

// function StatChip({ label, value, accent = "text-white" }) {
//   return (
//     <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
//       <div className="mono text-[10px] uppercase tracking-[0.24em] text-white/35">{label}</div>
//       <div className={`mono mt-1 text-sm font-semibold ${accent}`}>{value}</div>
//     </div>
//   );
// }

// export default function NavBar({
//   stats,
//   lastUpdatedSeconds,
//   isRefreshing,
//   onRefresh,
// }) {
//   return (
//     <header className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-4 backdrop-blur sm:px-6">
//       <div className="flex flex-col gap-4">
//         <div className="flex items-start justify-between gap-3">
//           <div className="flex min-w-0 items-center gap-3">
//             <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#ffd60a]/30 bg-[#ffd60a]/10">
//               <TrendingDown className="h-5 w-5 text-[#ffd60a]" />
//             </div>
//             <div className="min-w-0">
//               <div className="mono text-[10px] uppercase tracking-[0.28em] text-white/35">
//                 Live rental intelligence
//               </div>
//               <div className="text-lg font-semibold leading-tight sm:text-xl">
//                 <span className="text-[#ffd60a]">Dubai rent deals</span>
//               </div>
//               <div className="mt-1 text-sm text-white/55">
//                 Pre-war gaps across apartments and villas
//               </div>
//             </div>
//           </div>

//           <button
//             type="button"
//             onClick={onRefresh}
//             disabled={isRefreshing}
//             className="shrink-0 rounded-full border border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-white/70 transition hover:text-white disabled:opacity-50"
//           >
//             {isRefreshing ? "Refreshing..." : "Refresh"}
//           </button>
//         </div>

//         <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
//           <StatChip
//             label="Deals"
//             value={String(stats.totalDrops ?? 0)}
//           />
//           <StatChip
//             label="Avg Gap"
//             value={formatPercent(stats.averageDrop ?? 0)}
//             accent="text-[#ffd60a]"
//           />
//           <StatChip
//             label="Top Deal"
//             value={formatPercent(stats.biggestDrop?.baselineDiffPercent ?? 0)}
//             accent="text-[#ff2d55]"
//           />
//         </div>

//         <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-white/50">
//           <div className="flex items-center gap-2 text-[#00e5ff]">
//             <span className="live-dot h-2.5 w-2.5 rounded-full bg-[#00e5ff]" />
//             <span>Scanning live</span>
//           </div>
//           <div>
//             {lastUpdatedSeconds === null
//               ? "Updated: --"
//               : `Updated: ${lastUpdatedSeconds}s ago`}
//           </div>
//           <div className="flex items-center gap-2 text-white/35">
//             <Activity className="h-3.5 w-3.5" />
//             Apartments + villas
//           </div>
//         </div>
//       </div>
//     </header>
//   );
// }

export default function NavBar() {
  return null;
}
