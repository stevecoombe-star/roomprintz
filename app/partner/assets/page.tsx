export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { PartnerAssetWorkspaceClient } from "./PartnerAssetWorkspaceClient";

export default function PartnerAssetsPage() {
  return (
    <main className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Partner assets</h2>
        <p className="text-sm text-slate-300">
          Upload a furniture GLB and enter the actual product dimensions in metres.
          Vibode measures the GLB and checks that the model is correctly scaled.
        </p>
        <p className="text-sm text-slate-400">
          The GLB should already be modeled at real-world scale. Vibode does not automatically
          resize uploaded furniture. A validated intake is not a runtime-ready Asset and is not
          available in Product or Variant authoring yet.
        </p>
      </section>
      <PartnerAssetWorkspaceClient />
    </main>
  );
}
