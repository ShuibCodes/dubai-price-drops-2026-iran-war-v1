export function Row({ title, sub, right, leading, onClick, className = "" }) {
  const interactive = typeof onClick === "function";
  return (
    <div
      className={`flex w-full items-center gap-3 border-b border-rule px-0 py-4 text-left last:border-b-0 ${interactive ? "cursor-pointer hover:bg-surface-2/60" : ""} ${className}`}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick(event);
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-ink">{title}</div>
        {sub ? (
          <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
            {sub}
          </div>
        ) : null}
      </div>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
