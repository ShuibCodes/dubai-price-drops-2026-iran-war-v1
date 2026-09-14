const VARIANT = {
  primary: "az-btn-primary",
  white: "az-btn-white",
  secondary: "az-btn-ghost",
  quiet: "az-btn-quiet",
  ghost:
    "az-btn border border-transparent bg-transparent text-dim hover:text-fg",
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
      className={`${VARIANT[variant] || VARIANT.primary} ${className}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
