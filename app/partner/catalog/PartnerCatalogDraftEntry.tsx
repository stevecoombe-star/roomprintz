"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PartnerCatalogDraftEntry(props: Readonly<{
  openDraftId: string | null;
  openRevision: number | null;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDraft() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/vibode/partner/drafts", { method: "POST" });
      const body = await response.json() as { error?: string; draft?: { draftId: string } };
      if (!response.ok || !body.draft?.draftId) {
        setError(body.error ?? "Catalog draft could not be opened.");
        return;
      }
      router.push(`/partner/catalog/drafts/${body.draft.draftId}`);
    } catch {
      setError("Catalog draft could not be opened.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 p-4">
      <h3 className="font-medium">Catalog draft</h3>
      <p className="mt-1 text-xs text-slate-500">
        Edit a Partner-owned patch draft. Changes stay in the draft until a later publish
        slice. Live Products, Variants, Collections, Assets, and Scenes are not mutated.
      </p>
      {props.openDraftId ? (
        <p className="mt-2 text-xs text-amber-200">
          Open draft revision {props.openRevision ?? "—"} is waiting. Resume to keep editing.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {props.openDraftId ? (
          <a
            href={`/partner/catalog/drafts/${props.openDraftId}`}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs"
          >
            Resume draft
          </a>
        ) : (
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs"
            onClick={() => void openDraft()}
          >
            {pending ? "Opening…" : "Edit catalog"}
          </button>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </section>
  );
}
