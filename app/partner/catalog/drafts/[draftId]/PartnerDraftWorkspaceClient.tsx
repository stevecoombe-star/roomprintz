"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  partnerDraftPreviewHasChanges,
  presentPartnerDraftPreview,
  type PartnerDraftPreviewView,
} from "@/lib/vibode-stage/partner-draft-preview-view";
import type { StageCollection, StageProduct, StageVariant } from "@/lib/vibode-stage/types";

type DraftDocument = {
  products: {
    update: ReadonlyArray<{
      productId: string;
      name?: string;
      imageUrl?: string;
      productUrl?: string | null;
      priceAmount?: number;
    }>;
  };
  variants: {
    update: ReadonlyArray<{
      variantId: string;
      finishLabel?: string | null;
      sku?: string | null;
      priceAmount?: number;
      productUrl?: string | null;
    }>;
  };
  collections: {
    update: ReadonlyArray<{ collectionId: string; name?: string }>;
    membershipAdd: ReadonlyArray<{ productId: string; collectionId: string }>;
    membershipRemove: ReadonlyArray<{ productId: string; collectionId: string }>;
  };
};

type PartnerDraft = {
  draftId: string;
  partnerId: string;
  documentKind: "patch";
  status: "open" | "abandoned";
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
  | { type: "variant.set_finish_label"; variantId: string; finishLabel: string | null }
  | { type: "variant.set_sku"; variantId: string; sku: string | null }
  | { type: "variant.set_price"; variantId: string; priceAmount: number }
  | { type: "variant.set_product_url"; variantId: string; productUrl: string | null }
  | { type: "collection.set_name"; collectionId: string; name: string }
  | { type: "collection.set_membership"; collectionId: string; productIds: readonly string[] };

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
        <h4 className="text-xs uppercase tracking-wide text-slate-500">Variant updates</h4>
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
        {view.membershipAdds.length === 0 && view.membershipRemoves.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-slate-200">
            {view.membershipAdds.map((item) => (
              <li key={`add:${item.collectionId}:${item.productId}`}>
                Add {item.productId} → {item.collectionId}
              </li>
            ))}
            {view.membershipRemoves.map((item) => (
              <li key={`remove:${item.collectionId}:${item.productId}`}>
                Remove {item.productId} → {item.collectionId}
              </li>
            ))}
          </ul>
        )}
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
  focusProductId: string | null;
}>) {
  const router = useRouter();
  const [draft, setDraft] = useState(props.draft);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof presentPartnerDraftPreview> | null>(null);
  const [previewRaw, setPreviewRaw] = useState<unknown>(null);
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

  async function save(mutations: DraftMutation[]) {
    if (conflict) return;
    setPending(true);
    setError(null);
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
        return;
      }
      if (!response.ok || !body.draft) {
        setError(body.error ?? "Draft could not be saved.");
        return;
      }
      setDraft(body.draft);
      syncForms(body.draft);
    } catch {
      setError("Draft could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    setPending(true);
    setError(null);
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
        {pending && !preview ? (
          <p id="draft-preview-result" className="text-sm text-slate-300">Planning…</p>
        ) : preview ? (
          <DraftPreviewResult preview={preview} raw={previewRaw} />
        ) : null}
      </section>

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
          </article>
        );
      })}

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
