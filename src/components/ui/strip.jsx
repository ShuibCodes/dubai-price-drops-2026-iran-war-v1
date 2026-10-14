const TONE = {
  default: "border-line-2 bg-panel text-fg-2",
  warn: "border-warn-edge bg-warn-wash text-warn",
  live: "border-az-edge bg-az-wash text-az",
  markup: "border-markup-edge bg-markup-wash text-markup",
};

export function Strip({ tone = "default", children, className = "", onDismiss }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4.5 py-3.5 text-[15px] leading-snug ${TONE[tone] || TONE.default} ${className}`}
    >
      <div className="min-w-[180px] flex-1">{children}</div>
      {typeof onDismiss === "function" ? (
        <button
          className="shrink-0 font-mono text-[10px] uppercase tracking-[.12em] text-faint hover:text-fg"
          onClick={onDismiss}
          type="button"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
