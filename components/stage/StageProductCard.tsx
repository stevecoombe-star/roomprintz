"use client";

import { favoriteKey } from "@/lib/vibode-stage/catalog";
import { formatStagePrice } from "@/lib/vibode-stage/catalog";
import type { StageProduct } from "@/lib/vibode-stage/types";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageProductCard({
  product,
  favorited,
  added,
  canAdd,
  addPending = false,
  addError = null,
  onOpen,
  onToggleFavorite,
  onAdd,
}: {
  product: StageProduct;
  favorited: boolean;
  added: boolean;
  canAdd: boolean;
  addPending?: boolean;
  addError?: string | null;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onAdd: () => void;
}) {
  const price = formatStagePrice(product.priceAmount, product.priceCurrency);
  return (
    <article
      className="group rounded-lg bg-neutral-900/40 p-1.5 transition hover:bg-neutral-900"
      data-stage-product-card={product.productId}
      data-favorite-key={favoriteKey(product.productId, product.defaultVariantId)}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`block w-full overflow-hidden rounded-md bg-neutral-800 ${FOCUS}`}
        aria-label={`${product.name} details`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- catalog thumbnails are static STAGE fixtures or remote previews */}
        <img
          src={product.imageUrl}
          alt=""
          className="aspect-[4/3] w-full object-cover"
        />
      </button>
      <div className="mt-1.5 min-w-0 px-0.5">
        <div className="truncate text-[10px] uppercase tracking-wide text-neutral-500">
          {product.brand}
        </div>
        <div className="truncate text-xs text-neutral-100">{product.name}</div>
        {price ? (
          <div className="mt-0.5 text-xs text-neutral-300">{price}</div>
        ) : (
          <div className="mt-0.5 text-xs text-neutral-500">Price on request</div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between px-0.5">
        <button
          type="button"
          aria-label={favorited ? "Remove favorite" : "Favorite"}
          aria-pressed={favorited}
          onClick={onToggleFavorite}
          className={`rounded-md px-1.5 py-0.5 text-sm ${FOCUS} ${
            favorited ? "text-rose-300" : "text-neutral-500 hover:text-neutral-200"
          }`}
        >
          {favorited ? "♥" : "♡"}
        </button>
        <button
          type="button"
          aria-label={`Add ${product.name}`}
          disabled={!canAdd || addPending}
          data-stage-add-pending={addPending ? "true" : "false"}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onClick={onAdd}
          className={`rounded-md border px-2 py-0.5 text-xs ${FOCUS} ${
            !canAdd || addPending
              ? "border-neutral-800 bg-neutral-950 text-neutral-600"
              : added
                ? "border-emerald-500/50 bg-emerald-950/50 text-emerald-100"
                : "border-neutral-700 bg-neutral-950 text-neutral-200 hover:bg-neutral-800"
          }`}
        >
          {addPending ? "Adding…" : added ? "✓ Added" : "+"}
        </button>
      </div>
      {addError ? (
        <div className="mt-1 px-0.5 text-[11px] text-amber-200" role="alert">
          {addError}
        </div>
      ) : null}
    </article>
  );
}
