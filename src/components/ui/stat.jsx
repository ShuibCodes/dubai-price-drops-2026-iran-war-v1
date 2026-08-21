const TONE = {
  live: "text-live",
  warn: "text-warn",
  markup: "text-markup",
  ink: "text-ink",
};

export function Stat({ n, label, tone = "live", className = "" }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div
        className={`font-mono text-2xl tabular-nums tracking-tight ${TONE[tone] || TONE.live}`}
      >
        {n}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-label text-ink-3">
        {label}
      </div>
    </div>
  );
}
