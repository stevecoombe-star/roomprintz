import { notFound } from "next/navigation";

import { attachModelThumbnailUrls } from "@/lib/vibode-model-thumbnail/persist.server";
import { STAGE_BROWSE_CATEGORIES } from "@/lib/vibode-stage/catalog";
import { loadPartnerCommercialAssetsForPortal } from "@/lib/vibode-stage/partner-commercial-assets.server";
import { extraCommercialAssetIdsForDraft } from "@/lib/vibode-stage/partner-draft-mutations";
import { loadAuthorizedPartnerPortalCatalog } from "@/lib/vibode-stage/partner-portal-catalog.server";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { loadOpenPartnerPortalDraft } from "@/lib/vibode-stage/partner-portal-drafts.server";
import {
  partnerEditorDraftFromPortal,
  partnerEditorModelAssetIds,
  resolvePartnerProductEditor,
} from "@/lib/vibode-stage/partner-product-editor";
import { PartnerProductEditor } from "../PartnerProductEditor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PartnerProductEditorPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return null;
  const { productId } = await params;
  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) {
    return (
      <main>
        <h1 className="text-2xl font-semibold tracking-tight">Product</h1>
        <p className="mt-2 text-sm text-slate-300">
          Your catalog could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  }

  const resolved = resolvePartnerProductEditor({
    partnerId: auth.context.partnerId,
    productId,
    products: loaded.catalog.products,
  });
  if (!resolved.ok) notFound();

  const openDraft = await loadOpenPartnerPortalDraft(auth.context.partnerId);
  const draft = partnerEditorDraftFromPortal(openDraft);
  const commercial = await loadPartnerCommercialAssetsForPortal(
    auth.context.partnerId,
    loaded.catalog,
    draft ? extraCommercialAssetIdsForDraft(draft.document, loaded.catalog) : [],
  );
  if (!commercial.ok) {
    return (
      <main>
        <h1 className="text-2xl font-semibold tracking-tight">{resolved.product.name}</h1>
        <p className="mt-2 text-sm text-slate-300">
          3D models could not be loaded. Product editing is paused until they can be read.
        </p>
        <a className="mt-4 inline-block text-sm text-slate-400 underline" href="/partner/catalog">
          Back to Catalog
        </a>
      </main>
    );
  }

  const productVariants = loaded.catalog.variants.filter((variant) => variant.productId === resolved.product.productId);
  const modelAssetIds = partnerEditorModelAssetIds({
    optionAssetIds: commercial.options.map((option) => option.assetId),
    variantAssetIds: productVariants.map((variant) => variant.assetId),
    pendingAssetIds: (draft?.document.variants.create ?? [])
      .filter((create) => create.productId === resolved.product.productId)
      .map((create) => create.currentAssetId),
  });
  const thumbnailRows = await attachModelThumbnailUrls(modelAssetIds.map((assetId) => ({ assetId })));
  const modelThumbnailUrls = Object.fromEntries(
    thumbnailRows.map((row) => [row.assetId, row.thumbnailUrl]),
  );

  return (
    <main>
      <PartnerProductEditor
        product={resolved.product}
        variants={productVariants}
        modelThumbnailUrls={modelThumbnailUrls}
        collections={loaded.catalog.collections}
        assets={loaded.catalog.assets}
        commercialAssetOptions={commercial.options}
        categories={STAGE_BROWSE_CATEGORIES}
        draft={draft}
        productNames={Object.fromEntries(loaded.catalog.products.map((product) => [product.productId, product.name]))}
        variantProductIds={Object.fromEntries(loaded.catalog.variants.map((variant) => [variant.variantId, variant.productId]))}
      />
    </main>
  );
}
