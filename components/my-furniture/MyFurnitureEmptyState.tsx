import Link from "next/link";

export function MyFurnitureEmptyState() {
  return (
    <section className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
      <h2 className="text-lg font-medium text-slate-100">No furniture saved yet</h2>
      <p className="mt-2 text-sm text-slate-400">
        Paste a product into your room and it will appear here.
      </p>
      <Link
        href="/editor"
        className="mt-5 inline-flex rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
      >
        Go to Editor
      </Link>
    </section>
  );
}
