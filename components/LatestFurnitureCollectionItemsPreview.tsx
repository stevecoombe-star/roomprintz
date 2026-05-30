"use client";

import { useEffect, useState } from "react";

type LatestFurnitureCollectionItemsPreviewProps = {
  collapseSignal?: number;
};

type CollectionImportItem = {
  id?: string;
  product_name?: string | null;
  product_url?: string | null;
  image_url?: string | null;
  brand?: string | null;
  category?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  sort_order?: number | null;
};

type CollectionImportResponse = {
  collectionImport?: {
    import?: {
      id?: string | null;
      updated_at?: string | null;
    };
    partner?: {
      name?: string | null;
      slug?: string | null;
    };
    collection?: {
      name?: string | null;
      slug?: string | null;
    };
    items?: CollectionImportItem[];
  } | null;
};

type MaterializeState = {
  status: "idle" | "loading" | "success" | "error";
  message: string | null;
};

const PREVIEW_DISMISS_KEY_PREFIX = "vibode:dismissedFurnitureCollectionPreview";
const SHOW_ITEMS_SEEN_KEY_PREFIX = "vibode:partnerCollectionShowItemsSeen";

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildDismissKey(importId: string | null, updatedAt: string | null): string | null {
  if (!importId || !updatedAt) return null;
  return `${PREVIEW_DISMISS_KEY_PREFIX}:${encodeURIComponent(importId)}:${encodeURIComponent(updatedAt)}`;
}

function buildShowItemsSeenKey(importId: string | null, updatedAt: string | null): string {
  if (!importId || !updatedAt) return SHOW_ITEMS_SEEN_KEY_PREFIX;
  return `${SHOW_ITEMS_SEEN_KEY_PREFIX}:${encodeURIComponent(importId)}:${encodeURIComponent(updatedAt)}`;
}

function formatPrice(item: CollectionImportItem): string | null {
  if (typeof item.price_amount !== "number" || !Number.isFinite(item.price_amount)) return null;
  const currency =
    typeof item.price_currency === "string" && item.price_currency.trim().length > 0
      ? item.price_currency.trim().toUpperCase()
      : "CAD";
  return `${currency} ${item.price_amount.toFixed(2)}`;
}

