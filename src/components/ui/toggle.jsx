export function Toggle({ checked, onChange, disabled, label, className = "" }) {
  const on = Boolean(checked);
  return (
    <button
      aria-checked={on}
      aria-label={label}
      className={`flex h-[30px] w-[52px] flex-none rounded-full p-[3px] transition-colors ${
        on ? "justify-end bg-az" : "justify-start bg-[#242927]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
      disabled={disabled}
      onClick={() => {
        if (!disabled && onChange) onChange(!on);
      }}
      role="switch"
      type="button"
    >
      <span
        className={`block h-6 w-6 rounded-full ${on ? "bg-az-ink" : "bg-[#4b524f]"}`}
      />
    </button>
  );
}
