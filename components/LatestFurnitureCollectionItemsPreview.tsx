"use client";

import { useEffect, useState } from "react";

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
    partner?: {
      name?: string | null;
    };
    collection?: {
      name?: string | null;
    };
    items?: CollectionImportItem[];
  } | null;
};

function formatPrice(item: CollectionImportItem): string | null {
  if (typeof item.price_amount !== "number" || !Number.isFinite(item.price_amount)) return null;
  const currency =
    typeof item.price_currency === "string" && item.price_currency.trim().length > 0
      ? item.price_currency.trim().toUpperCase()
      : "CAD";
  return `${currency} ${item.price_amount.toFixed(2)}`;
}

export function LatestFurnitureCollectionItemsPreview() {
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
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

  if (isLoading || !collectionImport) return null;

  const items = Array.isArray(collectionImport.items) ? collectionImport.items : [];
  if (items.length === 0) return null;

  const partnerName = collectionImport.partner?.name?.trim() || "Furniture Partner";
  const collectionName = collectionImport.collection?.name?.trim() || "Furniture Collection";
  const itemCountLabel = `${items.length} item${items.length === 1 ? "" : "s"}`;

  return (
    <section className="relative z-20 rounded-xl border border-neutral-800 bg-neutral-900/70 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-300">Partner Collection</p>
          <p className="truncate text-sm text-neutral-100">
            {collectionName} by {partnerName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">
            {itemCountLabel}
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded((value) => !value)}
            className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:border-neutral-500"
          >
            {isExpanded ? "Hide items" : "Show items"}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur-sm">
          <p className="text-xs text-neutral-400">
            These pieces came from a Furniture Collection. Paste-to-Place support is coming next.
          </p>

          <div className="mt-2 grid max-h-[55vh] grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const title = item.product_name?.trim() || "Furniture item";
              const price = formatPrice(item);
              return (
                <article
                  key={item.id ?? `${title}-${item.sort_order ?? 0}`}
                  className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-2"
                >
                  {item.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.image_url}
                      alt={title}
                      className="h-24 w-full rounded border border-neutral-800 object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center rounded border border-neutral-800 text-[11px] text-neutral-500">
                      No image
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-neutral-100">{title}</p>
                    <p className="text-[11px] text-neutral-400">
                      {item.brand?.trim() || "Unknown brand"}
                      {item.category?.trim() ? ` · ${item.category.trim()}` : ""}
                    </p>
                    {price ? <p className="text-[11px] text-emerald-300">{price}</p> : null}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
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
                    <span className="rounded border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-500">
                      Coming next
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
