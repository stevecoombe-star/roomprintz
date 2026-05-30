"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type CollectionImportResponse = {
  collectionImport?: {
    import?: {
      id?: string | null;
      updated_at?: string | null;
    };
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

const BANNER_DISMISS_KEY_PREFIX = "vibode:dismissedFurnitureCollectionBanner";

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildDismissKey(importId: string | null, updatedAt: string | null): string | null {
  if (!importId || !updatedAt) return null;
  return `${BANNER_DISMISS_KEY_PREFIX}:${encodeURIComponent(importId)}:${encodeURIComponent(updatedAt)}`;
}

export function LatestFurnitureCollectionImportBanner() {
  const pathname = usePathname();
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

  const importId = asOptionalString(collectionImport?.import?.id);
  const importUpdatedAt = asOptionalString(collectionImport?.import?.updated_at);
  const dismissKey = buildDismissKey(importId, importUpdatedAt);

  useEffect(() => {
    if (!dismissKey) {
      setIsDismissed(false);
      return;
    }
    try {
      setIsDismissed(window.localStorage.getItem(dismissKey) === "1");
    } catch {
      setIsDismissed(false);
    }
  }, [dismissKey]);

  function dismissBanner() {
    if (dismissKey) {
      try {
        window.localStorage.setItem(dismissKey, "1");
      } catch {
        // Ignore localStorage write failures and still hide in this view.
      }
    }
    setIsDismissed(true);
  }

  if (isLoading || isDismissed || !collectionImport) return null;

  const partnerName = collectionImport.partner?.name?.trim() || "Furniture Partner";
  const collectionName = collectionImport.collection?.name?.trim() || "Furniture Collection";
  const isEditorContext = pathname === "/editor";
  const viewCollectionHref = collectionImport.publicUrl
    ? isEditorContext
      ? `${collectionImport.publicUrl}${
          collectionImport.publicUrl.includes("?") ? "&" : "?"
        }returnTo=editor`
      : collectionImport.publicUrl
    : null;
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
            {viewCollectionHref ? (
              <Link
                href={viewCollectionHref}
                className="rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs text-emerald-100 hover:border-emerald-300 hover:text-white"
              >
                View collection
              </Link>
            ) : null}
            {isEditorContext ? (
              <Link
                href="/editor?newRoom=1"
                className="rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs text-emerald-100 hover:border-emerald-300 hover:text-white"
              >
                Upload your room
              </Link>
            ) : (
              <a
                href="#auth-panel"
                className="rounded-lg border border-emerald-400/60 px-2.5 py-1 text-xs text-emerald-100 hover:border-emerald-300 hover:text-white"
              >
                Upload your room
              </a>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={dismissBanner}
          className="self-start rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500 hover:text-slate-100"
        >
          Dismiss
        </button>
      </div>
      {/* TODO(vibode-furniture-collections): connect this context to explicit collection-aware start flow. */}
    </section>
  );
}
