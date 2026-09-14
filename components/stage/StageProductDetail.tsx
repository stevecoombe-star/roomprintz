"use client";

import {
  favoriteKey,
  formatStagePrice,
  resolveStagePlacement,
  stageAssetById,
  stageProductById,
  stageVariantById,
} from "@/lib/vibode-stage/catalog";
import { useStageEditor } from "@/components/stage/StageEditorContext";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageProductDetail() {
  const stage = useStageEditor();
  const product = stage.detailProductId
    ? stageProductById(stage.detailProductId, stage.extraProducts, stage.catalog)
    : null;
  if (!product) return null;
  const variant = stageVariantById(
    product.defaultVariantId,
    stage.extraVariants,
    stage.catalog,
  );
  const placement = resolveStagePlacement({
    productId: product.productId,
    variantId: product.defaultVariantId,
    extras: stage.extraProducts,
    extraVariants: stage.extraVariants,
    catalog: stage.catalog,
  });
  const asset = placement ? stageAssetById(placement.assetId, stage.catalog) : null;
  const canAdd = Boolean(placement);
  const favorited = stage.favorites.has(favoriteKey(product.productId, product.defaultVariantId));
  const price = formatStagePrice(
    variant?.priceAmount ?? product.priceAmount,
    variant?.priceCurrency ?? product.priceCurrency,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-stage-product-detail={product.productId}>
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
          disabled={!canAdd}
          onClick={() => stage.addProductToRoom(product.productId, product.defaultVariantId)}
          className={`flex-1 rounded-md border px-3 py-2 text-xs ${FOCUS} ${
            canAdd
              ? "border-neutral-600 bg-neutral-100 text-neutral-950 hover:bg-white"
              : "border-neutral-800 bg-neutral-950 text-neutral-600"
          }`}
        >
          Add to Room
        </button>
        <button
          type="button"
          aria-pressed={favorited}
          onClick={() => stage.toggleFavorite(product.productId, product.defaultVariantId)}
          className={`rounded-md border border-neutral-700 px-2.5 py-2 text-sm ${FOCUS} ${
            favorited ? "text-rose-300" : "text-neutral-400"
          }`}
        >
          {favorited ? "♥" : "♡"}
        </button>
      </div>
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
