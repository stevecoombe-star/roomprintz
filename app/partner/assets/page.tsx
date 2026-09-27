export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { PartnerAssetWorkspaceClient } from "./PartnerAssetWorkspaceClient";

export default function PartnerAssetsPage() {
  return (
    <main className="space-y-6">
      <section className="space-y-2">
        <h1 className="text-lg font-semibold">3D Models</h1>
        <p className="max-w-2xl text-sm text-slate-300">
          View and manage the 3D models used across your Vibode catalog.
        </p>
        <p className="max-w-2xl text-sm text-slate-400">
          Upload new models while editing a Product or Variant.{" "}
          <a href="/partner/catalog" className="text-slate-200 underline">
            Open Catalog
          </a>
        </p>
      </section>
      <PartnerAssetWorkspaceClient />
    </main>
  );
}
