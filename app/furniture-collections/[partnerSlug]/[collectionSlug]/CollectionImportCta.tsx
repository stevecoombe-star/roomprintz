"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CollectionImportCtaProps = {
  partnerSlug: string;
  collectionSlug: string;
};

type ImportResponse = {
  ok?: boolean;
  redirectTo?: string;
  error?: string;
};

export default function CollectionImportCta({
  partnerSlug,
  collectionSlug,
}: CollectionImportCtaProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/vibode/furniture-collections/${encodeURIComponent(
          partnerSlug
        )}/${encodeURIComponent(collectionSlug)}/import`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const payload = (await response.json().catch(() => ({}))) as ImportResponse;
      if (!response.ok || payload.ok !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't open this Furniture Collection in Vibode right now."
        );
      }
      router.push(typeof payload.redirectTo === "string" ? payload.redirectTo : "/");
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "We couldn't open this Furniture Collection in Vibode right now."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
      >
        {isSubmitting ? "Opening Vibode..." : "Try these in your room"}
      </button>
      {errorMessage ? <p className="text-xs text-rose-200">{errorMessage}</p> : null}
    </div>
  );
}
