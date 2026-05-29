"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CollectionImportResponse = {
  collectionImport?: {
    partner?: {
      name?: string | null;
      logo_url?: string | null;
    };
    collection?: {
      name?: string | null;
    };
    itemCount?: number;
    publicUrl?: string;
  } | null;
};

export function LatestFurnitureCollectionImportBanner() {
  const [isLoading, setIsLoading] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const [collectionImport, setCollectionImport] = useState<
    NonNullable<CollectionImportResponse["collectionImport"]> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/vibode/furniture-collections/imports/latest", {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) return;
        const payload = (await response.json().catch(() => ({}))) as CollectionImportResponse;
        if (!cancelled) {
          setCollectionImport(payload.collectionImport ?? null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading || isDismissed || !collectionImport) return null;

  const partnerName = collectionImport.partner?.name?.trim() || "Furniture Partner";
  const collectionName = collectionImport.collection?.name?.trim() || "Furniture Collection";
  const itemCount =
    typeof collectionImport.itemCount === "number" && Number.isFinite(collectionImport.itemCount)
      ? Math.max(0, Math.trunc(collectionImport.itemCount))
      : null;

  return (
    <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-200">
            Furniture Collection added
          </p>
          <p className="text-sm text-slate-100">
            {collectionName} by {partnerName}
            {itemCount !== null ? ` (${itemCount} item${itemCount === 1 ? "" : "s"})` : ""}
          </p>
          <p className="text-xs text-slate-200/90">
            Upload or select a room to try these pieces.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {collectionImport.publicUrl ? (
              <Link
                href={collectionImport.publicUrl}
                className="rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs text-emerald-100 hover:border-emerald-300 hover:text-white"
              >
                View collection
              </Link>
            ) : null}
            <a
              href="#auth-panel"
              className="rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs text-emerald-100 hover:border-emerald-300 hover:text-white"
            >
              Upload your room
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="self-start rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100"
        >
          Dismiss
        </button>
      </div>
      {/* TODO(vibode-furniture-collections): connect this context to explicit collection-aware start flow. */}
    </section>
  );
}
