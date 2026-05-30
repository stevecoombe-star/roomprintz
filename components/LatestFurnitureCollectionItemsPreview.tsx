"use client";

import { useEffect, useState } from "react";

type LatestFurnitureCollectionItemsPreviewProps = {
  collapseSignal?: number;
  onUseMyFurnitureItemForPasteToPlace?: (userFurnitureId: string) => Promise<boolean> | boolean;
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

type ItemActionState = {
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
  onUseMyFurnitureItemForPasteToPlace,
}: LatestFurnitureCollectionItemsPreviewProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [addByItemId, setAddByItemId] = useState<Record<string, ItemActionState>>({});
  const [placeByItemId, setPlaceByItemId] = useState<Record<string, ItemActionState>>({});
  const [addedToMyFurnitureByItemId, setAddedToMyFurnitureByItemId] = useState<Record<string, boolean>>({});
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
  const remainingItemsCount = materializableItemIds.filter((itemId) => !addedToMyFurnitureByItemId[itemId]).length;

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

  async function materializeItem(itemId: string): Promise<{
    userFurnitureId: string;
    alreadyExisted: boolean;
  }> {
    const response = await fetch(`/api/vibode/furniture-collections/items/${itemId}/materialize`, {
      method: "POST",
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      alreadyExisted?: boolean;
      userFurniture?: {
        id?: string | null;
      } | null;
    };
    if (!response.ok) {
      throw new Error(payload.error || "Could not add this item yet. Please try again.");
    }
    const userFurnitureId = typeof payload.userFurniture?.id === "string" ? payload.userFurniture.id.trim() : "";
    if (!userFurnitureId) {
      throw new Error("Could not prepare this item. Please try again.");
    }
    return {
      userFurnitureId,
      alreadyExisted: Boolean(payload.alreadyExisted),
    };
  }

  async function handleAddToMyFurniture(itemId: string) {
    setShowDismissConfirm(false);
    setAddAllMessage(null);
    setAddAllError(null);
    setAddByItemId((current) => ({
      ...current,
      [itemId]: { status: "loading", message: null },
    }));
    try {
      const result = await materializeItem(itemId);
      setAddedToMyFurnitureByItemId((current) => ({ ...current, [itemId]: true }));
      setAddByItemId((current) => ({
        ...current,
        [itemId]: {
          status: "success",
          message: result.alreadyExisted ? "Already in My Furniture" : "Added to My Furniture",
        },
      }));
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not add this item yet. Please try again.";
      setAddByItemId((current) => ({
        ...current,
        [itemId]: { status: "error", message },
      }));
    }
  }

  async function handlePlaceInRoom(itemId: string) {
    setShowDismissConfirm(false);
    setAddAllMessage(null);
    setAddAllError(null);
    setPlaceByItemId((current) => ({
      ...current,
      [itemId]: { status: "loading", message: null },
    }));
    try {
      const result = await materializeItem(itemId);
      setAddedToMyFurnitureByItemId((current) => ({ ...current, [itemId]: true }));
      setAddByItemId((current) => ({
        ...current,
        [itemId]: {
          status: "success",
          message: result.alreadyExisted ? "Already in My Furniture" : "Added to My Furniture",
        },
      }));
      let isReadyForPasteToPlace = true;
      if (onUseMyFurnitureItemForPasteToPlace) {
        isReadyForPasteToPlace = Boolean(await onUseMyFurnitureItemForPasteToPlace(result.userFurnitureId));
      }
      if (!isReadyForPasteToPlace) {
        throw new Error("Could not prepare this item. Please try again.");
      }
      setPlaceByItemId((current) => ({
        ...current,
        [itemId]: {
          status: "success",
          message: "Ready to place",
        },
      }));
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Could not prepare this item. Please try again.";
      setPlaceByItemId((current) => ({
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

      setAddByItemId((current) => {
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
      setAddedToMyFurnitureByItemId((current) => {
        const next = { ...current };
        for (const item of items) {
          const itemId = typeof item.id === "string" ? item.id.trim() : "";
          if (!itemId) continue;
          const result = resultsById.get(itemId);
          if (!result?.ok) continue;
          next[itemId] = true;
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
              const addState = itemId ? addByItemId[itemId] : undefined;
              const placeState = itemId ? placeByItemId[itemId] : undefined;
              const hasImageFailed = itemId ? Boolean(failedImageByItemId[itemId]) : false;
              const isAdding = addState?.status === "loading";
              const isPreparing = placeState?.status === "loading";
              const isItemBusy = isAdding || isPreparing;
              const hasPlaceError = placeState?.status === "error";
              const hasAddError = addState?.status === "error";
              const isPlaceReady = placeState?.status === "success";
              const productUrl =
                typeof item.product_url === "string" && item.product_url.trim().length > 0
                  ? item.product_url.trim()
                  : null;
              const addActionLabel = isAdding
                ? "Adding..."
                : addState?.status === "success"
                  ? (addState.message ?? "Added to My Furniture")
                  : "Add to My Furniture";
              const placeActionLabel = isPreparing ? "Preparing..." : "Place in room";
              return (
                <article
                  key={item.id ?? `${title}-${item.sort_order ?? 0}`}
                  className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-1.5 transition hover:border-neutral-700"
                >
                  {productUrl ? (
                    <a
                      href={productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group/image relative block rounded border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600"
                    >
                      {item.image_url && !hasImageFailed ? (
                        <div className="aspect-[4/3] w-full overflow-hidden rounded">
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
                        <div className="flex aspect-[4/3] w-full items-center justify-center rounded text-[11px] text-neutral-500">
                          Image unavailable
                        </div>
                      )}
                      <span className="pointer-events-none absolute right-1.5 top-1.5 rounded border border-neutral-600 bg-neutral-900/90 px-1.5 py-0.5 text-[10px] text-neutral-200 opacity-80 transition group-hover/image:opacity-100">
                        View product ↗
                      </span>
                    </a>
                  ) : item.image_url && !hasImageFailed ? (
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
                    <button
                      type="button"
                      disabled={!itemId || isItemBusy}
                      onClick={() => {
                        if (!itemId || isItemBusy) return;
                        void handleAddToMyFurniture(itemId);
                      }}
                      className={`rounded border px-2 py-0.5 text-[11px] ${
                        !itemId
                          ? "border-neutral-700 bg-neutral-800/60 text-neutral-300"
                          : "border-neutral-600 text-neutral-200 hover:border-neutral-500"
                      } disabled:cursor-not-allowed disabled:opacity-80`}
                    >
                      {addActionLabel}
                    </button>
                    <button
                      type="button"
                      disabled={!itemId || isItemBusy}
                      onClick={() => {
                        if (!itemId || isItemBusy) return;
                        void handlePlaceInRoom(itemId);
                      }}
                      className="rounded border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-80"
                    >
                      {placeActionLabel}
                    </button>
                  </div>
                  {hasPlaceError ? (
                    <p className="mt-1.5 text-[11px] text-rose-300">
                      {placeState?.message || "Could not prepare this item. Please try again."}
                    </p>
                  ) : null}
                  {!hasPlaceError && hasAddError ? (
                    <p className="mt-1.5 text-[11px] text-rose-300">
                      {addState?.message || "Could not add this item yet. Please try again."}
                    </p>
                  ) : null}
                  {isPlaceReady ? (
                    <p className="mt-1.5 text-[11px] text-emerald-300">
                      {placeState?.message || "Ready to place"}
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
