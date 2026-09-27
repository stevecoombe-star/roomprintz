import { countPartnerDraftOperations } from "@/lib/vibode-stage/partner-draft-mutations";
import { loadPartnerCommercialAssetsForPortal } from "@/lib/vibode-stage/partner-commercial-assets.server";
import { buildPartnerCatalogRows } from "@/lib/vibode-stage/partner-catalog-workspace";
import { loadAuthorizedPartnerPortalCatalog } from "@/lib/vibode-stage/partner-portal-catalog.server";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { loadOpenPartnerPortalDraft } from "@/lib/vibode-stage/partner-portal-drafts.server";
import { PartnerCatalogWorkspace } from "./PartnerCatalogWorkspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PartnerCatalogPage() {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return null;
  const loaded = await loadAuthorizedPartnerPortalCatalog(auth.context.partnerId);
  if (!loaded.ok) {
    return (
      <main>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="mt-2 text-sm text-slate-300">
          Your catalog could not be loaded. Try again in a moment.
        </p>
      </main>
    );
  }

  const openDraft = await loadOpenPartnerPortalDraft(auth.context.partnerId);
  const rows = buildPartnerCatalogRows(loaded.catalog);
  let needsModelBeforeFirstProduct = false;
  if (rows.length === 0) {
    const commercial = await loadPartnerCommercialAssetsForPortal(
      auth.context.partnerId,
      loaded.catalog,
    );
    needsModelBeforeFirstProduct = commercial.ok && commercial.options.length === 0;
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Manage the products available through Vibode.
        </p>
      </header>
      <PartnerCatalogWorkspace
        rows={rows}
        openDraftId={openDraft?.draftId ?? null}
        hasUnpublishedChanges={
          openDraft != null && countPartnerDraftOperations(openDraft.document) > 0
        }
        needsModelBeforeFirstProduct={needsModelBeforeFirstProduct}
      />
    </main>
  );
}
