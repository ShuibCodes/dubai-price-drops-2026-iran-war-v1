export function Toggle({ checked, onChange, disabled, label, className = "" }) {
  return (
    <button
      aria-checked={Boolean(checked)}
      aria-label={label}
      className={`relative h-6 w-10 rounded-full border transition ${
        checked ? "border-live bg-live/20" : "border-rule-2 bg-surface"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
      disabled={disabled}
      onClick={() => {
        if (!disabled && onChange) onChange(!checked);
      }}
      role="switch"
      type="button"
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full transition ${
          checked ? "right-0.5 bg-live" : "left-0.5 bg-ink-3"
        }`}
      />
    </button>
  );
}
