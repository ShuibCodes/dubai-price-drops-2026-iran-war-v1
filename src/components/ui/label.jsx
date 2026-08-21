export function Label({ children, className = "", htmlFor }) {
  return (
    <label
      className={`mb-2 block font-mono text-[10px] font-medium uppercase tracking-label text-ink-3 ${className}`}
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}
