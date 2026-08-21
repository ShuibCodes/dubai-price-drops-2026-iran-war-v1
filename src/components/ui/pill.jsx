const TONE = {
  live: "border-live/40 bg-live/10 text-live",
  draft: "border-warn/40 bg-warn/10 text-warn",
  warn: "border-warn/40 bg-warn/10 text-warn",
  required: "border-rule-2 bg-surface-2 text-ink-2",
  markup: "border-markup/40 bg-markup/10 text-markup",
};

export function Pill({ tone = "required", children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-label ${TONE[tone] || TONE.required} ${className}`}
    >
      {children}
    </span>
  );
}
