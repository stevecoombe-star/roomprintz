import { loadAuthorizedPartnerPortalCatalog } from "@/lib/vibode-stage/partner-portal-catalog.server";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { loadOpenPartnerPortalDraft } from "@/lib/vibode-stage/partner-portal-drafts.server";
import { PartnerCatalogDraftEntry } from "./PartnerCatalogDraftEntry";
import { PartnerCatalogPreviewClient } from "../PartnerCatalogPreviewClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PartnerCatalogPage() {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return null;
  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) {
    return (
      <main>
        <h2 className="text-lg font-semibold">Catalog</h2>
        <p className="mt-3 text-sm text-slate-300">
          Durable Partner catalog could not be loaded. Curated catalog data is not shown.
        </p>
      </main>
    );
  }

  const catalog = loaded.catalog;
  const openDraft = await loadOpenPartnerPortalDraft(auth.context.partnerId);
  const variantsByProduct = new Map<string, typeof catalog.variants>();
  for (const variant of catalog.variants) {
    const current = variantsByProduct.get(variant.productId) ?? [];
    variantsByProduct.set(variant.productId, [...current, variant]);
  }

  return (
    <main className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold">Durable catalog</h2>
        <p className="mt-1 text-sm text-slate-400">
          Partner {catalog.partners[0]?.name} · {catalog.partners[0]?.partnerId} ·
          commercial status {catalog.partners[0]?.status}
        </p>
      </section>

      <PartnerCatalogDraftEntry
        openDraftId={openDraft?.draftId ?? null}
        openRevision={openDraft?.revision ?? null}
      />

      <section className="space-y-4">
        {catalog.products.map((product) => (
          <article key={product.productId} className="rounded-xl border border-slate-800 p-4">
            <div className="flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.imageUrl}
                alt=""
                className="h-16 w-16 rounded-md object-cover bg-slate-900"
              />
              <div>
                <h3 className="font-medium">{product.name}</h3>
                <p className="text-xs text-slate-400">{product.productId}</p>
                <p className="text-xs text-slate-400">
                  {product.status ?? "active"}
                  {product.productUrl ? ` · ${product.productUrl}` : ""}
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-slate-300">
              {(variantsByProduct.get(product.productId) ?? []).map((variant) => (
                <li key={variant.variantId}>
                  {variant.variantId}
                  {" · "}
                  SKU {variant.sku ?? "—"}
                  {" · "}
                  {variant.finishLabel ?? "no finish"}
                  {" · "}
                  {variant.priceAmount == null ? "no price" : `${variant.priceAmount} ${variant.priceCurrency}`}
                  {" · "}
                  {variant.status ?? "active"}
                  {" · "}
                  asset {variant.assetId ?? "none"}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section>
        <h3 className="font-medium">Collections</h3>
        <ul className="mt-2 space-y-2 text-sm text-slate-300">
          {catalog.collections.map((collection) => (
            <li key={collection.collectionId}>
              {collection.name} ({collection.collectionId})
              <div className="text-xs text-slate-500">
                {collection.productIds.join(", ") || "no products"}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <PartnerCatalogPreviewClient
        partnerId={auth.context.partnerId}
        products={catalog.products.map((product) => ({
          productId: product.productId,
          name: product.name,
        }))}
        variants={catalog.variants.map((variant) => ({
          variantId: variant.variantId,
          productId: variant.productId,
          assetId: variant.assetId,
        }))}
      />
    </main>
  );
}
