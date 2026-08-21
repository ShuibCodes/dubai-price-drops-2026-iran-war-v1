const TONE = {
  default: "border-rule-2 bg-surface-2 text-ink-2",
  warn: "border-warn/30 bg-warn/10 text-warn",
  live: "border-live/30 bg-live/10 text-live",
  markup: "border-markup/30 bg-markup/10 text-markup",
};

export function Strip({ tone = "default", children, className = "", onDismiss }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border px-3 py-2.5 text-sm ${TONE[tone] || TONE.default} ${className}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {typeof onDismiss === "function" ? (
        <button
          className="shrink-0 font-mono text-[10px] uppercase tracking-label text-ink-3 hover:text-ink"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
