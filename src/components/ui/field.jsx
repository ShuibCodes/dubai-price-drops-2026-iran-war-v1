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
        className={`az-input ${as === "textarea" ? "resize-y leading-snug" : ""} ${trailing ? "pr-16" : ""} ${className}`}
        {...props}
      />
      {trailing ? (
        <div className="pointer-events-none absolute bottom-2.5 right-4 font-mono text-[10px] text-ghost">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
