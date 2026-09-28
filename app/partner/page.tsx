import Link from "next/link";

import { countPartnerDraftOperations } from "@/lib/vibode-stage/partner-draft-mutations";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { loadOpenPartnerPortalDraft } from "@/lib/vibode-stage/partner-portal-drafts.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CARD =
  "block rounded-xl border border-slate-800 px-5 py-5 transition hover:border-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300";

export default async function PartnerHomePage() {
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) return null;
  const openDraft = await loadOpenPartnerPortalDraft(auth.context.partnerId);
  const hasUnpublishedChanges = openDraft != null
    && countPartnerDraftOperations(openDraft.document) > 0;

  return (
    <main className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="break-words text-3xl font-semibold tracking-tight">{auth.context.partner.name}</h1>
        <p className="mt-2 text-sm text-slate-300">Your Vibode furniture catalog.</p>
      </header>

      {hasUnpublishedChanges && openDraft ? (
        <section
          aria-labelledby="home-unpublished-heading"
          className="max-w-2xl rounded-xl border border-amber-800/80 bg-amber-950/40 px-4 py-4"
        >
          <h2 id="home-unpublished-heading" className="text-sm font-medium text-amber-50">
            Unpublished changes
          </h2>
          <p className="mt-1 text-sm text-amber-100/80">
            You have catalog changes that have not been published yet.
          </p>
          <Link
            href={`/partner/catalog/drafts/${openDraft.draftId}`}
            className="mt-3 inline-flex rounded-md border border-slate-600 px-3.5 py-2 text-sm text-slate-100 hover:border-slate-400"
          >
            Continue editing
          </Link>
        </section>
      ) : null}

      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <Link href="/partner/catalog" className={CARD}>
          <span className="block text-base font-medium">Catalog</span>
          <span className="mt-1 block text-sm text-slate-400">
            Manage the products available through Vibode.
          </span>
        </Link>
        <Link href="/partner/assets" className={CARD}>
          <span className="block text-base font-medium">3D Models</span>
          <span className="mt-1 block text-sm text-slate-400">
            View the models used across your catalog.
          </span>
        </Link>
      </div>
    </main>
  );
}
