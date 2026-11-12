"use client";

import { useCallback, useEffect, useState } from "react";

import { FurnitureGeneratorPanel } from "@/components/stage/FurnitureGeneratorPanel";
import { FurnitureGlbPreviewModal } from "@/components/stage/FurnitureGlbPreviewModal";
import { PersonalFurniturePreview } from "@/components/stage/PersonalFurniturePreview";
import { useStageEditor } from "@/components/stage/StageEditorContext";
import {
  closedPreviewModal,
  closeGlbPreview,
  openGlbPreview,
  type GlbPreviewRequest,
} from "@/lib/vibode-furniture/generator/preview";
import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";
import type { PersonalFurnitureLibraryItem } from "@/lib/vibode-furniture/library";
import { putPersonalGlbToSignedUrl } from "@/lib/vibode-furniture/upload-client";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageMyFurniturePanel({
  placementOpen,
}: {
  placementOpen: boolean;
}) {
  const stage = useStageEditor();
  const [items, setItems] = useState<readonly PersonalFurnitureLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(closedPreviewModal);
  const [savedCandidateJobId, setSavedCandidateJobId] = useState<string | null>(null);
  const openPreview = useCallback((request: GlbPreviewRequest) => {
    setPreview((current) => openGlbPreview(current, request));
  }, []);
  const closePreview = useCallback(() => {
    setPreview((current) => closeGlbPreview(current));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getSupabaseBrowserAccessToken();
      if (!token) {
        setError("Sign in to use My Furniture.");
        setItems([]);
        return;
      }
      const response = await fetch("/api/vibode/furniture-assets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        items?: PersonalFurnitureLibraryItem[];
      } | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.items)) {
        setError(payload?.error ?? "Your furniture could not be loaded.");
        return;
      }
      setItems(payload.items);
    } catch {
      setError("Your furniture could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    if (uploading) return;
    const name = displayName.trim();
    if (!name) {
      setError("Enter a name up to 80 characters.");
      return;
    }
    if (!file) {
      setError("Choose a GLB file.");
      return;
    }
    if (file.size > PERSONAL_FURNITURE_GLB_MAX_BYTES) {
      setError("This GLB is too large. The limit is 25 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    setMessage(null);
    setProgress(0);
    try {
      const token = await getSupabaseBrowserAccessToken();
      if (!token) {
        setError("Sign in to upload furniture.");
        return;
      }
      const created = await fetch("/api/vibode/furniture-assets/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const uploadBody = await created.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        uploadId?: string;
        signedUrl?: string;
      } | null;
      if (!created.ok || !uploadBody?.ok || !uploadBody.uploadId || !uploadBody.signedUrl) {
        setError(uploadBody?.error ?? "The upload could not be started.");
        return;
      }
      await putPersonalGlbToSignedUrl(uploadBody.signedUrl, file, setProgress);
      const saved = await fetch(
        `/api/vibode/furniture-assets/uploads/${uploadBody.uploadId}/finalize`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            displayName: name,
            category: category.trim() || null,
          }),
        },
      );
      const savedBody = await saved.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!saved.ok || !savedBody?.ok) {
        setError(savedBody?.error ?? "This file isn't a supported GLB.");
        return;
      }
      setDisplayName("");
      setCategory("");
      setFile(null);
      setFileInputKey((current) => current + 1);
      setMessage("Saved to My Furniture.");
      await load();
    } catch {
      setError("The upload could not be finished.");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function archive(assetId: string) {
    setError(null);
    const token = await getSupabaseBrowserAccessToken();
    if (!token) {
      setError("Sign in to update My Furniture.");
      return;
    }
    const response = await fetch("/api/vibode/furniture-assets/archive", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assetId }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      setError(payload?.error ?? "That model could not be archived.");
      return;
    }
    setMessage("Archived. Rooms that already use it still will.");
    await load();
  }

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1" role="tablist" aria-label="My Furniture modes">
        {([
          ["library", "My Furniture"],
          ["generator", "3D Generator"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={stage.furnitureSubmode === id}
            onClick={() => stage.setFurnitureSubmode(id)}
            className={`rounded-md px-2 py-1 text-[11px] ${FOCUS} ${
              stage.furnitureSubmode === id
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={stage.furnitureSubmode === "library" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
          <form
            className="mt-3 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void upload();
            }}
          >
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Name this model"
              maxLength={80}
              aria-label="Furniture name"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
            />
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Category (optional)"
              maxLength={40}
              aria-label="Furniture category"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500"
            />
            <input
              key={fileInputKey}
              type="file"
              accept=".glb,model/gltf-binary"
              aria-label="Upload GLB"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-[11px] text-neutral-400 file:mr-2 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-900 file:px-2 file:py-1 file:text-xs file:text-neutral-200"
            />
            <button
              type="submit"
              disabled={uploading}
              className={`rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-100 ${FOCUS}`}
            >
              {uploading ? "Uploading…" : "Upload GLB"}
            </button>
            {progress != null ? (
              <div className="text-[11px] text-neutral-400" aria-live="polite">
                Upload progress {progress}%
              </div>
            ) : null}
          </form>

          {error ? <div className="mt-2 text-[11px] text-amber-200">{error}</div> : null}
          {message ? <div className="mt-2 text-[11px] text-emerald-200">{message}</div> : null}

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-8 text-center text-xs text-neutral-500">Loading your furniture…</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-xs leading-5 text-neutral-500">
                No personal models yet. Upload a GLB to place it in any of your rooms.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {items.map((item) => {
                  const key = `personal::${item.assetId}`;
                  return (
                    <article key={item.assetId} className="rounded-md border border-neutral-800 p-2">
                      <PersonalFurniturePreview url={item.previewUrl} label={item.displayName} />
                      <div className="mt-2 text-xs text-neutral-100">{item.displayName}</div>
                      <div className="mt-0.5 text-[10px] text-neutral-500">
                        {[
                          item.category,
                          `${item.authoredWidthM.toFixed(2)} × ${item.authoredDepthM.toFixed(2)} × ${item.authoredHeightM.toFixed(2)} m`,
                        ].filter(Boolean).join(" · ")}
                      </div>
                      <div className="mt-2 flex gap-1">
                        <button
                          type="button"
                          disabled={!item.previewUrl}
                          onClick={() => {
                            if (!item.previewUrl) return;
                            openPreview({
                              kind: "library",
                              url: item.previewUrl,
                              label: item.displayName,
                              assetId: item.assetId,
                            });
                          }}
                          className={`rounded-md border border-neutral-800 px-2 py-1 text-[11px] text-neutral-300 ${FOCUS}`}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          disabled={!placementOpen || stage.addPendingKey === key}
                          title={placementOpen ? undefined : "Placement is paused during inspection."}
                          onClick={() => stage.addPersonalAssetToRoom(item.assetId)}
                          className={`rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-100 ${FOCUS}`}
                        >
                          {stage.addPendingKey === key ? "Placing…" : "Place"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void archive(item.assetId)}
                          className={`rounded-md border border-neutral-800 px-2 py-1 text-[11px] text-neutral-400 ${FOCUS}`}
                        >
                          Archive
                        </button>
                      </div>
                      {stage.addErrorKey === key && stage.addError ? (
                        <div className="mt-1 text-[11px] text-amber-200">{stage.addError}</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
      </div>
      <div className={stage.furnitureSubmode === "generator" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
        <FurnitureGeneratorPanel onOpenPreview={openPreview} retiredJobId={savedCandidateJobId} />
      </div>
      <FurnitureGlbPreviewModal
        state={preview}
        onClose={closePreview}
        onCandidateLibraryChanged={() => {
          void load();
        }}
        onCandidateSaved={(saved) => {
          if (preview.open && preview.request.kind === "candidate") {
            setSavedCandidateJobId(preview.request.jobId);
          }
          setError(null);
          setMessage(saved.idempotent
            ? `${saved.displayName} is already in My Furniture.`
            : `${saved.displayName} was saved to My Furniture.`);
          stage.setFurnitureSubmode("library");
          closePreview();
          void load();
        }}
      />
    </div>
  );
}
