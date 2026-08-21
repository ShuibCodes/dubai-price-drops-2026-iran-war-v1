"use client";

import { useState } from "react";

export function Drop({ accept, onFiles, children, className = "" }) {
  const [over, setOver] = useState(false);

  function take(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length) onFiles?.(files);
  }

  return (
    <label
      className={`relative flex cursor-pointer flex-col items-center justify-center border border-dashed px-4 py-8 text-center text-sm transition ${
        over ? "border-live bg-live/5 text-ink" : "border-rule-2 bg-surface text-ink-2"
      } ${className}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer?.files);
      }}
    >
      <input
        accept={accept}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        multiple
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
        type="file"
      />
      <span className="pointer-events-none">
        {children || "Drop files here, or click to choose."}
      </span>
    </label>
  );
}
