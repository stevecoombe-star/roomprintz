"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  partnerDraftPreviewHasChanges,
  presentPartnerDraftPreview,
  type PartnerDraftPreviewView,
} from "@/lib/vibode-stage/partner-draft-preview-view";
import type { PartnerReadyAssetChoice } from "@/lib/vibode-stage/partner-portal-assets";
import type { StageCategory, StageCollection, StageProduct, StageVariant } from "@/lib/vibode-stage/types";

type DraftDocument = {
  products: {
    create?: ReadonlyArray<{
      productId: string;
      name: string;
      imageUrl: string;
      productUrl: string;
      priceAmount: number;
      priceCurrency: string;
      categoryId: string;
      subcategoryId: string | null;
      defaultVariantId: string;
    }>;
    update: ReadonlyArray<{
      productId: string;
      name?: string;
      imageUrl?: string;
      productUrl?: string | null;
      priceAmount?: number;
    }>;
  };
  variants: {
    create: ReadonlyArray<{
      variantId: string;
      productId: string;
      finishLabel: string | null;
      sku: string | null;
      priceAmount: number;
      priceCurrency: string;
      productUrl: string | null;
      currentAssetId: string;
    }>;
    update: ReadonlyArray<{
      variantId: string;
      finishLabel?: string | null;
      sku?: string | null;
      priceAmount?: number;
      productUrl?: string | null;
    }>;
  };
  collections: {
    create?: ReadonlyArray<{ collectionId: string; name: string }>;
    update: ReadonlyArray<{ collectionId: string; name?: string }>;
    membershipAdd: ReadonlyArray<{ productId: string; collectionId: string }>;
    membershipRemove: ReadonlyArray<{ productId: string; collectionId: string }>;
  };
};

type PartnerDraft = {
  draftId: string;
  partnerId: string;
  documentKind: "patch";
  status: "open" | "abandoned" | "published";
  revision: number;
  baseCatalogHash: string | null;
  document: DraftDocument;
  createdAt: string;
  updatedAt: string;
};

type DraftMutation =
  | { type: "product.set_name"; productId: string; name: string }
  | { type: "product.set_image_url"; productId: string; imageUrl: string }
  | { type: "product.set_product_url"; productId: string; productUrl: string | null }
  | { type: "product.set_price"; productId: string; priceAmount: number }
  | {
      type: "product.create";
      name: string;
      imageUrl: string;
      productUrl: string;
      priceAmount: number;
      categoryId: string;
      subcategoryId?: string | null;
      productCreationSlug?: string | null;
      defaultVariant: {
        finishLabel?: string | null;
        sku?: string | null;
        productUrl?: string | null;
        currentAssetId: string;
        creationSlug?: string | null;
      };
      collectionIds?: readonly string[];
    }
  | {
      type: "product.create_edit";
      productId: string;
      name?: string;
      imageUrl?: string;
      productUrl?: string;
      priceAmount?: number;
      categoryId?: string;
      subcategoryId?: string | null;
      collectionIds?: readonly string[];
    }
  | { type: "product.create_remove"; productId: string }
  | { type: "variant.set_finish_label"; variantId: string; finishLabel: string | null }
  | { type: "variant.set_sku"; variantId: string; sku: string | null }
  | { type: "variant.set_price"; variantId: string; priceAmount: number }
  | { type: "variant.set_product_url"; variantId: string; productUrl: string | null }
  | {
      type: "variant.create";
      productId: string;
      finishLabel: string | null;
      sku: string | null;
      priceAmount: number;
      productUrl: string | null;
      currentAssetId: string;
      creationSlug?: string | null;
    }
  | {
      type: "variant.create_edit";
      variantId: string;
      finishLabel?: string | null;
      sku?: string | null;
      priceAmount?: number;
      productUrl?: string | null;
      currentAssetId?: string;
    }
  | { type: "variant.create_remove"; variantId: string }
  | { type: "collection.set_name"; collectionId: string; name: string }
  | { type: "collection.set_membership"; collectionId: string; productIds: readonly string[] }
  | { type: "collection.create"; name: string; creationSlug?: string | null; productIds?: readonly string[] }
  | { type: "collection.create_edit"; collectionId: string; name?: string; productIds?: readonly string[] }
  | { type: "collection.create_remove"; collectionId: string };

function ChangeLines(props: Readonly<{ changes: readonly { label: string; previous: string; next: string }[] }>) {
  if (props.changes.length === 0) return <p className="text-xs text-slate-500">No field changes.</p>;
  return (
    <ul className="mt-1 space-y-1 text-sm text-slate-200">
      {props.changes.map((change) => (
        <li key={`${change.label}:${change.previous}:${change.next}`}>
          <span className="text-slate-400">{change.label}:</span>
          {" "}
          {change.previous}
          {" → "}
          {change.next}
        </li>
      ))}
    </ul>
  );
}

