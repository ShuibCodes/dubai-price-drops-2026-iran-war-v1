export function Check({
  checked,
  onChange,
  disabled,
  locked,
  children,
  meta,
  className = "",
}) {
  return (
    <label
      className={`flex items-start gap-3 border-b border-rule py-3 last:border-b-0 ${
        disabled || locked ? "cursor-default opacity-80" : "cursor-pointer"
      } ${className}`}
    >
      <input
        checked={Boolean(checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-live"
        disabled={disabled || locked}
        onChange={(event) => onChange?.(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0 flex-1 text-sm leading-5 text-ink">{children}</span>
      {meta ? <span className="shrink-0 pt-0.5">{meta}</span> : null}
    </label>
  );
}
