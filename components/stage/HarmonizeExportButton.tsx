"use client";

import { useEffect, useState } from "react";

import { useHarmonizeExportControl } from "@/components/stage/HarmonizeExportContext";
import { harmonizeExportErrorMessage } from "@/lib/vibode-stage/harmonize-export";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

function useIsVibodeAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/admin-access", { method: "POST", cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { isAdmin?: unknown }) => {
        if (!cancelled) setIsAdmin(payload?.isAdmin === true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return isAdmin;
}

export function HarmonizeExportButton() {
  const isAdmin = useIsVibodeAdmin();
  const control = useHarmonizeExportControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isAdmin || !control) return null;

  const onClick = () => {
    if (busy || !control.ready) return;
    setBusy(true);
    setError(null);
    void control.run().then(() => {
      setBusy(false);
    }, (failure: unknown) => {
      setBusy(false);
      setError(harmonizeExportErrorMessage(failure));
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        data-harmonize-export="true"
        aria-label="Harmonize Export"
        aria-busy={busy}
        disabled={!control.ready || busy}
        title={error ?? "Prepare reference images for manual harmonization"}
        onClick={onClick}
        className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
          !control.ready || busy
            ? "border-neutral-900 bg-neutral-950 text-neutral-600"
            : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        {busy ? "Exporting…" : "Harmonize Export"}
      </button>
      {error ? (
        <p
          role="alert"
          className="absolute right-0 top-full z-40 mt-1 w-72 rounded border border-red-900 bg-neutral-950 px-2 py-1 text-[11px] leading-snug text-red-200"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
