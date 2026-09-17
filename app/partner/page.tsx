export const dynamic = "force-dynamic";

export default function PartnerOverviewPage() {
  return (
    <main className="space-y-4">
      <h2 className="text-lg font-semibold">Partner catalog workspace</h2>
      <p className="text-sm text-slate-300">
        This Partner Portal slice loads your durable STAGE catalog, can preview a
        certified PI-5F patch plan, and can persist one Partner-owned canonical
        patch draft. It does not publish, upload Assets, or mutate live Products,
        Variants, Collections, Partner availability, or Scenes.
      </p>
      <p className="text-sm text-slate-400">
        Commercial Partner status does not control Portal login. Inactive Products
        and Variants remain visible here even when shopping hides them.
      </p>
    </main>
  );
}
