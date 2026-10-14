export function Check({
  checked,
  onChange,
  disabled,
  locked,
  children,
  meta,
  className = "",
}) {
  const frozen = disabled || locked;
  return (
    <label
      className={`flex items-start gap-3.5 border-b border-hairline py-4 last:border-b-0 ${
        frozen ? "cursor-default opacity-80" : "cursor-pointer"
      } ${className}`}
    >
      <input
        checked={Boolean(checked)}
        className="mt-0.5 h-[17px] w-[17px] shrink-0 accent-az"
        disabled={frozen}
        onChange={(event) => onChange?.(event.target.checked)}
        type="checkbox"
      />
      <span className="min-w-0 flex-1 text-[15px] leading-6 text-fg">
        {children}
      </span>
      {meta ? <span className="shrink-0 pt-0.5">{meta}</span> : null}
    </label>
  );
}
