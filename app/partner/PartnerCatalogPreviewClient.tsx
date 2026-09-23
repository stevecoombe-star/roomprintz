"use client";

import { useMemo, useState } from "react";

type PreviewProduct = Readonly<{ productId: string; name: string }>;
type PreviewVariant = Readonly<{ variantId: string; productId: string; assetId: string | null }>;

type PreviewDto = Readonly<{
  ok: boolean;
  noOp: boolean;
  partnerId: string | null;
  issues: readonly Readonly<{ code: string; message: string }>[];
  productUpdates: readonly Readonly<{
    productId: string;
    changes: readonly Readonly<{ column: string; previous: string | number | null; next: string | number | null }>[];
  }>[];
  variantUpdates: readonly Readonly<{
    variantId: string;
    productId: string;
    changes: readonly Readonly<{ column: string; previous: string | number | null; next: string | number | null }>[];
  }>[];
}>;

const ASSET_RETARGET_PROBE = "asset-pi5d2b-retarget-required";

export function PartnerCatalogPreviewClient(props: Readonly<{
  partnerId: string;
  products: readonly PreviewProduct[];
  variants: readonly PreviewVariant[];
}>) {
  const firstProduct = props.products[0] ?? null;
  const firstVariant = props.variants[0] ?? null;
  const [productId, setProductId] = useState(firstProduct?.productId ?? "");
  const [productName, setProductName] = useState(
    firstProduct ? `${firstProduct.name} (preview)` : "",
  );
  const [variantId, setVariantId] = useState(firstVariant?.variantId ?? "");
  const [result, setResult] = useState<PreviewDto | { error: string } | null>(null);
  const [pending, setPending] = useState(false);

  const selectedProductName = useMemo(
    () => props.products.find((product) => product.productId === productId)?.name ?? "",
    [productId, props.products],
  );

  async function preview(document: unknown) {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/vibode/partner/catalog/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document }),
      });
      const body = await response.json() as PreviewDto | { error?: string };
      if (!response.ok && "error" in body && body.error) {
        setResult({ error: body.error });
        return;
      }
      setResult(body as PreviewDto);
    } catch {
      setResult({ error: "Preview request failed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 p-4">
      <h3 className="font-medium">Certified patch preview</h3>
      <p className="mt-1 text-xs text-slate-500">
        Plans a PI-5F patch against live durable state. Does not write the catalog.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs"
          onClick={() => void preview({ partnerId: props.partnerId, mode: "patch" })}
        >
          Preview no-op
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-xs text-slate-400">
          Product
          <select
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            value={productId}
            onChange={(event) => {
              const nextId = event.target.value;
              setProductId(nextId);
              const next = props.products.find((product) => product.productId === nextId);
              if (next) setProductName(`${next.name} (preview)`);
            }}
          >
            {props.products.map((product) => (
              <option key={product.productId} value={product.productId}>
                {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Proposed name
          <input
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            value={productName}
            onChange={(event) => setProductName(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={pending || !productId || !productName.trim()}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs"
          onClick={() => void preview({
            partnerId: props.partnerId,
            mode: "patch",
            products: { update: [{ productId, name: productName.trim() }] },
          })}
        >
          Preview name change
        </button>
      </div>
      {selectedProductName ? (
        <p className="mt-1 text-[11px] text-slate-500">Current name: {selectedProductName}</p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="text-xs text-slate-400">
          Variant
          <select
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
          >
            {props.variants.map((variant) => (
              <option key={variant.variantId} value={variant.variantId}>
                {variant.variantId}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !variantId}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs"
          onClick={() => void preview({
            partnerId: props.partnerId,
            mode: "patch",
            variants: {
              update: [{ variantId, currentAssetId: ASSET_RETARGET_PROBE }],
            },
          })}
        >
          Preview Asset replacement
        </button>
      </div>

      <pre className="mt-4 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-300">
        {pending
          ? "Planning…"
          : result
            ? JSON.stringify(result, null, 2)
            : "No preview yet."}
      </pre>
    </section>
  );
}
