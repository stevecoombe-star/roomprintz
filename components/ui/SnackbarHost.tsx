"use client";

import React, { useEffect } from "react";

export type Snackbar = {
  id: string;
  message: string;
};

export function SnackbarHost({
  items,
  onRemove,
}: {
  items: Snackbar[];
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    if (items.length === 0) return;

    const timers = items.map((it) =>
      window.setTimeout(() => onRemove(it.id), 2200)
    );

    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [items, onRemove]);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[80] flex flex-col gap-2">
      {items.slice(-3).map((it) => (
        <div
          key={it.id}
          className="max-w-[420px] rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-2 text-sm text-neutral-200 shadow-lg"
        >
          {it.message}
        </div>
      ))}
    </div>
  );
}