function DraftPreviewResult(props: Readonly<{
  preview: ReturnType<typeof presentPartnerDraftPreview>;
  raw: unknown;
}>) {
  if ("error" in props.preview) {
    return (
      <section id="draft-preview-result" className="rounded-xl border border-rose-800 bg-rose-950/30 p-4">
        <h3 className="font-medium text-rose-100">Preview failed</h3>
        <p className="mt-1 text-sm text-rose-200">{props.preview.error}</p>
      </section>
    );
  }
  const view: PartnerDraftPreviewView = props.preview;
  const hasChanges = partnerDraftPreviewHasChanges(view);
  return (
    <section id="draft-preview-result" className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <h3 className="font-medium">Preview result</h3>
      <p className="text-sm text-slate-200">
        {view.ok ? "Plan is valid" : "Plan has issues"}
        {" · "}
        {view.noOp ? "no catalog changes" : "changes planned"}
      </p>
      {view.issues.length > 0 ? (
        <div>
          <h4 className="text-xs uppercase tracking-wide text-slate-500">Issues</h4>
          <ul className="mt-1 space-y-1 text-sm text-amber-200">
            {view.issues.map((issue) => (
              <li key={`${issue.code}:${issue.message}`}>{issue.code}: {issue.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500">No planner issues.</p>
      )}
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Create Product</h4>
        {view.productCreates.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : view.productCreates.map((item) => {
          const defaultVariant = view.variantCreates.find((variant) => variant.variantId === item.defaultVariantId);
          return (
            <div key={item.productId} className="mt-2 rounded-md border border-sky-900/60 p-2">
              <p className="text-xs text-sky-200">Create Product</p>
              <p className="text-xs text-slate-400">{item.productId}</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-200">
                <li><span className="text-slate-400">Name:</span> {item.name}</li>
                <li><span className="text-slate-400">Price:</span> {item.price}</li>
                <li><span className="text-slate-400">Category:</span> {item.categoryId}{item.subcategoryId !== "—" ? ` / ${item.subcategoryId}` : ""}</li>
                <li><span className="text-slate-400">Image URL:</span> {item.imageUrl}</li>
                <li><span className="text-slate-400">Product URL:</span> {item.productUrl}</li>
              </ul>
              {defaultVariant ? (
                <div className="mt-2 rounded-md border border-emerald-900/60 p-2">
                  <p className="text-xs text-emerald-200">Create Default Variant</p>
                  <p className="text-xs text-slate-400">{defaultVariant.variantId}</p>
                  <ul className="mt-1 space-y-1 text-sm text-slate-200">
                    <li><span className="text-slate-400">Finish:</span> {defaultVariant.finishLabel}</li>
                    <li><span className="text-slate-400">SKU:</span> {defaultVariant.sku}</li>
                    <li><span className="text-slate-400">Price:</span> {defaultVariant.price}</li>
                    <li><span className="text-slate-400">Asset:</span> {defaultVariant.currentAssetId}</li>
                  </ul>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Product updates</h4>
        {view.productUpdates.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : view.productUpdates.map((item) => (
          <div key={item.productId} className="mt-2">
            <p className="text-xs text-slate-400">{item.productId}</p>
            <ChangeLines changes={item.changes} />
          </div>
        ))}
      </div>
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Create Variant</h4>
        {view.variantCreates.filter((item) => (
          !view.productCreates.some((product) => product.defaultVariantId === item.variantId)
        )).length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : view.variantCreates.filter((item) => (
          !view.productCreates.some((product) => product.defaultVariantId === item.variantId)
        )).map((item) => (
          <div key={item.variantId} className="mt-2 rounded-md border border-emerald-900/60 p-2">
            <p className="text-xs text-emerald-200">Create Variant</p>
            <p className="text-xs text-slate-400">{item.variantId}</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-200">
              <li><span className="text-slate-400">Product:</span> {item.productId}</li>
              <li><span className="text-slate-400">Finish:</span> {item.finishLabel}</li>
              <li><span className="text-slate-400">SKU:</span> {item.sku}</li>
              <li><span className="text-slate-400">Price:</span> {item.price}</li>
              <li><span className="text-slate-400">Asset:</span> {item.currentAssetId}</li>
            </ul>
          </div>
        ))}
      </div>
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Update Variant</h4>
        {view.variantUpdates.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : view.variantUpdates.map((item) => (
          <div key={item.variantId} className="mt-2">
            <p className="text-xs text-slate-400">{item.variantId}</p>
            <ChangeLines changes={item.changes} />
          </div>
        ))}
      </div>
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Create Collection</h4>
        {view.collectionCreates.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : view.collectionCreates.map((item) => {
          const members = [
            ...item.productIds,
            ...view.membershipAdds
              .filter((membership) => membership.collectionId === item.collectionId)
              .map((membership) => membership.productId),
          ].filter((id, index, all) => all.indexOf(id) === index);
          return (
            <div key={item.collectionId} className="mt-2 rounded-md border border-violet-900/60 p-2">
              <p className="text-xs text-violet-200">Create Collection</p>
              <p className="text-xs text-slate-400">{item.collectionId}</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-200">
                <li><span className="text-slate-400">Name:</span> {item.name}</li>
                <li>
                  <span className="text-slate-400">Products:</span>{" "}
                  {members.length === 0
                    ? "Collection will be created with no Products."
                    : members.join(", ")}
                </li>
              </ul>
            </div>
          );
        })}
      </div>
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Collection updates</h4>
        {view.collectionUpdates.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-slate-200">
            {view.collectionUpdates.map((item) => (
              <li key={item.collectionId}>
                {item.collectionId}: {item.previous} → {item.next}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Membership</h4>
        {(() => {
          const created = new Set(view.collectionCreates.map((item) => item.collectionId));
          const adds = view.membershipAdds.filter((item) => !created.has(item.collectionId));
          const removes = view.membershipRemoves.filter((item) => !created.has(item.collectionId));
          if (adds.length === 0 && removes.length === 0) {
            return <p className="mt-1 text-xs text-slate-500">None</p>;
          }
          return (
            <ul className="mt-1 space-y-1 text-sm text-slate-200">
              {adds.map((item) => (
                <li key={`add:${item.collectionId}:${item.productId}`}>
                  Add {item.productId} → {item.collectionId}
                </li>
              ))}
              {removes.map((item) => (
                <li key={`remove:${item.collectionId}:${item.productId}`}>
                  Remove {item.productId} → {item.collectionId}
                </li>
              ))}
            </ul>
          );
        })()}
      </div>
      {(view.productDeactivations.length + view.productReactivations.length
        + view.variantDeactivations.length + view.variantReactivations.length) > 0 ? (
        <div>
          <h4 className="text-xs uppercase tracking-wide text-slate-500">Availability</h4>
          <ul className="mt-1 space-y-1 text-sm text-slate-200">
            {view.productDeactivations.map((id) => <li key={`pd:${id}`}>Deactivate product {id}</li>)}
            {view.productReactivations.map((id) => <li key={`pr:${id}`}>Reactivate product {id}</li>)}
            {view.variantDeactivations.map((id) => <li key={`vd:${id}`}>Deactivate variant {id}</li>)}
            {view.variantReactivations.map((id) => <li key={`vr:${id}`}>Reactivate variant {id}</li>)}
          </ul>
        </div>
      ) : null}
      {!hasChanges && view.noOp ? (
        <p className="text-sm text-slate-300">This draft plans no commercial changes.</p>
      ) : null}
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer text-slate-400">Raw preview JSON</summary>
        <pre className="mt-2 overflow-auto rounded-md bg-slate-950 p-3 text-[11px] text-slate-300">
          {JSON.stringify(props.raw, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function productPatch(document: DraftDocument, productId: string) {
  return document.products.update.find((item) => item.productId === productId) ?? null;
}

function variantPatch(document: DraftDocument, variantId: string) {
  return document.variants.update.find((item) => item.variantId === variantId) ?? null;
}

function collectionPatch(document: DraftDocument, collectionId: string) {
  return document.collections.update.find((item) => item.collectionId === collectionId) ?? null;
}

function effective<T>(live: T, override: T | undefined): T {
  return override !== undefined ? override : live;
}

function desiredMembership(
  document: DraftDocument,
  collectionId: string,
  liveIds: readonly string[],
): string[] {
  const removed = new Set(
    document.collections.membershipRemove
      .filter((item) => item.collectionId === collectionId)
      .map((item) => item.productId),
  );
  const added = document.collections.membershipAdd
    .filter((item) => item.collectionId === collectionId)
    .map((item) => item.productId);
  return [...new Set([...liveIds.filter((id) => !removed.has(id)), ...added])];
}

function pendingCreates(document: DraftDocument, productId: string) {
  return (document.variants.create ?? []).filter((item) => item.productId === productId);
}

function pendingProducts(document: DraftDocument) {
  return document.products.create ?? [];
}

function pendingProductCollectionIds(document: DraftDocument, productId: string): string[] {
  return document.collections.membershipAdd
    .filter((item) => item.productId === productId)
    .map((item) => item.collectionId)
    .sort((left, right) => left.localeCompare(right));
}

function categoryLabel(categories: readonly StageCategory[], categoryId: string, subcategoryId: string | null): string {
  const category = categories.find((item) => item.id === categoryId);
  const subcategory = subcategoryId
    ? category?.subcategories.find((item) => item.id === subcategoryId)
    : null;
  if (!category) return categoryId;
  return subcategory ? `${category.label} / ${subcategory.label}` : category.label;
}

function assetLabel(assets: readonly PartnerReadyAssetChoice[], assetId: string): string {
  return assets.find((item) => item.assetId === assetId)?.label ?? assetId;
}

function pendingCollections(document: DraftDocument) {
  return document.collections.create ?? [];
}

function pendingCollectionProductIds(document: DraftDocument, collectionId: string): string[] {
  return document.collections.membershipAdd
    .filter((item) => item.collectionId === collectionId)
    .map((item) => item.productId)
    .sort((left, right) => left.localeCompare(right));
}

function pendingCount(document: DraftDocument): number {
  const productFields = document.products.update.reduce((count, item) => (
    count + Object.keys(item).filter((key) => key !== "productId").length
  ), 0);
  const variantFields = document.variants.update.reduce((count, item) => (
    count + Object.keys(item).filter((key) => key !== "variantId").length
  ), 0);
  return (
    productFields
    + variantFields
    + (document.products.create ?? []).length
    + (document.variants.create ?? []).length
    + (document.collections.create ?? []).length
    + document.collections.update.length
    + document.collections.membershipAdd.length
    + document.collections.membershipRemove.length
  );
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function PartnerDraftWorkspaceClient(props: Readonly<{
  partnerName: string;
  partnerId: string;
  draft: PartnerDraft;
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  collections: readonly StageCollection[];
  readyAssets: readonly PartnerReadyAssetChoice[];
  categories: readonly StageCategory[];
  catalogCurrency: string | null;
  focusProductId: string | null;
}>) {
  const router = useRouter();
  const [draft, setDraft] = useState(props.draft);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof presentPartnerDraftPreview> | null>(null);
  const [previewRaw, setPreviewRaw] = useState<unknown>(null);
  const [conflicts, setConflicts] = useState<ReadonlyArray<{
    entity: string;
    id: string;
    field: string;
    expected: unknown;
    live: unknown;
  }> | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [productUrls, setProductUrls] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [finishes, setFinishes] = useState<Record<string, string>>({});
  const [skus, setSkus] = useState<Record<string, string>>({});
  const [variantPrices, setVariantPrices] = useState<Record<string, string>>({});
  const [variantUrls, setVariantUrls] = useState<Record<string, string>>({});
  const [collectionNames, setCollectionNames] = useState<Record<string, string>>({});
  const [membership, setMembership] = useState<Record<string, string[]>>({});
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [newFinish, setNewFinish] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAssetId, setNewAssetId] = useState(props.readyAssets[0]?.assetId ?? "");
  const [newSlug, setNewSlug] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductSlug, setNewProductSlug] = useState("");
  const [newProductImage, setNewProductImage] = useState("");
  const [newProductUrl, setNewProductUrl] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newProductCategory, setNewProductCategory] = useState(props.categories[0]?.id ?? "");
  const [newProductSubcategory, setNewProductSubcategory] = useState("");
  const [newProductFinish, setNewProductFinish] = useState("");
  const [newProductSku, setNewProductSku] = useState("");
  const [newProductVariantUrl, setNewProductVariantUrl] = useState("");
  const [newProductAssetId, setNewProductAssetId] = useState(props.readyAssets[0]?.assetId ?? "");
  const [newProductVariantSlug, setNewProductVariantSlug] = useState("");
  const [newProductCollections, setNewProductCollections] = useState<string[]>([]);
  const [addingCollection, setAddingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newCollectionSlug, setNewCollectionSlug] = useState("");
  const [newCollectionProductIds, setNewCollectionProductIds] = useState<string[]>([]);

  const variantsByProduct = useMemo(() => {
    const map = new Map<string, StageVariant[]>();
    for (const variant of props.variants) {
      const current = map.get(variant.productId) ?? [];
      map.set(variant.productId, [...current, variant]);
    }
    return map;
  }, [props.variants]);

  function syncForms(next: PartnerDraft) {
    const nextNames: Record<string, string> = {};
    const nextImages: Record<string, string> = {};
    const nextUrls: Record<string, string> = {};
    const nextPrices: Record<string, string> = {};
    for (const product of props.products) {
      const patch = productPatch(next.document, product.productId);
      nextNames[product.productId] = effective(product.name, patch?.name);
      nextImages[product.productId] = effective(product.imageUrl, patch?.imageUrl);
      nextUrls[product.productId] = effective(product.productUrl, patch?.productUrl) ?? "";
      nextPrices[product.productId] = String(effective(product.priceAmount, patch?.priceAmount) ?? "");
    }
    for (const create of next.document.products.create ?? []) {
      nextNames[create.productId] = create.name;
      nextImages[create.productId] = create.imageUrl;
      nextUrls[create.productId] = create.productUrl;
      nextPrices[create.productId] = String(create.priceAmount ?? "");
    }
    const nextFinishes: Record<string, string> = {};
    const nextSkus: Record<string, string> = {};
    const nextVariantPrices: Record<string, string> = {};
    const nextVariantUrls: Record<string, string> = {};
    for (const variant of props.variants) {
      const patch = variantPatch(next.document, variant.variantId);
      nextFinishes[variant.variantId] = effective(variant.finishLabel, patch?.finishLabel) ?? "";
      nextSkus[variant.variantId] = effective(variant.sku, patch?.sku) ?? "";
      nextVariantPrices[variant.variantId] = String(effective(variant.priceAmount, patch?.priceAmount) ?? "");
      nextVariantUrls[variant.variantId] = effective(variant.productUrl, patch?.productUrl) ?? "";
    }
    for (const create of next.document.variants.create ?? []) {
      nextFinishes[create.variantId] = create.finishLabel ?? "";
      nextSkus[create.variantId] = create.sku ?? "";
      nextVariantPrices[create.variantId] = String(create.priceAmount ?? "");
      nextVariantUrls[create.variantId] = create.productUrl ?? "";
    }
    const nextCollectionNames: Record<string, string> = {};
    const nextMembership: Record<string, string[]> = {};
    for (const collection of props.collections) {
      const patch = collectionPatch(next.document, collection.collectionId);
      nextCollectionNames[collection.collectionId] = effective(collection.name, patch?.name);
      nextMembership[collection.collectionId] = desiredMembership(
        next.document,
        collection.collectionId,
        collection.productIds,
      );
    }
    for (const create of next.document.collections.create ?? []) {
      nextCollectionNames[create.collectionId] = create.name;
      nextMembership[create.collectionId] = pendingCollectionProductIds(next.document, create.collectionId);
    }
    setNames(nextNames);
    setImageUrls(nextImages);
    setProductUrls(nextUrls);
    setPrices(nextPrices);
    setFinishes(nextFinishes);
    setSkus(nextSkus);
    setVariantPrices(nextVariantPrices);
    setVariantUrls(nextVariantUrls);
    setCollectionNames(nextCollectionNames);
    setMembership(nextMembership);
  }

  useEffect(() => {
    syncForms(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!props.focusProductId) return;
    document.getElementById(`product-${props.focusProductId}`)?.scrollIntoView({ behavior: "smooth" });
  }, [props.focusProductId]);

  async function save(mutations: DraftMutation[]): Promise<boolean> {
    if (conflict) return false;
    setPending(true);
    setError(null);
    setConflicts(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${draft.draftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.revision, mutations }),
      });
      const body = await response.json() as { error?: string; draft?: PartnerDraft };
      if (response.status === 409) {
        setConflict(true);
        setError(body.error ?? "Draft revision is stale. Reload before saving.");
        return false;
      }
      if (!response.ok || !body.draft) {
        setError(body.error ?? "Draft could not be saved.");
        return false;
      }
      setDraft(body.draft);
      syncForms(body.draft);
      return true;
    } catch {
      setError("Draft could not be saved.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    setPending(true);
    setError(null);
    setConflicts(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${draft.draftId}`);
      const body = await response.json() as { error?: string; draft?: PartnerDraft };
      if (!response.ok || !body.draft) {
        setError(body.error ?? "Draft could not be reloaded.");
        return;
      }
      setDraft(body.draft);
      syncForms(body.draft);
      setConflict(false);
    } catch {
      setError("Draft could not be reloaded.");
    } finally {
      setPending(false);
    }
  }

  async function abandon() {
    if (!window.confirm("Abandon this draft? It will stay on file but can no longer be edited.")) return;
    setPending(true);
    setError(null);
    setConflicts(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${draft.draftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.revision, status: "abandoned" }),
      });
      const body = await response.json() as { error?: string };
      if (response.status === 409) {
        setConflict(true);
        setError(body.error ?? "Draft revision is stale. Reload before saving.");
        return;
      }
      if (!response.ok) {
        setError(body.error ?? "Draft could not be abandoned.");
        return;
      }
      router.push("/partner/catalog");
    } catch {
      setError("Draft could not be abandoned.");
    } finally {
      setPending(false);
    }
  }

  async function runPreview() {
    setPending(true);
    setError(null);
    setConflicts(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${draft.draftId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.revision }),
      });
      const body: unknown = await response.json();
      const presented = presentPartnerDraftPreview(body);
      setPreview(presented);
      setPreviewRaw(body);
      requestAnimationFrame(() => {
        document.getElementById("draft-preview-result")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch {
      setPreview({ error: "Preview request failed." });
      setPreviewRaw(null);
    } finally {
      setPending(false);
    }
  }

  async function publishDraft() {
    if (conflict) return;
    const confirmed = window.confirm(
      "Publishing updates the live catalog. Changes become immediately visible in Vibode shopping and runtime. The server will re-check the current catalog before applying.",
    );
    if (!confirmed) return;
    setPending(true);
    setError(null);
    setConflicts(null);
    try {
      const response = await fetch(`/api/vibode/partner/drafts/${draft.draftId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedDraftRevision: draft.revision }),
      });
      const body = await response.json() as {
        ok?: boolean;
        error?: string;
        code?: string;
        conflicts?: ReadonlyArray<{
          entity: string;
          id: string;
          field: string;
          expected: unknown;
          live: unknown;
        }>;
        issues?: unknown;
        noOp?: boolean;
      };
      if (response.status === 409 && body.code === "STALE_DRAFT_REVISION") {
        setConflict(true);
        setError(body.error ?? "Draft revision is stale. Reload before publishing.");
        return;
      }
      if (response.status === 409 && (body.code === "STALE_LIVE_FIELD" || body.code === "STALE_CATALOG_BASE")) {
        setConflicts(body.conflicts ?? []);
        setError(body.error ?? "Live catalog changed since this draft edit. Reload and review before publishing.");
        return;
      }
      if (response.status === 409) {
        if (body.code === "DRAFT_PUBLISHED") {
          setError(body.error ?? "This draft is published and can no longer be changed.");
          return;
        }
        setConflict(true);
        setError(body.error ?? "Draft revision is stale. Reload before publishing.");
        return;
      }
      if (response.status === 400 && (body.code === "PLANNER_ISSUE" || body.code === "INVALID_DOCUMENT")) {
        const presented = presentPartnerDraftPreview({ ...body, error: undefined });
        setPreview(presented);
        setPreviewRaw(body);
        setError(body.error ?? "This draft cannot be published until catalog issues are resolved.");
        return;
      }
      if (!response.ok || body.ok !== true) {
        setError(body.error ?? "Draft could not be published.");
        return;
      }
      router.push("/partner/catalog");
    } catch {
      setError("Draft could not be published.");
    } finally {
      setPending(false);
    }
  }

  const pendingChanges = pendingCount(draft.document);

  return (
    <main className="space-y-8">
      <section className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">Catalog draft</p>
        <h2 className="text-lg font-semibold">{props.partnerName}</h2>
        <p className="text-xs text-slate-400">
          {props.partnerId}
          {" · "}
          status {draft.status}
          {" · "}
          revision {draft.revision}
          {" · "}
          {pendingChanges === 0 ? "no pending changes" : `${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"}`}
        </p>
        <p className="text-xs text-slate-500">
          Saves persist the canonical PI-5F patch only. Live catalog rows are not written.
          Inactive Collections are not shown here because the durable assembler omits them.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs"
            onClick={() => void runPreview()}
          >
            {pending ? "Planning…" : "Preview"}
          </button>
          <button
            type="button"
            disabled={pending || conflict}
            className="rounded-md border border-emerald-700 px-3 py-1 text-xs text-emerald-100"
            onClick={() => void publishDraft()}
          >
            Publish
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs"
            onClick={() => void abandon()}
          >
            Abandon draft
          </button>
          <a className="rounded-md border border-slate-700 px-3 py-1 text-xs" href="/partner/catalog">
            Live catalog
          </a>
        </div>
        {conflict ? (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
            This draft was changed in another session. Reload before saving again.
            <button
              type="button"
              className="ml-3 rounded-md border border-amber-600 px-2 py-0.5 text-xs"
              onClick={() => void reload()}
            >
              Reload draft
            </button>
          </div>
        ) : null}
        {error ? <p className="text-xs text-rose-300">{error}</p> : null}
        {conflicts && conflicts.length > 0 ? (
          <div className="rounded-md border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
            <p>Live catalog changed since this draft edit. Reload and review before publishing.</p>
            <ul className="mt-2 space-y-1 text-xs">
              {conflicts.map((item) => (
                <li key={`${item.entity}:${item.id}:${item.field}`}>
                  {item.entity} {item.id} · {item.field}: {String(item.expected ?? "—")} → live {String(item.live ?? "—")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {pending && !preview ? (
          <p id="draft-preview-result" className="text-sm text-slate-300">Planning…</p>
        ) : preview ? (
          <DraftPreviewResult preview={preview} raw={previewRaw} />
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-800 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">Add Product</h3>
          {!addingProduct ? (
            <button
              type="button"
              disabled={pending || conflict || props.readyAssets.length === 0 || !props.catalogCurrency}
              className="rounded-md border border-slate-700 px-3 py-1 text-xs"
              onClick={() => setAddingProduct(true)}
            >
              Add Product
            </button>
          ) : null}
        </div>
        {props.readyAssets.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            Product creation requires an already-certified Partner Asset. G5 will later unlock new geometry.
          </p>
        ) : null}
        {!props.catalogCurrency ? (
          <p className="text-[11px] text-slate-500">
            Product creation is disabled until this Partner catalog has a resolvable currency.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500">
            Inherited currency {props.catalogCurrency}. Image URL must be HTTPS or an allowed same-origin public path. Product URL must be absolute HTTPS.
          </p>
        )}
        {addingProduct ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400 sm:col-span-2">
              Product name
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductName}
                disabled={pending || conflict}
                onChange={(event) => setNewProductName(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Product identity slug
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductSlug}
                disabled={pending || conflict}
                onChange={(event) => setNewProductSlug(event.target.value)}
                placeholder="Optional if the name slugs cleanly"
              />
            </label>
            <label className="text-xs text-slate-400">
              Price ({props.catalogCurrency ?? "—"})
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductPrice}
                disabled={pending || conflict}
                onChange={(event) => setNewProductPrice(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              Image URL
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductImage}
                disabled={pending || conflict}
                onChange={(event) => setNewProductImage(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              Product URL
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductUrl}
                disabled={pending || conflict}
                onChange={(event) => setNewProductUrl(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Category
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductCategory}
                disabled={pending || conflict}
                onChange={(event) => {
                  setNewProductCategory(event.target.value);
                  setNewProductSubcategory("");
                }}
              >
                {props.categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Subcategory
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductSubcategory}
                disabled={pending || conflict || (props.categories.find((item) => item.id === newProductCategory)?.subcategories.length ?? 0) === 0}
                onChange={(event) => setNewProductSubcategory(event.target.value)}
              >
                <option value="">None</option>
                {(props.categories.find((item) => item.id === newProductCategory)?.subcategories ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Default variant finish
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductFinish}
                disabled={pending || conflict}
                onChange={(event) => setNewProductFinish(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Variant identity slug
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductVariantSlug}
                disabled={pending || conflict}
                onChange={(event) => setNewProductVariantSlug(event.target.value)}
                placeholder="Required if finish is blank"
              />
            </label>
            <label className="text-xs text-slate-400">
              Default variant SKU
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductSku}
                disabled={pending || conflict}
                onChange={(event) => setNewProductSku(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Variant product URL
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductVariantUrl}
                disabled={pending || conflict}
                onChange={(event) => setNewProductVariantUrl(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              Default variant asset
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newProductAssetId}
                disabled={pending || conflict || props.readyAssets.length === 0}
                onChange={(event) => setNewProductAssetId(event.target.value)}
              >
                {props.readyAssets.map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>{asset.label}</option>
                ))}
              </select>
            </label>
            {(props.collections.length > 0 || pendingCollections(draft.document).length > 0) ? (
              <fieldset className="sm:col-span-2 space-y-1">
                <legend className="text-xs text-slate-400">Existing collections</legend>
                {props.collections.map((collection) => (
                  <label key={collection.collectionId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={newProductCollections.includes(collection.collectionId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        setNewProductCollections((current) => (
                          event.target.checked
                            ? [...current, collection.collectionId]
                            : current.filter((id) => id !== collection.collectionId)
                        ));
                      }}
                    />
                    {collection.name}
                  </label>
                ))}
                {pendingCollections(draft.document).map((collection) => (
                  <label key={collection.collectionId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={newProductCollections.includes(collection.collectionId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        setNewProductCollections((current) => (
                          event.target.checked
                            ? [...current, collection.collectionId]
                            : current.filter((id) => id !== collection.collectionId)
                        ));
                      }}
                    />
                    {collection.name}
                    <span className="text-sky-300">pending publish</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="button"
                disabled={pending || conflict || props.readyAssets.length === 0 || !props.catalogCurrency}
                className="rounded-md border border-emerald-700 px-3 py-1 text-xs text-emerald-100"
                onClick={() => {
                  const priceAmount = Number(newProductPrice);
                  const productCreationSlug = blankToNull(newProductSlug);
                  const finishLabel = blankToNull(newProductFinish);
                  const creationSlug = blankToNull(newProductVariantSlug);
                  if (!newProductName.trim() || !newProductImage.trim() || !newProductUrl.trim() || !Number.isFinite(priceAmount) || priceAmount < 0) return;
                  if (!finishLabel && !creationSlug) return;
                  if (!newProductAssetId) return;
                  void save([{
                    type: "product.create",
                    name: newProductName.trim(),
                    imageUrl: newProductImage.trim(),
                    productUrl: newProductUrl.trim(),
                    priceAmount,
                    categoryId: newProductCategory,
                    ...(newProductSubcategory ? { subcategoryId: newProductSubcategory } : { subcategoryId: null }),
                    ...(productCreationSlug ? { productCreationSlug } : {}),
                    defaultVariant: {
                      finishLabel,
                      sku: blankToNull(newProductSku),
                      productUrl: blankToNull(newProductVariantUrl),
                      currentAssetId: newProductAssetId,
                      ...(creationSlug ? { creationSlug } : {}),
                    },
                    ...(newProductCollections.length > 0 ? { collectionIds: newProductCollections } : {}),
                  }]).then((ok) => {
                    if (!ok) return;
                    setAddingProduct(false);
                    setNewProductName("");
                    setNewProductSlug("");
                    setNewProductImage("");
                    setNewProductUrl("");
                    setNewProductPrice("");
                    setNewProductFinish("");
                    setNewProductSku("");
                    setNewProductVariantUrl("");
                    setNewProductVariantSlug("");
                    setNewProductCollections([]);
                  });
                }}
              >
                Save product
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                onClick={() => setAddingProduct(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {pendingProducts(draft.document).map((create) => {
        const defaultVariant = (draft.document.variants.create ?? []).find((item) => item.variantId === create.defaultVariantId);
        const selectedCollections = pendingProductCollectionIds(draft.document, create.productId);
        const imageSrc = safeHttpUrl(imageUrls[create.productId] ?? create.imageUrl);
        return (
          <article key={create.productId} className="space-y-4 rounded-xl border border-sky-900/70 bg-sky-950/10 p-4">
            <div className="flex gap-4">
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageSrc} alt="" className="h-16 w-16 rounded-md object-cover bg-slate-900" />
              ) : (
                <div className="h-16 w-16 rounded-md bg-slate-900" />
              )}
              <div>
                <p className="text-xs text-sky-200">New Product — pending publish</p>
                <h3 className="font-medium">{names[create.productId] ?? create.name}</h3>
                <p className="text-xs text-slate-500">{create.productId}</p>
                <p className="text-[11px] text-slate-500">
                  {categoryLabel(props.categories, create.categoryId, create.subcategoryId)}
                  {" · "}
                  default {create.defaultVariantId}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={names[create.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setNames((current) => ({ ...current, [create.productId]: event.target.value }))}
                  onBlur={() => {
                    const next = (names[create.productId] ?? "").trim();
                    if (!next || next === create.name) return;
                    void save([{ type: "product.create_edit", productId: create.productId, name: next }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400">
                Price ({create.priceCurrency})
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={prices[create.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setPrices((current) => ({ ...current, [create.productId]: event.target.value }))}
                  onBlur={() => {
                    const parsed = Number(prices[create.productId]);
                    if (!Number.isFinite(parsed) || parsed < 0 || parsed === create.priceAmount) return;
                    void save([{ type: "product.create_edit", productId: create.productId, priceAmount: parsed }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400 sm:col-span-2">
                Image URL
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={imageUrls[create.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setImageUrls((current) => ({ ...current, [create.productId]: event.target.value }))}
                  onBlur={() => {
                    const next = (imageUrls[create.productId] ?? "").trim();
                    if (!next || next === create.imageUrl) return;
                    void save([{ type: "product.create_edit", productId: create.productId, imageUrl: next }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400 sm:col-span-2">
                Product URL
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={productUrls[create.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setProductUrls((current) => ({ ...current, [create.productId]: event.target.value }))}
                  onBlur={() => {
                    const next = (productUrls[create.productId] ?? "").trim();
                    if (!next || next === create.productUrl) return;
                    void save([{ type: "product.create_edit", productId: create.productId, productUrl: next }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400">
                Category
                <select
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={create.categoryId}
                  disabled={pending || conflict}
                  onChange={(event) => {
                    const categoryId = event.target.value;
                    const allowed = props.categories.find((item) => item.id === categoryId)?.subcategories.some((item) => item.id === create.subcategoryId);
                    void save([{
                      type: "product.create_edit",
                      productId: create.productId,
                      categoryId,
                      subcategoryId: allowed ? create.subcategoryId : null,
                    }]);
                  }}
                >
                  {props.categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Subcategory
                <select
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={create.subcategoryId ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => {
                    void save([{
                      type: "product.create_edit",
                      productId: create.productId,
                      subcategoryId: event.target.value || null,
                    }]);
                  }}
                >
                  <option value="">None</option>
                  {(props.categories.find((item) => item.id === create.categoryId)?.subcategories ?? []).map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
            {defaultVariant ? (
              <div className="rounded-md border border-emerald-900/70 bg-emerald-950/20 p-3">
                <p className="text-xs text-emerald-200">Default Variant — pending publish</p>
                <p className="text-[11px] text-slate-500">{defaultVariant.variantId}</p>
                <p className="text-[11px] text-slate-500">
                  Inherited currency {defaultVariant.priceCurrency}
                  {" · "}
                  Asset {assetLabel(props.readyAssets, defaultVariant.currentAssetId)}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-400">
                    Finish
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={finishes[defaultVariant.variantId] ?? ""}
                      disabled={pending || conflict}
                      onChange={(event) => setFinishes((current) => ({ ...current, [defaultVariant.variantId]: event.target.value }))}
                      onBlur={() => {
                        const next = blankToNull(finishes[defaultVariant.variantId] ?? "");
                        if (next === defaultVariant.finishLabel) return;
                        void save([{ type: "variant.create_edit", variantId: defaultVariant.variantId, finishLabel: next }]);
                      }}
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    SKU
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={skus[defaultVariant.variantId] ?? ""}
                      disabled={pending || conflict}
                      onChange={(event) => setSkus((current) => ({ ...current, [defaultVariant.variantId]: event.target.value }))}
                      onBlur={() => {
                        const next = blankToNull(skus[defaultVariant.variantId] ?? "");
                        if (next === defaultVariant.sku) return;
                        void save([{ type: "variant.create_edit", variantId: defaultVariant.variantId, sku: next }]);
                      }}
                    />
                  </label>
                  <label className="text-xs text-slate-400 sm:col-span-2">
                    Product URL
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={variantUrls[defaultVariant.variantId] ?? ""}
                      disabled={pending || conflict}
                      onChange={(event) => setVariantUrls((current) => ({ ...current, [defaultVariant.variantId]: event.target.value }))}
                      onBlur={() => {
                        const next = blankToNull(variantUrls[defaultVariant.variantId] ?? "");
                        if (next === defaultVariant.productUrl) return;
                        void save([{ type: "variant.create_edit", variantId: defaultVariant.variantId, productUrl: next }]);
                      }}
                    />
                  </label>
                  <label className="text-xs text-slate-400 sm:col-span-2">
                    Asset
                    <select
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={defaultVariant.currentAssetId}
                      disabled={pending || conflict || props.readyAssets.length === 0}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (!next || next === defaultVariant.currentAssetId) return;
                        void save([{ type: "variant.create_edit", variantId: defaultVariant.variantId, currentAssetId: next }]);
                      }}
                    >
                      {props.readyAssets.map((asset) => (
                        <option key={asset.assetId} value={asset.assetId}>{asset.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}
            {(props.collections.length > 0 || pendingCollections(draft.document).length > 0) ? (
              <fieldset className="space-y-1">
                <legend className="text-xs text-slate-400">Existing collections</legend>
                {props.collections.map((collection) => (
                  <label key={collection.collectionId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={selectedCollections.includes(collection.collectionId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...selectedCollections, collection.collectionId]
                          : selectedCollections.filter((id) => id !== collection.collectionId);
                        void save([{
                          type: "product.create_edit",
                          productId: create.productId,
                          collectionIds: next,
                        }]);
                      }}
                    />
                    {collection.name}
                  </label>
                ))}
                {pendingCollections(draft.document).map((collection) => (
                  <label key={collection.collectionId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={selectedCollections.includes(collection.collectionId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...selectedCollections, collection.collectionId]
                          : selectedCollections.filter((id) => id !== collection.collectionId);
                        void save([{
                          type: "product.create_edit",
                          productId: create.productId,
                          collectionIds: next,
                        }]);
                      }}
                    />
                    {collection.name}
                    <span className="text-sky-300">pending publish</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <button
              type="button"
              disabled={pending || conflict}
              className="rounded-md border border-slate-700 px-3 py-1 text-xs"
              onClick={() => void save([{ type: "product.create_remove", productId: create.productId }])}
            >
              Remove pending product
            </button>
          </article>
        );
      })}

      {props.products.map((product) => {
        const patch = productPatch(draft.document, product.productId);
        const imageSrc = safeHttpUrl(imageUrls[product.productId] ?? product.imageUrl);
        return (
          <article
            key={product.productId}
            id={`product-${product.productId}`}
            className="space-y-4 rounded-xl border border-slate-800 p-4"
          >
            <div className="flex gap-4">
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageSrc} alt="" className="h-16 w-16 rounded-md object-cover bg-slate-900" />
              ) : (
                <div className="h-16 w-16 rounded-md bg-slate-900" />
              )}
              <div>
                <h3 className="font-medium">{names[product.productId] ?? product.name}</h3>
                <p className="text-xs text-slate-500">{product.productId}</p>
                <p className="text-[11px] text-slate-500">
                  status {product.status ?? "active"}
                  {" · "}
                  {product.categoryId}
                  {product.subcategoryId ? ` / ${product.subcategoryId}` : ""}
                  {" · "}
                  default {product.defaultVariantId}
                </p>
                <p className="text-[11px] text-slate-500">
                  {product.brand} · {product.retailer}
                  {product.partnerId ? ` · ${product.partnerId}` : ""}
                  {product.source ? ` · ${product.source}` : ""}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">
                Name {patch?.name !== undefined ? <span className="text-amber-300">pending</span> : null}
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={names[product.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setNames((current) => ({ ...current, [product.productId]: event.target.value }))}
                  onBlur={() => {
                    const next = (names[product.productId] ?? "").trim();
                    if (!next) return;
                    if (next === effective(product.name, patch?.name)) return;
                    void save([{ type: "product.set_name", productId: product.productId, name: next }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400">
                Image URL {patch?.imageUrl !== undefined ? <span className="text-amber-300">pending</span> : null}
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={imageUrls[product.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setImageUrls((current) => ({ ...current, [product.productId]: event.target.value }))}
                  onBlur={() => {
                    const next = (imageUrls[product.productId] ?? "").trim();
                    if (!next) return;
                    if (next === effective(product.imageUrl, patch?.imageUrl)) return;
                    void save([{ type: "product.set_image_url", productId: product.productId, imageUrl: next }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400">
                Product URL {patch?.productUrl !== undefined ? <span className="text-amber-300">pending</span> : null}
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={productUrls[product.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setProductUrls((current) => ({ ...current, [product.productId]: event.target.value }))}
                  onBlur={() => {
                    const next = blankToNull(productUrls[product.productId] ?? "");
                    if (next === effective(product.productUrl, patch?.productUrl)) return;
                    void save([{ type: "product.set_product_url", productId: product.productId, productUrl: next }]);
                  }}
                />
              </label>
              <label className="text-xs text-slate-400">
                Price ({product.priceCurrency}) {patch?.priceAmount !== undefined ? <span className="text-amber-300">pending</span> : null}
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={prices[product.productId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setPrices((current) => ({ ...current, [product.productId]: event.target.value }))}
                  onBlur={() => {
                    const parsed = Number(prices[product.productId]);
                    if (!Number.isFinite(parsed)) return;
                    if (parsed === effective(product.priceAmount, patch?.priceAmount)) return;
                    void save([{ type: "product.set_price", productId: product.productId, priceAmount: parsed }]);
                  }}
                />
              </label>
            </div>

            <ul className="space-y-3 border-t border-slate-800 pt-3">
              {(variantsByProduct.get(product.productId) ?? []).map((variant) => {
                const vPatch = variantPatch(draft.document, variant.variantId);
                return (
                  <li key={variant.variantId} className="rounded-md border border-slate-800 p-3">
                    <p className="text-xs text-slate-400">
                      Variant {variant.variantId}
                      {" · "}
                      {variant.status ?? "active"}
                      {variant.variantId === product.defaultVariantId ? " · default" : ""}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Asset {variant.assetId ?? "none"} (read-only)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      SKU uniqueness is checked on Preview, including inactive SKUs.
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-400">
                        Finish {vPatch?.finishLabel !== undefined ? <span className="text-amber-300">pending</span> : null}
                        <input
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          value={finishes[variant.variantId] ?? ""}
                          disabled={pending || conflict}
                          onChange={(event) => setFinishes((current) => ({ ...current, [variant.variantId]: event.target.value }))}
                          onBlur={() => {
                            const next = blankToNull(finishes[variant.variantId] ?? "");
                            if (next === effective(variant.finishLabel, vPatch?.finishLabel)) return;
                            void save([{ type: "variant.set_finish_label", variantId: variant.variantId, finishLabel: next }]);
                          }}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        SKU {vPatch?.sku !== undefined ? <span className="text-amber-300">pending</span> : null}
                        <input
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          value={skus[variant.variantId] ?? ""}
                          disabled={pending || conflict}
                          onChange={(event) => setSkus((current) => ({ ...current, [variant.variantId]: event.target.value }))}
                          onBlur={() => {
                            const next = blankToNull(skus[variant.variantId] ?? "");
                            if (next === effective(variant.sku, vPatch?.sku)) return;
                            void save([{ type: "variant.set_sku", variantId: variant.variantId, sku: next }]);
                          }}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Price {vPatch?.priceAmount !== undefined ? <span className="text-amber-300">pending</span> : null}
                        <input
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          value={variantPrices[variant.variantId] ?? ""}
                          disabled={pending || conflict}
                          onChange={(event) => setVariantPrices((current) => ({ ...current, [variant.variantId]: event.target.value }))}
                          onBlur={() => {
                            const parsed = Number(variantPrices[variant.variantId]);
                            if (!Number.isFinite(parsed)) return;
                            if (parsed === effective(variant.priceAmount, vPatch?.priceAmount)) return;
                            void save([{ type: "variant.set_price", variantId: variant.variantId, priceAmount: parsed }]);
                          }}
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        Product URL {vPatch?.productUrl !== undefined ? <span className="text-amber-300">pending</span> : null}
                        <input
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                          value={variantUrls[variant.variantId] ?? ""}
                          disabled={pending || conflict}
                          onChange={(event) => setVariantUrls((current) => ({ ...current, [variant.variantId]: event.target.value }))}
                          onBlur={() => {
                            const next = blankToNull(variantUrls[variant.variantId] ?? "");
                            if (next === effective(variant.productUrl, vPatch?.productUrl)) return;
                            void save([{ type: "variant.set_product_url", variantId: variant.variantId, productUrl: next }]);
                          }}
                        />
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>

            <ul className="space-y-3">
              {pendingCreates(draft.document, product.productId).map((create) => (
                <li key={create.variantId} className="rounded-md border border-emerald-900/70 bg-emerald-950/20 p-3">
                  <p className="text-xs text-emerald-200">New Variant — pending publish</p>
                  <p className="text-[11px] text-slate-500">{create.variantId}</p>
                  <p className="text-[11px] text-slate-500">
                    Inherited currency {create.priceCurrency}
                    {" · "}
                    Asset {assetLabel(props.readyAssets, create.currentAssetId)}
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-slate-400">
                      Finish
                      <input
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                        value={finishes[create.variantId] ?? ""}
                        disabled={pending || conflict}
                        onChange={(event) => setFinishes((current) => ({ ...current, [create.variantId]: event.target.value }))}
                        onBlur={() => {
                          const next = blankToNull(finishes[create.variantId] ?? "");
                          if (next === create.finishLabel) return;
                          void save([{ type: "variant.create_edit", variantId: create.variantId, finishLabel: next }]);
                        }}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      SKU
                      <input
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                        value={skus[create.variantId] ?? ""}
                        disabled={pending || conflict}
                        onChange={(event) => setSkus((current) => ({ ...current, [create.variantId]: event.target.value }))}
                        onBlur={() => {
                          const next = blankToNull(skus[create.variantId] ?? "");
                          if (next === create.sku) return;
                          void save([{ type: "variant.create_edit", variantId: create.variantId, sku: next }]);
                        }}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Price ({create.priceCurrency})
                      <input
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                        value={variantPrices[create.variantId] ?? ""}
                        disabled={pending || conflict}
                        onChange={(event) => setVariantPrices((current) => ({ ...current, [create.variantId]: event.target.value }))}
                        onBlur={() => {
                          const parsed = Number(variantPrices[create.variantId]);
                          if (!Number.isFinite(parsed) || parsed < 0) return;
                          if (parsed === create.priceAmount) return;
                          void save([{ type: "variant.create_edit", variantId: create.variantId, priceAmount: parsed }]);
                        }}
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Product URL
                      <input
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                        value={variantUrls[create.variantId] ?? ""}
                        disabled={pending || conflict}
                        onChange={(event) => setVariantUrls((current) => ({ ...current, [create.variantId]: event.target.value }))}
                        onBlur={() => {
                          const next = blankToNull(variantUrls[create.variantId] ?? "");
                          if (next === create.productUrl) return;
                          void save([{ type: "variant.create_edit", variantId: create.variantId, productUrl: next }]);
                        }}
                      />
                    </label>
                    <label className="text-xs text-slate-400 sm:col-span-2">
                      Asset
                      <select
                        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                        value={create.currentAssetId}
                        disabled={pending || conflict || props.readyAssets.length === 0}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (!next || next === create.currentAssetId) return;
                          void save([{ type: "variant.create_edit", variantId: create.variantId, currentAssetId: next }]);
                        }}
                      >
                        {props.readyAssets.map((asset) => (
                          <option key={asset.assetId} value={asset.assetId}>
                            {asset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={pending || conflict}
                    className="mt-3 rounded-md border border-slate-700 px-3 py-1 text-xs"
                    onClick={() => void save([{ type: "variant.create_remove", variantId: create.variantId }])}
                  >
                    Remove pending variant
                  </button>
                </li>
              ))}
            </ul>

            {addingProductId === product.productId ? (
              <div className="rounded-md border border-slate-700 p-3">
                <p className="text-xs text-slate-300">Add Variant</p>
                <p className="text-[11px] text-slate-500">
                  Parent {product.name} · inherited currency {product.priceCurrency}
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-400">
                    Finish label
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={newFinish}
                      disabled={pending || conflict}
                      onChange={(event) => setNewFinish(event.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Identity slug
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={newSlug}
                      disabled={pending || conflict}
                      onChange={(event) => setNewSlug(event.target.value)}
                      placeholder="Required if finish is blank"
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    SKU
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={newSku}
                      disabled={pending || conflict}
                      onChange={(event) => setNewSku(event.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Price ({product.priceCurrency})
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={newPrice}
                      disabled={pending || conflict}
                      onChange={(event) => setNewPrice(event.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Product URL
                    <input
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={newUrl}
                      disabled={pending || conflict}
                      onChange={(event) => setNewUrl(event.target.value)}
                    />
                  </label>
                  <label className="text-xs text-slate-400">
                    Asset
                    <select
                      className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                      value={newAssetId}
                      disabled={pending || conflict || props.readyAssets.length === 0}
                      onChange={(event) => setNewAssetId(event.target.value)}
                    >
                      {props.readyAssets.map((asset) => (
                        <option key={asset.assetId} value={asset.assetId}>
                          {asset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || conflict || props.readyAssets.length === 0}
                    className="rounded-md border border-emerald-700 px-3 py-1 text-xs text-emerald-100"
                    onClick={() => {
                      const priceAmount = Number(newPrice);
                      if (!Number.isFinite(priceAmount) || priceAmount < 0) {
                        setError("Price is required and must be zero or greater.");
                        return;
                      }
                      if (!newAssetId) {
                        setError("Select a certified Partner asset.");
                        return;
                      }
                      const finishLabel = blankToNull(newFinish);
                      const creationSlug = blankToNull(newSlug);
                      if (!finishLabel && !creationSlug) {
                        setError("Enter a finish label or identity slug.");
                        return;
                      }
                      void (async () => {
                        const ok = await save([{
                          type: "variant.create",
                          productId: product.productId,
                          finishLabel,
                          sku: blankToNull(newSku),
                          priceAmount,
                          productUrl: blankToNull(newUrl),
                          currentAssetId: newAssetId,
                          ...(creationSlug ? { creationSlug } : {}),
                        }]);
                        if (!ok) return;
                        setAddingProductId(null);
                        setNewFinish("");
                        setNewSku("");
                        setNewPrice("");
                        setNewUrl("");
                        setNewSlug("");
                        setNewAssetId(props.readyAssets[0]?.assetId ?? "");
                      })();
                    }}
                  >
                    Save variant
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                    onClick={() => setAddingProductId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={pending || conflict || props.readyAssets.length === 0}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                onClick={() => {
                  setAddingProductId(product.productId);
                  setNewFinish("");
                  setNewSku("");
                  setNewPrice("");
                  setNewUrl("");
                  setNewSlug("");
                  setNewAssetId(props.readyAssets[0]?.assetId ?? "");
                }}
              >
                Add Variant
              </button>
            )}
            {props.readyAssets.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No certified Partner assets are available to assign.
              </p>
            ) : null}
          </article>
        );
      })}

      <section className="space-y-3 rounded-xl border border-slate-800 p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">Add Collection</h3>
          {!addingCollection ? (
            <button
              type="button"
              disabled={pending || conflict}
              className="rounded-md border border-slate-700 px-3 py-1 text-xs"
              onClick={() => setAddingCollection(true)}
            >
              Add Collection
            </button>
          ) : null}
        </div>
        <p className="text-[11px] text-slate-500">
          Collection identity is derived from the name or an optional slug. Save with zero Products to create an empty Collection.
        </p>
        {addingCollection ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400 sm:col-span-2">
              Collection name
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newCollectionName}
                disabled={pending || conflict}
                onChange={(event) => setNewCollectionName(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400 sm:col-span-2">
              Collection identity slug
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                value={newCollectionSlug}
                disabled={pending || conflict}
                onChange={(event) => setNewCollectionSlug(event.target.value)}
                placeholder="Optional if the name slugs cleanly"
              />
            </label>
            <fieldset className="sm:col-span-2 space-y-1">
              <legend className="text-xs text-slate-400">Product membership</legend>
              {props.products.map((product) => (
                <label key={product.productId} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={newCollectionProductIds.includes(product.productId)}
                    disabled={pending || conflict}
                    onChange={(event) => {
                      setNewCollectionProductIds((current) => (
                        event.target.checked
                          ? [...current, product.productId]
                          : current.filter((id) => id !== product.productId)
                      ));
                    }}
                  />
                  {product.name}
                </label>
              ))}
              {pendingProducts(draft.document).map((product) => (
                <label key={product.productId} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={newCollectionProductIds.includes(product.productId)}
                    disabled={pending || conflict}
                    onChange={(event) => {
                      setNewCollectionProductIds((current) => (
                        event.target.checked
                          ? [...current, product.productId]
                          : current.filter((id) => id !== product.productId)
                      ));
                    }}
                  />
                  {product.name}
                  <span className="text-sky-300">pending publish</span>
                </label>
              ))}
            </fieldset>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="button"
                disabled={pending || conflict || !newCollectionName.trim()}
                className="rounded-md border border-emerald-700 px-3 py-1 text-xs text-emerald-100"
                onClick={() => {
                  const creationSlug = newCollectionSlug.trim() ? newCollectionSlug.trim() : undefined;
                  void save([{
                    type: "collection.create",
                    name: newCollectionName.trim(),
                    ...(creationSlug ? { creationSlug } : {}),
                    ...(newCollectionProductIds.length > 0 ? { productIds: newCollectionProductIds } : {}),
                  }]).then((ok) => {
                    if (!ok) return;
                    setAddingCollection(false);
                    setNewCollectionName("");
                    setNewCollectionSlug("");
                    setNewCollectionProductIds([]);
                  });
                }}
              >
                Save collection
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                onClick={() => {
                  setAddingCollection(false);
                  setNewCollectionName("");
                  setNewCollectionSlug("");
                  setNewCollectionProductIds([]);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {pendingCollections(draft.document).map((create) => {
          const selected = membership[create.collectionId] ?? pendingCollectionProductIds(draft.document, create.collectionId);
          return (
            <article key={create.collectionId} className="space-y-3 rounded-xl border border-violet-900/60 p-4">
              <p className="text-xs text-violet-200">New Collection — pending publish</p>
              <label className="text-xs text-slate-400">
                Name
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={collectionNames[create.collectionId] ?? create.name}
                  disabled={pending || conflict}
                  onChange={(event) => setCollectionNames((current) => ({
                    ...current,
                    [create.collectionId]: event.target.value,
                  }))}
                  onBlur={() => {
                    const next = (collectionNames[create.collectionId] ?? "").trim();
                    if (!next || next === create.name) return;
                    void save([{ type: "collection.create_edit", collectionId: create.collectionId, name: next }]);
                  }}
                />
              </label>
              <p className="text-[11px] text-slate-500">{create.collectionId}</p>
              <fieldset className="space-y-1">
                <legend className="text-xs text-slate-400">Product membership</legend>
                {props.products.map((product) => (
                  <label key={product.productId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={selected.includes(product.productId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        const current = new Set(selected);
                        if (event.target.checked) current.add(product.productId);
                        else current.delete(product.productId);
                        setMembership((prev) => ({ ...prev, [create.collectionId]: [...current] }));
                      }}
                    />
                    {product.name}
                  </label>
                ))}
                {pendingProducts(draft.document).map((product) => (
                  <label key={product.productId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={selected.includes(product.productId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        const current = new Set(selected);
                        if (event.target.checked) current.add(product.productId);
                        else current.delete(product.productId);
                        setMembership((prev) => ({ ...prev, [create.collectionId]: [...current] }));
                      }}
                    />
                    {product.name}
                    <span className="text-sky-300">pending publish</span>
                  </label>
                ))}
              </fieldset>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || conflict}
                  className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                  onClick={() => {
                    const desired = [...(membership[create.collectionId] ?? selected)].sort();
                    const currentDesired = pendingCollectionProductIds(draft.document, create.collectionId);
                    if (desired.join("\0") === currentDesired.join("\0")) return;
                    void save([{
                      type: "collection.create_edit",
                      collectionId: create.collectionId,
                      productIds: desired,
                    }]);
                  }}
                >
                  Save membership
                </button>
                <button
                  type="button"
                  disabled={pending || conflict}
                  className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                  onClick={() => void save([{ type: "collection.create_remove", collectionId: create.collectionId }])}
                >
                  Remove pending collection
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="space-y-4">
        <h3 className="font-medium">Collections</h3>
        <p className="text-xs text-slate-500">
          Only currently visible Partner Collections are editable. Inactive Collection
          authoring is deferred.
        </p>
        {props.collections.map((collection) => {
          const patch = collectionPatch(draft.document, collection.collectionId);
          const selected = new Set(membership[collection.collectionId] ?? collection.productIds);
          const membershipPending = (
            draft.document.collections.membershipAdd.some((item) => item.collectionId === collection.collectionId)
            || draft.document.collections.membershipRemove.some((item) => item.collectionId === collection.collectionId)
          );
          return (
            <article key={collection.collectionId} className="space-y-3 rounded-xl border border-slate-800 p-4">
              <label className="text-xs text-slate-400">
                Name {patch?.name !== undefined ? <span className="text-amber-300">pending</span> : null}
                <input
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
                  value={collectionNames[collection.collectionId] ?? ""}
                  disabled={pending || conflict}
                  onChange={(event) => setCollectionNames((current) => ({ ...current, [collection.collectionId]: event.target.value }))}
                  onBlur={() => {
                    const next = (collectionNames[collection.collectionId] ?? "").trim();
                    if (!next) return;
                    if (next === effective(collection.name, patch?.name)) return;
                    void save([{ type: "collection.set_name", collectionId: collection.collectionId, name: next }]);
                  }}
                />
              </label>
              <p className="text-[11px] text-slate-500">{collection.collectionId}</p>
              <fieldset className="space-y-1">
                <legend className="text-xs text-slate-400">
                  Membership {membershipPending ? <span className="text-amber-300">pending</span> : null}
                </legend>
                {props.products.map((product) => (
                  <label key={product.productId} className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={selected.has(product.productId)}
                      disabled={pending || conflict}
                      onChange={(event) => {
                        const current = new Set(membership[collection.collectionId] ?? collection.productIds);
                        if (event.target.checked) current.add(product.productId);
                        else current.delete(product.productId);
                        setMembership((prev) => ({ ...prev, [collection.collectionId]: [...current] }));
                      }}
                    />
                    {product.name}
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                disabled={pending || conflict}
                className="rounded-md border border-slate-700 px-3 py-1 text-xs"
                onClick={() => {
                  const desired = [...(membership[collection.collectionId] ?? collection.productIds)].sort();
                  const currentDesired = desiredMembership(
                    draft.document,
                    collection.collectionId,
                    collection.productIds,
                  ).sort();
                  if (desired.join("\0") === currentDesired.join("\0")) return;
                  void save([{
                    type: "collection.set_membership",
                    collectionId: collection.collectionId,
                    productIds: desired,
                  }]);
                }}
              >
                Save membership
              </button>
            </article>
          );
        })}
      </section>

      <details className="rounded-xl border border-slate-800 p-4 text-xs text-slate-400">
        <summary className="cursor-pointer text-sm text-slate-300">Draft diagnostics</summary>
        <pre className="mt-3 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-300">
          {JSON.stringify({
            draftId: draft.draftId,
            revision: draft.revision,
            status: draft.status,
            baseCatalogHash: draft.baseCatalogHash,
            document: draft.document,
          }, null, 2)}
        </pre>
      </details>
    </main>
  );
}
