const TONE = {
  live: "text-az",
  warn: "text-warn",
  markup: "text-markup",
  ink: "text-fg",
  dim: "text-dim",
};

export function Stat({ n, label, sub, tone = "live", className = "" }) {
  const compact = typeof n === "string" && !/^\d+$/.test(String(n).trim());
  return (
    <div
      className={`min-w-[150px] flex-1 ${tone === "live" ? "az-card-live" : "az-card"} p-6.5 ${className}`}
    >
      <div
        className={`font-semibold ${
          compact
            ? "text-[28px] leading-tight tracking-[-.03em]"
            : "text-[52px] leading-none tracking-[-.04em] tabular-nums"
        } ${TONE[tone] || TONE.live}`}
      >
        {n}
      </div>
      <div className="mt-2 text-base text-fg">{label}</div>
      {sub ? <div className="mt-1 text-[13px] text-dim">{sub}</div> : null}
    </div>
  );
}
