"use client";

import { useEffect, useRef, useState } from "react";

import {
  copyAfcDiagnosticSelectedAttemptExport,
  type AfcDiagnosticSelectedAttemptExportSource,
} from "./admin-selected-attempt-export";

export type AfcDiagnosticSelectedAttemptCopyState = "idle" | "copied" | "failed";

export function afcDiagnosticSelectedAttemptCopyLabel(
  state: AfcDiagnosticSelectedAttemptCopyState,
): "Copy JSON" | "Copied" | "Copy failed" {
  if (state === "copied") return "Copied";
  if (state === "failed") return "Copy failed";
  return "Copy JSON";
}

export function AfcDiagnosticSelectedAttemptCopyJsonButton({
  source,
}: {
  source: AfcDiagnosticSelectedAttemptExportSource;
}) {
  const [state, setState] = useState<AfcDiagnosticSelectedAttemptCopyState>("idle");
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
      aria-label="Copy selected attempt JSON"
      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
      onClick={() => {
        void (async () => {
          const result = await copyAfcDiagnosticSelectedAttemptExport(source);
          setState(result.ok ? "copied" : "failed");
          if (timeoutRef.current != null) {
            window.clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = window.setTimeout(() => {
            setState("idle");
          }, 1500);
        })();
      }}
    >
      {afcDiagnosticSelectedAttemptCopyLabel(state)}
    </button>
  );
}
