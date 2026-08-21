export function Field({
  as = "input",
  className = "",
  trailing,
  ...props
}) {
  const Comp = as;
  return (
    <div className="relative">
      <Comp
        className={`w-full rounded-md border border-rule-2 bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-2 ${as === "textarea" ? "resize-none" : ""} ${trailing ? "pr-16" : ""} ${className}`}
        {...props}
      />
      {trailing ? (
        <div className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] text-ink-3">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
