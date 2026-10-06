import { STAGE_BROWSE_CATEGORIES } from "@/lib/vibode-stage/catalog";
import { partnerAddProductCurrencyChoice } from "@/lib/vibode-stage/partner-add-product";
import { loadPartnerCommercialAssetsForPortal } from "@/lib/vibode-stage/partner-commercial-assets.server";
import {
  extraCommercialAssetIdsForDraft,
  resolvePartnerCatalogCurrency,
} from "@/lib/vibode-stage/partner-draft-mutations";
import { loadAuthorizedPartnerPortalCatalog } from "@/lib/vibode-stage/partner-portal-catalog.server";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { loadOpenPartnerPortalDraft } from "@/lib/vibode-stage/partner-portal-drafts.server";
import { partnerEditorDraftFromPortal } from "@/lib/vibode-stage/partner-product-editor";
import { PartnerAddProductFlow } from "./PartnerAddProductFlow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PartnerAddProductPage() {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return null;
  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) {
    return (
      <main>
        <h1 className="text-2xl font-semibold tracking-tight">Add product</h1>
        <p className="mt-2 text-sm text-slate-300">
          Your catalog could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  }

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
        <h1 className="text-2xl font-semibold tracking-tight">Add product</h1>
        <p className="mt-2 text-sm text-slate-300">
          3D models could not be loaded. Product creation is paused until they can be read.
        </p>
        <a className="mt-4 inline-block text-sm text-slate-400 underline" href="/partner/catalog">
          Back to Catalog
        </a>
      </main>
    );
  }

  const currency = resolvePartnerCatalogCurrency(loaded.catalog, auth.context.partnerId);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Add product</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Add a product, its first finish, and a 3D model.
        </p>
      </header>
      <PartnerAddProductFlow
        partnerId={auth.context.partnerId}
        currency={partnerAddProductCurrencyChoice(
          currency.status,
          currency.status === "resolved" ? currency.currency : null,
        )}
        categories={STAGE_BROWSE_CATEGORIES}
        collections={loaded.catalog.collections}
        products={loaded.catalog.products}
        variants={loaded.catalog.variants}
        assets={loaded.catalog.assets}
        commercialAssetOptions={commercial.options}
        draft={draft}
      />
    </main>
  );
}
