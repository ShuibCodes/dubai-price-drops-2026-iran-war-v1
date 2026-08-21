const VARIANT = {
  primary:
    "border border-ink bg-ink text-background hover:opacity-90 disabled:opacity-40",
  secondary:
    "border border-dotted border-ink-2 bg-transparent text-ink hover:border-ink hover:text-ink disabled:opacity-40",
  ghost:
    "border border-transparent bg-transparent text-ink-3 hover:text-ink-2 disabled:opacity-30",
};

export function Button({
  variant = "primary",
  type = "button",
  className = "",
  children,
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition ${VARIANT[variant] || VARIANT.primary} ${className}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
