"use client";

import { useState } from "react";

export function Drop({ accept, onFiles, children, hint, className = "" }) {
  const [over, setOver] = useState(false);

  function take(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length) onFiles?.(files);
  }

  return (
    <label
      className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition ${
        over ? "border-az-hover bg-az-wash" : "border-az bg-az-wash"
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
      <span className="pointer-events-none text-[21px] font-semibold text-fg">
        {children || "Drop files here"}
      </span>
      {hint ? (
        <span className="pointer-events-none mt-2 text-[15px] text-dim">
          {hint}
        </span>
      ) : null}
      <span className="pointer-events-none mt-5 az-btn-primary">
        Choose files
      </span>
    </label>
  );
}