export function LatestFurnitureCollectionItemsPreview({
  collapseSignal = 0,
}: LatestFurnitureCollectionItemsPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [materializeByItemId, setMaterializeByItemId] = useState<Record<string, MaterializeState>>({});
  const [failedImageByItemId, setFailedImageByItemId] = useState<Record<string, boolean>>({});
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [addAllMessage, setAddAllMessage] = useState<string | null>(null);
  const [addAllError, setAddAllError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [hasSeenShowItems, setHasSeenShowItems] = useState(false);
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
        if (!cancelled) setCollectionImport(payload.collectionImport ?? null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = Array.isArray(collectionImport?.items) ? collectionImport.items : [];
  const partnerName = collectionImport?.partner?.name?.trim() || "Furniture Partner";
  const collectionName = collectionImport?.collection?.name?.trim() || "Furniture Collection";
  const partnerSlug = collectionImport?.partner?.slug?.trim() || null;
  const collectionSlug = collectionImport?.collection?.slug?.trim() || null;
  const importId = asOptionalString(collectionImport?.import?.id);
  const importUpdatedAt = asOptionalString(collectionImport?.import?.updated_at);
  const dismissKey = buildDismissKey(importId, importUpdatedAt);
  const showItemsSeenKey = buildShowItemsSeenKey(importId, importUpdatedAt);
  const itemCountLabel = `${items.length} item${items.length === 1 ? "" : "s"}`;
  const materializableItemIds = items
    .map((item) => (typeof item.id === "string" ? item.id.trim() : ""))
    .filter((id) => id.length > 0);
  const remainingItemsCount = materializableItemIds.filter(
    (itemId) => materializeByItemId[itemId]?.status !== "success"
  ).length;

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

  useEffect(() => {
    setShowDismissConfirm(false);
  }, [dismissKey]);

  useEffect(() => {
    try {
      setHasSeenShowItems(window.localStorage.getItem(showItemsSeenKey) === "1");
    } catch {
      setHasSeenShowItems(false);
    }
  }, [showItemsSeenKey]);

  useEffect(() => {
    if (collapseSignal <= 0) return;
    setIsExpanded(false);
  }, [collapseSignal]);

  function markShowItemsSeen() {
    try {
      window.localStorage.setItem(showItemsSeenKey, "1");
    } catch {
      // Ignore localStorage write failures.
    }
    setHasSeenShowItems(true);
  }

  function persistDismiss() {
    if (dismissKey) {
      try {
        window.localStorage.setItem(dismissKey, "1");
      } catch {
        // Ignore localStorage write failures and still hide in this view.
      }
    }
    setIsDismissed(true);
    setShowDismissConfirm(false);
  }

  function dismissPreview() {
    if (remainingItemsCount === 0) {
      persistDismiss();
      return;
    }
    setShowDismissConfirm(true);
  }

  function toggleExpanded() {
    setIsExpanded((current) => {
      const next = !current;
      if (next) {
        markShowItemsSeen();
      }
      return next;
    });
  }

  async function handleMaterializeItem(itemId: string) {
    setShowDismissConfirm(false);
    setAddAllMessage(null);
    setAddAllError(null);
    setMaterializeByItemId((current) => ({
      ...current,
      [itemId]: { status: "loading", message: null },
    }));
    try {
      const response = await fetch(`/api/vibode/furniture-collections/items/${itemId}/materialize`, {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        alreadyExisted?: boolean;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not add this item yet. Please try again.");
      }
      const successMessage = payload.alreadyExisted
        ? "Already in My Furniture"
        : (payload.message ?? "Added to My Furniture.");
      setMaterializeByItemId((current) => ({
        ...current,
        [itemId]: {
          status: "success",
          message: successMessage,
        },
      }));
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not add this item yet. Please try again.";
      setMaterializeByItemId((current) => ({
        ...current,
        [itemId]: { status: "error", message },
      }));
    }
  }

  async function handleMaterializeAll() {
    if (!partnerSlug || !collectionSlug) {
      setAddAllError("Could not add this collection yet. Please refresh and try again.");
      return;
    }
    setShowDismissConfirm(false);
    setIsAddingAll(true);
    setAddAllMessage(null);
    setAddAllError(null);
    try {
      const response = await fetch(
        `/api/vibode/furniture-collections/${partnerSlug}/${collectionSlug}/materialize-all`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        totalCount?: number;
        addedCount?: number;
        alreadyExistedCount?: number;
        failedCount?: number;
        results?: Array<{
          itemId?: string;
          ok?: boolean;
          alreadyExisted?: boolean;
          error?: string;
        }>;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Could not add this collection yet. Please try again.");
      }

      const totalCount = Number(payload.totalCount ?? 0);
      const addedCount = Number(payload.addedCount ?? 0);
      const alreadyExistedCount = Number(payload.alreadyExistedCount ?? 0);
      const failedCount = Number(payload.failedCount ?? 0);

      if (failedCount > 0) {
        setAddAllMessage(
          `Added ${addedCount} item${addedCount === 1 ? "" : "s"}. ${alreadyExistedCount} ${
            alreadyExistedCount === 1 ? "was" : "were"
          } already there. ${failedCount} failed.`
        );
      } else if (addedCount > 0 && alreadyExistedCount === 0) {
        setAddAllMessage(`Added ${addedCount} item${addedCount === 1 ? "" : "s"} to My Furniture.`);
      } else if (addedCount > 0 && alreadyExistedCount > 0) {
        setAddAllMessage(
          `Added ${addedCount} item${addedCount === 1 ? "" : "s"}. ${alreadyExistedCount} ${
            alreadyExistedCount === 1 ? "was" : "were"
          } already there.`
        );
      } else if (totalCount > 0 && alreadyExistedCount === totalCount) {
        setAddAllMessage("All items already in My Furniture.");
      } else {
        setAddAllMessage("Added all to My Furniture.");
      }

      const resultsById = new Map<
        string,
        { ok: boolean; alreadyExisted: boolean; error: string | null }
      >();
      for (const result of payload.results ?? []) {
        const resultItemId = typeof result.itemId === "string" ? result.itemId.trim() : "";
        if (!resultItemId) continue;
        resultsById.set(resultItemId, {
          ok: Boolean(result.ok),
          alreadyExisted: Boolean(result.alreadyExisted),
          error: typeof result.error === "string" ? result.error : null,
        });
      }

      setMaterializeByItemId((current) => {
        const next = { ...current };
        for (const item of items) {
          const itemId = typeof item.id === "string" ? item.id.trim() : "";
          if (!itemId) continue;
          const result = resultsById.get(itemId);
          if (!result) continue;
          if (result.ok) {
            next[itemId] = {
              status: "success",
              message: result.alreadyExisted ? "Already in My Furniture" : "Added to My Furniture",
            };
          } else {
            next[itemId] = {
              status: "error",
              message: result.error || "Could not add this item yet. Please try again.",
            };
          }
        }
        return next;
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not add this collection yet. Please try again.";
      setAddAllError(message);
    } finally {
      setIsAddingAll(false);
    }
  }

  if (isLoading || !collectionImport) return null;
  if (items.length === 0) return null;
  if (isDismissed) return null;

  return (
    <section className="relative z-20 rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-2">
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggleExpanded();
        }}
        className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-md px-1 py-1 transition hover:bg-neutral-800/40"
      >
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-300">Partner Collection</p>
          <p className="truncate text-sm text-neutral-100">
            {collectionName} by {partnerName} · {itemCountLabel}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              dismissPreview();
            }}
            className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded();
            }}
            className={`rounded border px-2 py-1 text-[11px] ${
              !isExpanded && !hasSeenShowItems
                ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-100 shadow-[0_0_0_1px_rgba(16,185,129,0.25)] hover:border-emerald-300"
                : "border-neutral-700 text-neutral-200 hover:border-neutral-500"
            }`}
          >
            {isExpanded ? "Hide items" : "Show items"}
            {!isExpanded && !hasSeenShowItems ? " • New" : ""}
          </button>
        </div>
      </div>
      {showDismissConfirm ? (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <p className="text-[11px] text-amber-100">
            {remainingItemsCount === 1
              ? "1 item hasn't been added to My Furniture yet."
              : `${remainingItemsCount} items haven't been added to My Furniture yet.`}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleMaterializeAll()}
              disabled={isAddingAll}
              className="rounded border border-amber-400/60 px-2 py-0.5 text-[11px] text-amber-100 hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-80"
            >
              {isAddingAll ? "Adding all..." : "Add remaining"}
            </button>
            <button
              type="button"
              onClick={persistDismiss}
              className="rounded border border-neutral-600 px-2 py-0.5 text-[11px] text-neutral-200 hover:border-neutral-500"
            >
              Dismiss anyway
            </button>
            <button
              type="button"
              onClick={() => setShowDismissConfirm(false)}
              className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {isExpanded ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-neutral-400">
              Add individual pieces or add the full collection to My Furniture, then use them with Paste-to-Place.
            </p>
            <div className="flex items-center gap-1.5">
              <span className="rounded border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
                {itemCountLabel}
              </span>
              <button
                type="button"
                onClick={() => void handleMaterializeAll()}
                disabled={isAddingAll}
                className="rounded border border-neutral-600 px-2 py-0.5 text-[11px] text-neutral-200 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-80"
              >
                {isAddingAll ? "Adding all..." : "Add all to My Furniture"}
              </button>
            </div>
          </div>
          {addAllMessage ? <p className="mt-1.5 text-[11px] text-emerald-300">{addAllMessage}</p> : null}
          {addAllError ? <p className="mt-1.5 text-[11px] text-rose-300">{addAllError}</p> : null}

          <div className="mt-2 grid max-h-[55vh] grid-cols-1 gap-1.5 overflow-y-auto pr-1 md:[grid-template-columns:repeat(auto-fill,minmax(220px,280px))] md:justify-start">
            {items.map((item) => {
              const title = item.product_name?.trim() || "Furniture item";
              const price = formatPrice(item);
              const itemId = typeof item.id === "string" && item.id.trim().length > 0 ? item.id : null;
              const materializeState = itemId ? materializeByItemId[itemId] : undefined;
              const hasImageFailed = itemId ? Boolean(failedImageByItemId[itemId]) : false;
              const isAdding = materializeState?.status === "loading";
              const isAdded = materializeState?.status === "success";
              const hasError = materializeState?.status === "error";
              const actionLabel = isAdding
                ? "Adding..."
                : isAdded
                  ? "Added to My Furniture"
                  : "Add to My Furniture";
              return (
                <article
                  key={item.id ?? `${title}-${item.sort_order ?? 0}`}
                  className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-1.5 transition hover:border-neutral-700"
                >
                  {item.image_url && !hasImageFailed ? (
                    <div className="aspect-[4/3] w-full overflow-hidden rounded border border-neutral-800 bg-neutral-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.image_url}
                        alt={title}
                        onError={() => {
                          if (!itemId) return;
                          setFailedImageByItemId((current) => ({ ...current, [itemId]: true }));
                        }}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-[4/3] w-full items-center justify-center rounded border border-neutral-800 bg-neutral-900 text-[11px] text-neutral-500">
                      Image unavailable
                    </div>
                  )}
                  <div className="mt-1.5 space-y-1">
                    <p className="text-xs font-medium text-neutral-100">{title}</p>
                    <p className="text-[11px] text-neutral-400">
                      {item.brand?.trim() || "Unknown brand"}
                      {item.category?.trim() ? ` · ${item.category.trim()}` : ""}
                    </p>
                    {price ? <p className="text-[11px] text-emerald-300">{price}</p> : null}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {item.product_url ? (
                      <a
                        href={item.product_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-200 hover:border-neutral-500"
                      >
                        View product
                      </a>
                    ) : null}
                    <button
                      type="button"
                      disabled={!itemId || isAdding || isAdded}
                      onClick={() => {
                        if (!itemId || isAdding || isAdded) return;
                        void handleMaterializeItem(itemId);
                      }}
                      className={`rounded border px-2 py-0.5 text-[11px] ${
                        !itemId || isAdded
                          ? "border-neutral-700 bg-neutral-800/60 text-neutral-300"
                          : "border-neutral-600 text-neutral-200 hover:border-neutral-500"
                      } disabled:cursor-not-allowed disabled:opacity-80`}
                    >
                      {actionLabel}
                    </button>
                  </div>
                  {hasError ? (
                    <p className="mt-1.5 text-[11px] text-rose-300">
                      {materializeState?.message || "Could not add this item yet. Please try again."}
                    </p>
                  ) : null}
                  {isAdded ? (
                    <p className="mt-1.5 text-[11px] text-emerald-300">
                      Open My Furniture to place it.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
