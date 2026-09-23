"use client";

import { useState } from "react";

import {
  favoriteKey,
  formatStagePrice,
  isStageCommercialActive,
  resolveStagePlacement,
  stageAssetById,
  stageProductById,
  stageVariantById,
  stageVariantsForProduct,
} from "@/lib/vibode-stage/catalog";
import { stageAddLockKey } from "@/lib/vibode-stage/stage-runtime-placement";
import { useStageEditor } from "@/components/stage/StageEditorContext";
import type {
  StageCatalogSnapshot,
  StageProduct,
  StageVariant,
} from "@/lib/vibode-stage/types";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

function resolveSelectedVariantId(
  product: StageProduct,
  requestedVariantId: string,
  extraVariants: readonly StageVariant[],
  catalog: StageCatalogSnapshot,
): string {
  const currentId = requestedVariantId || product.defaultVariantId;
  const current = stageVariantById(currentId, extraVariants, catalog);
  if (
    current &&
    current.productId === product.productId &&
    isStageCommercialActive(current.status)
  ) {
    return currentId;
  }
  const fallback = stageVariantById(
    product.defaultVariantId,
    extraVariants,
    catalog,
  );
  if (fallback && isStageCommercialActive(fallback.status)) {
    return product.defaultVariantId;
  }
  return currentId;
}

export function StageProductDetail() {
  const stage = useStageEditor();
  const product = stage.detailProductId
    ? stageProductById(stage.detailProductId, stage.extraProducts, stage.catalog)
    : null;
  const [requestedVariantId, setSelectedVariantId] = useState("");

  if (!product) return null;
  const selectedVariantId = resolveSelectedVariantId(
    product,
    requestedVariantId,
    stage.extraVariants,
    stage.catalog,
  );
  const variants = stageVariantsForProduct(
    product.productId,
    stage.extraVariants,
    stage.catalog,
  ).filter((item) => isStageCommercialActive(item.status));
  const variant = stageVariantById(
    selectedVariantId || product.defaultVariantId,
    stage.extraVariants,
    stage.catalog,
  );
  const placement = resolveStagePlacement({
    productId: product.productId,
    variantId: selectedVariantId || product.defaultVariantId,
    extras: stage.extraProducts,
    extraVariants: stage.extraVariants,
    catalog: stage.catalog,
  });
  const asset = placement ? stageAssetById(placement.assetId, stage.catalog) : null;
  const canAdd = Boolean(placement);
  const addKey = stageAddLockKey(
    product.productId,
    selectedVariantId || product.defaultVariantId,
  );
  const addPending = stage.addPendingKey === addKey;
  const addError = stage.addErrorKey === addKey ? stage.addError : null;
  const favorited = stage.favorites.has(
    favoriteKey(product.productId, selectedVariantId || product.defaultVariantId),
  );
  const price = formatStagePrice(
    variant?.priceAmount ?? product.priceAmount,
    variant?.priceCurrency ?? product.priceCurrency,
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-stage-product-detail={product.productId}
      data-stage-selected-variant={selectedVariantId || product.defaultVariantId}
    >
      <button
        type="button"
        onClick={stage.closeProductDetail}
        className={`mb-3 self-start rounded-md px-1.5 py-1 text-xs text-neutral-400 hover:text-neutral-100 ${FOCUS}`}
      >
        ← Back
      </button>
      <div className="overflow-hidden rounded-lg bg-neutral-800">
        {/* eslint-disable-next-line @next/next/no-img-element -- catalog hero images are STAGE fixtures or remote previews */}
        <img src={product.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
      </div>
      <div className="mt-3 text-[10px] uppercase tracking-wide text-neutral-500">{product.brand}</div>
      <div className="text-sm font-medium text-neutral-100">{product.name}</div>
      {price ? <div className="mt-1 text-sm text-neutral-200">{price}</div> : null}
      {variants.length > 1 ? (
        <label className="mt-3 block text-xs text-neutral-400">
          <span className="sr-only">Variant</span>
          <select
            aria-label="Variant"
            value={selectedVariantId || product.defaultVariantId}
            onChange={(event) => setSelectedVariantId(event.target.value)}
            className={`mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 ${FOCUS}`}
          >
            {variants.map((item) => {
              const placeable = Boolean(resolveStagePlacement({
                productId: product.productId,
                variantId: item.variantId,
                extras: stage.extraProducts,
                extraVariants: stage.extraVariants,
                catalog: stage.catalog,
              }));
              return (
                <option
                  key={item.variantId}
                  value={item.variantId}
                  disabled={!placeable}
                >
                  {item.finishLabel || item.variantId}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}
      {variant?.finishLabel ? (
        <div className="mt-2 text-xs text-neutral-400">{variant.finishLabel}</div>
      ) : null}
      {asset ? (
        <div className="mt-2 text-xs text-neutral-500">
          {asset.authoredWidthM.toFixed(1)}m × {asset.authoredDepthM.toFixed(1)}m × {asset.authoredHeightM.toFixed(1)}m
        </div>
      ) : (
        <div className="mt-2 text-xs text-neutral-500">
          3D model not available yet. Saved as a catalog product.
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!canAdd || addPending}
          data-stage-add-pending={addPending ? "true" : "false"}
          onClick={() => stage.addProductToRoom(
            product.productId,
            selectedVariantId || product.defaultVariantId,
          )}
          className={`flex-1 rounded-md border px-3 py-2 text-xs ${FOCUS} ${
            canAdd && !addPending
              ? "border-neutral-600 bg-neutral-100 text-neutral-950 hover:bg-white"
              : "border-neutral-800 bg-neutral-950 text-neutral-600"
          }`}
        >
          {addPending ? "Adding…" : "Add to Room"}
        </button>
        <button
          type="button"
          aria-pressed={favorited}
          onClick={() => stage.toggleFavorite(
            product.productId,
            selectedVariantId || product.defaultVariantId,
          )}
          className={`rounded-md border border-neutral-700 px-2.5 py-2 text-sm ${FOCUS} ${
            favorited ? "text-rose-300" : "text-neutral-400"
          }`}
        >
          {favorited ? "♥" : "♡"}
        </button>
      </div>
      {addError ? (
        <div className="mt-2 text-[11px] text-amber-200" role="alert">
          {addError}
        </div>
      ) : null}
      {product.productUrl ? (
        <a
          href={product.productUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 text-xs text-neutral-400 underline decoration-neutral-700 underline-offset-2 hover:text-neutral-200"
        >
          View retailer product
        </a>
      ) : null}
    </div>
  );
}
