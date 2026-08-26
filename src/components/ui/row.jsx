export function Row({ title, sub, right, leading, onClick, className = "" }) {
  const interactive = typeof onClick === "function";
  return (
    <div
      className={`az-row last:border-b-0 ${interactive ? "cursor-pointer hover:bg-panel" : ""} ${className}`}
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
        <div className="truncate text-[17px] font-medium text-fg">{title}</div>
        {sub ? (
          <div className="mt-1 truncate text-sm text-dim">{sub}</div>
        ) : null}
      </div>
      {right ? (
        <div className="flex shrink-0 items-center gap-2.5">{right}</div>
      ) : null}
    </div>
  );
}
