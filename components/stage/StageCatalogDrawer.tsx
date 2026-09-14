"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

import { StageProductCard } from "@/components/stage/StageProductCard";
import { StageProductDetail } from "@/components/stage/StageProductDetail";
import {
  allStageProducts,
  useStageEditor,
} from "@/components/stage/StageEditorContext";
import {
  favoriteKey,
  STAGE_BROWSE_CATEGORIES,
  stageProductById,
} from "@/lib/vibode-stage/catalog";
import { visibleStageCatalogProducts } from "@/lib/vibode-stage/catalog-query";
import { resolveStagePlacement } from "@/lib/vibode-stage/catalog";
import {
  STAGE_CATALOG_MODES,
  STAGE_CATALOG_WIDTH_PX,
} from "@/lib/vibode-stage/types";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageCatalogDrawer() {
  const stage = useStageEditor();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const products = allStageProducts(stage.extraProducts, stage.catalog);
  const visible = visibleStageCatalogProducts({
    products,
    mode: stage.catalogMode,
    query: stage.catalogQuery,
    categoryId: stage.catalogCategoryId,
    subcategoryId: stage.catalogSubcategoryId,
    collectionId: stage.collectionId,
    favoriteKeys: stage.favorites,
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
    recentlyUsedProductIds: stage.recentlyUsedProductIds,
  });
  const category = STAGE_BROWSE_CATEGORIES.find((item) => item.id === stage.catalogCategoryId);

  useLayoutEffect(() => {
    if (pendingScrollTopRef.current == null && scrollerRef.current) {
      scrollerRef.current.scrollTop = 0;
    }
  }, [stage.catalogMode]);

  useLayoutEffect(() => {
    const pending = pendingScrollTopRef.current;
    const scroller = scrollerRef.current;
    if (pending == null || !scroller) return;
    scroller.scrollTop = pending;
    pendingScrollTopRef.current = null;
  });

  const addProductPreservingScroll = useCallback((productId: string, variantId?: string | null) => {
    const scroller = scrollerRef.current;
    if (scroller) pendingScrollTopRef.current = scroller.scrollTop;
    stage.addProductToRoom(productId, variantId);
  }, [stage]);

  return (
    <aside
      className={`flex h-full shrink-0 flex-col overflow-hidden border-r border-neutral-800 bg-neutral-950/95 transition-[width] duration-200 ${
        stage.catalogOpen ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ width: stage.catalogOpen ? STAGE_CATALOG_WIDTH_PX : 0 }}
      data-stage-catalog={stage.catalogOpen ? "open" : "closed"}
      data-stage-catalog-pinned={stage.catalogPinned ? "true" : "false"}
      data-stage-catalog-authority={stage.catalogAuthority}
      data-stage-catalog-mode={stage.catalogMode}
      aria-hidden={!stage.catalogOpen}
    >
      <div className="flex min-h-0 w-[340px] flex-1 flex-col px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-neutral-100">Catalog</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={stage.catalogPinned}
              aria-label={stage.catalogPinned ? "Unpin catalog" : "Pin catalog"}
              onClick={stage.catalogPinned ? stage.collapseCatalog : stage.pinCatalog}
              className={`rounded-md border px-2 py-0.5 text-[10px] ${FOCUS} ${
                stage.catalogPinned
                  ? "border-neutral-500 text-neutral-100"
                  : "border-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {stage.catalogPinned ? "Pinned" : "Pin"}
            </button>
            <button
              type="button"
              aria-label="Collapse catalog"
              onClick={stage.collapseCatalog}
              className={`rounded-md border border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 hover:text-neutral-200 ${FOCUS}`}
            >
              Collapse
            </button>
          </div>
        </div>

        {stage.detailProductId ? (
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <StageProductDetail />
          </div>
        ) : (
          <>
            <input
              value={stage.catalogQuery}
              onChange={(event) => stage.setCatalogQuery(event.target.value)}
              placeholder="Search furniture..."
              className="mt-3 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
            />
            <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Catalog modes">
              {STAGE_CATALOG_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={stage.catalogMode === mode.id}
                  onClick={() => stage.setCatalogMode(mode.id)}
                  className={`rounded-md px-2 py-1 text-[11px] ${FOCUS} ${
                    stage.catalogMode === mode.id
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {stage.catalogMode === "browse" ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {STAGE_BROWSE_CATEGORIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => stage.setCatalogCategoryId(
                      stage.catalogCategoryId === item.id ? null : item.id,
                    )}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${FOCUS} ${
                      stage.catalogCategoryId === item.id
                        ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                        : "border-neutral-800 text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            {stage.catalogMode === "browse" && category && category.subcategories.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {category.subcategories.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => stage.setCatalogSubcategoryId(
                      stage.catalogSubcategoryId === item.id ? null : item.id,
                    )}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${FOCUS} ${
                      stage.catalogSubcategoryId === item.id
                        ? "bg-neutral-800 text-neutral-100"
                        : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            {stage.catalogMode === "collections" ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {stage.collections.map((collection) => (
                  <button
                    key={collection.collectionId}
                    type="button"
                    onClick={() => stage.setCollectionId(collection.collectionId)}
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${FOCUS} ${
                      stage.collectionId === collection.collectionId
                        ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                        : "border-neutral-800 text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {collection.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div
              ref={scrollerRef}
              className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [overflow-anchor:none]"
              data-stage-catalog-scroller="true"
            >
              {visible.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-500">
                  Nothing here yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {visible.map((product) => (
                    <CatalogCard
                      key={product.productId}
                      productId={product.productId}
                      onAdd={addProductPreservingScroll}
                    />
                  ))}
                </div>
              )}
            </div>

            <form
              className="mt-3 border-t border-neutral-800 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void stage.pasteProductLink();
              }}
            >
              <div className="text-[11px] text-neutral-500">Can’t find it here? Bring your own.</div>
              <div className="mt-2 flex gap-1.5">
                <input
                  value={stage.pasteUrl}
                  onChange={(event) => stage.setPasteUrl(event.target.value)}
                  placeholder="Paste product link"
                  className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
                />
                <button
                  type="submit"
                  disabled={stage.pasteBusy}
                  className={`rounded-md border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 ${FOCUS}`}
                >
                  {stage.pasteBusy ? "…" : "+"}
                </button>
              </div>
              {stage.pasteError ? (
                <div className="mt-1.5 text-[11px] text-amber-200">{stage.pasteError}</div>
              ) : null}
            </form>
          </>
        )}
      </div>
    </aside>
  );
}

function CatalogCard({
  productId,
  onAdd,
}: {
  productId: string;
  onAdd: (productId: string, variantId?: string | null) => void;
}) {
  const stage = useStageEditor();
  const product = stageProductById(productId, stage.extraProducts, stage.catalog);
  if (!product) return null;
  const canAdd = Boolean(resolveStagePlacement({
    productId: product.productId,
    variantId: product.defaultVariantId,
    extras: stage.extraProducts,
    extraVariants: stage.extraVariants,
    catalog: stage.catalog,
  }));
  return (
    <StageProductCard
      product={product}
      favorited={stage.favorites.has(favoriteKey(product.productId, product.defaultVariantId))}
      added={stage.addedProductId === product.productId}
      canAdd={canAdd}
      onOpen={() => stage.openProductDetail(product.productId)}
      onToggleFavorite={() => stage.toggleFavorite(product.productId, product.defaultVariantId)}
      onAdd={() => onAdd(product.productId, product.defaultVariantId)}
    />
  );
}
