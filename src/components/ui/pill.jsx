const TONE = {
  live: "az-pill-live",
  draft: "az-pill-draft",
  warn: "az-pill-draft",
  required: "az-pill-quiet",
  markup: "az-pill-markup",
};

export function Pill({ tone = "required", children, className = "" }) {
  return (
    <span className={`${TONE[tone] || TONE.required} ${className}`}>
      {children}
    </span>
  );
}
