import { Suspense } from "react";
import { MyFurniturePageClient } from "@/components/my-furniture/MyFurniturePageClient";

export default function MyFurnitureRoutePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-950 text-slate-100">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
              Loading My Furniture...
            </div>
          </div>
        </main>
      }
    >
      <MyFurniturePageClient />
    </Suspense>
  );
}
