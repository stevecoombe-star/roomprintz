import { STAGE_BROWSE_CATEGORIES } from "@/lib/vibode-stage/catalog";
import { loadPartnerCommercialAssetsForPortal } from "@/lib/vibode-stage/partner-commercial-assets.server";
import { extraCommercialAssetIdsForDraft } from "@/lib/vibode-stage/partner-draft-mutations";
import { loadAuthorizedPartnerPortalCatalog } from "@/lib/vibode-stage/partner-portal-catalog.server";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { loadPartnerPortalDraft } from "@/lib/vibode-stage/partner-portal-drafts.server";
import { toPartnerDraftDto } from "@/lib/vibode-stage/partner-portal-drafts";
import { partnerCatalogCurrencyForCreate } from "@/lib/vibode-stage/partner-draft-mutations";
import { PartnerDraftWorkspaceClient } from "./PartnerDraftWorkspaceClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PartnerDraftWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>;
  searchParams: Promise<{ product?: string; intent?: string }>;
}) {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return null;
  const { draftId } = await params;
  const query = await searchParams;
  const row = await loadPartnerPortalDraft(auth.context.partnerId, draftId);
  const dto = row ? toPartnerDraftDto(row, auth.context.partnerId) : null;
  if (!dto) {
    return (
      <main className="space-y-3">
        <h2 className="text-lg font-semibold">Catalog</h2>
        <p className="text-sm text-slate-300">This page could not be opened.</p>
        <a className="text-sm text-slate-400 underline" href="/partner/catalog">Back to Catalog</a>
      </main>
    );
  }

  if (dto.status === "abandoned") {
    return (
      <main className="space-y-3">
        <h2 className="text-lg font-semibold">Catalog</h2>
        <p className="text-sm text-slate-300">
          These unpublished changes were discarded.
        </p>
        <a className="text-sm text-slate-400 underline" href="/partner/catalog">Back to Catalog</a>
      </main>
    );
  }

  if (dto.status === "published") {
    return (
      <main className="space-y-3">
        <h2 className="text-lg font-semibold">Catalog</h2>
        <p className="text-sm text-slate-300">
          These changes are already published.
        </p>
        <details className="text-xs text-slate-500">
          <summary>Technical details</summary>
          <p className="mt-1">Draft {dto.draftId} · revision {dto.revision}</p>
        </details>
        <a className="text-sm text-slate-400 underline" href="/partner/catalog">Back to Catalog</a>
      </main>
    );
  }

  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) {
    return (
      <main>
        <h2 className="text-lg font-semibold">Catalog</h2>
        <p className="mt-3 text-sm text-slate-300">
          Your catalog could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  }

  const commercial = await loadPartnerCommercialAssetsForPortal(
    auth.context.partnerId,
    loaded.catalog,
    extraCommercialAssetIdsForDraft(dto.document, loaded.catalog),
  );
  if (!commercial.ok) {
    return (
      <main>
        <h2 className="text-lg font-semibold">Catalog</h2>
        <p className="mt-3 text-sm text-slate-300">
          3D models could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  }

  return (
    <PartnerDraftWorkspaceClient
      partnerName={auth.context.partner.name}
      partnerId={auth.context.partnerId}
      draft={dto}
      products={loaded.catalog.products}
      variants={loaded.catalog.variants}
      collections={loaded.catalog.collections}
      commercialAssetOptions={commercial.options}
      categories={STAGE_BROWSE_CATEGORIES}
      catalogCurrency={partnerCatalogCurrencyForCreate(loaded.catalog, auth.context.partnerId)}
      focusProductId={query.product ?? null}
      openProductCreate={query.intent === "add-product"}
    />
  );
}
