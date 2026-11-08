"use client";

import { useEffect, useState } from "react";

import {
  candidatePreviewVisible,
  requestCandidatePreview,
} from "@/lib/vibode-furniture/generator/candidate-preview";
import type { GlbPreviewRequest } from "@/lib/vibode-furniture/generator/preview";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const FIELD =
  "mt-1 w-full min-w-0 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-500 disabled:cursor-not-allowed disabled:text-neutral-600";

export function CandidatePreviewEntry({
  onOpenPreview,
}: {
  onOpenPreview: (request: GlbPreviewRequest) => void;
}) {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/auth/admin-access", { method: "POST" });
        const payload = await response.json().catch(() => null) as { isAdmin?: unknown } | null;
        if (!cancelled) setAdmin(payload?.isAdmin === true);
      } catch {
        if (!cancelled) setAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!candidatePreviewVisible(admin)) return null;

  async function openOwnedCandidate() {
    setPending(true);
    setMessage(null);
    try {
      const token = await readOwnerAccessToken();
      if (!token) {
        setMessage("Sign in again to preview this model.");
        return;
      }
      const result = await requestCandidatePreview({ jobId, token });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      onOpenPreview({
        kind: "candidate",
        label: "Generated model",
        url: result.previewUrl,
        jobId: jobId.trim(),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="mt-3 border-t border-neutral-900 pt-3"
      data-candidate-preview="job"
      onSubmit={(event) => {
        event.preventDefault();
        void openOwnedCandidate();
      }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
        Preview a generated model
      </div>
      <p className="mt-1 text-[11px] leading-5 text-neutral-500">
        Opens a private model you own. It does not save the model, change it, or start a new generation.
      </p>
      <label className="mt-2 block text-[11px] text-neutral-400">
        Job ID
        <input
          value={jobId}
          onChange={(event) => setJobId(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          className={FIELD}
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className={`mt-2 rounded-md border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-200 disabled:cursor-not-allowed disabled:text-neutral-600 ${FOCUS}`}
      >
        {pending ? "Opening…" : "Preview"}
      </button>
      {message ? (
        <p role="alert" className="mt-2 text-[11px] leading-5 text-amber-200">{message}</p>
      ) : null}
    </form>
  );
}

async function readOwnerAccessToken(): Promise<string | null> {
  const browser = await import("@/src/lib/supabaseBrowser");
  return browser.getSupabaseBrowserAccessToken();
}
