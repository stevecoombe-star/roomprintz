"use client";

import { useEffect, useRef, useState } from "react";

export function AdminDiagnosticsCopyButton({
  value,
  ariaLabel,
}: {
  value: string;
  ariaLabel: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
          if (timeoutRef.current != null) {
            window.clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = window.setTimeout(() => {
            setState("idle");
          }, 1500);
        })();
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}
