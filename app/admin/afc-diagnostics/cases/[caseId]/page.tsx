"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AFC_DIAGNOSTIC_INBOX_COPY,
  parseAfcDiagnosticInboxUuid,
  shortAfcDiagnosticUuid,
} from "@/lib/afc-v2-diagnostics/admin-case-inbox.client";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80";

export default function AfcDiagnosticCasePlaceholderPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const router = useRouter();
  const { caseId: rawCaseId } = use(params);
  const parsed = parseAfcDiagnosticInboxUuid(rawCaseId);
  const fullId = parsed ?? rawCaseId.trim();
  const shortId = parsed ? shortAfcDiagnosticUuid(parsed) : fullId.slice(0, 8);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {AFC_DIAGNOSTIC_INBOX_COPY.detailTitle}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {AFC_DIAGNOSTIC_INBOX_COPY.detailPlaceholder}
            </p>
          </div>
          <button
            type="button"
            className={buttonClassName}
            onClick={() => router.back()}
          >
            {AFC_DIAGNOSTIC_INBOX_COPY.backToDiagnostics}
          </button>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Case ID</p>
          <p className="mt-2 font-mono text-sm text-slate-100" title={fullId}>
            {shortId || "—"}
          </p>
          {fullId ? (
            <p className="mt-1 break-all font-mono text-[11px] text-slate-400" title={fullId}>
              {fullId}
            </p>
          ) : null}
          {fullId ? (
            <button
              type="button"
              className={`${buttonClassName} mt-3`}
              aria-label="Copy Case ID"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(fullId);
                    setCopyState("copied");
                  } catch {
                    setCopyState("failed");
                  }
                  if (timeoutRef.current != null) {
                    window.clearTimeout(timeoutRef.current);
                  }
                  timeoutRef.current = window.setTimeout(() => {
                    setCopyState("idle");
                  }, 1500);
                })();
              }}
            >
              {copyState === "copied"
                ? "Copied"
                : copyState === "failed"
                  ? "Copy failed"
                  : "Copy"}
            </button>
          ) : null}
        </section>
      </div>
    </main>
  );
}
