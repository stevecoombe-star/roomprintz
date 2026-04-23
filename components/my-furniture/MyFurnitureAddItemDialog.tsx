"use client";

import { useEffect, useMemo, useState, type ClipboardEvent } from "react";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

type AddItemMode = "image" | "url";

type MyFurnitureAddItemDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
};

type SaveResponse = {
  error?: string;
};

type IngestResponse = {
  error?: string;
  detail?: string;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractImageUrlFromClipboardHtml(html: string): string | null {
  const source = asOptionalString(html);
  if (!source) return null;
  const imgMatch = source.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i);
  if (!imgMatch?.[1]) return null;
  return asHttpUrl(imgMatch[1]);
}

function makeUserSkuId() {
  try {
    return `manual-${crypto.randomUUID()}`;
  } catch {
    return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      if (typeof reader.result !== "string" || reader.result.length === 0) {
        reject(new Error("Could not read image file."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function MyFurnitureAddItemDialog({
  isOpen,
  onClose,
  onSubmitted,
}: MyFurnitureAddItemDialogProps) {
  const [mode, setMode] = useState<AddItemMode>("image");
  const [productUrl, setProductUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedImageDataUrl, setPastedImageDataUrl] = useState<string | null>(null);
  const [urlPastedImageUrl, setUrlPastedImageUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode("image");
    setProductUrl("");
    setSelectedFile(null);
    setPastedImageDataUrl(null);
    setUrlPastedImageUrl(null);
    setIsSubmitting(false);
    setSubmitError(null);
  }, [isOpen]);

  const previewUrl = useMemo(() => {
    if (pastedImageDataUrl) return pastedImageDataUrl;
    if (!selectedFile) return null;
    return URL.createObjectURL(selectedFile);
  }, [pastedImageDataUrl, selectedFile]);

  useEffect(() => {
    if (!previewUrl || !selectedFile || pastedImageDataUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [pastedImageDataUrl, previewUrl, selectedFile]);

  if (!isOpen) return null;

  async function submitProductUrl() {
    const nextProductUrl = asOptionalString(productUrl);
    if (!nextProductUrl) {
      throw new Error("Enter a product link to add an item.");
    }

    const accessToken = await getSupabaseBrowserAccessToken();
    if (!accessToken) {
      throw new Error("Please sign in to add an item.");
    }

    const clientPreviewImageUrl = asHttpUrl(urlPastedImageUrl);
    const clientPreviewImageDataUrl =
      pastedImageDataUrl || (selectedFile ? await fileToDataUrl(selectedFile) : null);
    console.info(
      "[my-furniture/add-item] product_url_submit_image_candidates",
      JSON.stringify({
        has_client_preview_image_url: Boolean(clientPreviewImageUrl),
        has_client_preview_image_data: Boolean(clientPreviewImageDataUrl),
      })
    );

    const response = await fetch("/api/vibode/my-furniture/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        userSkuId: makeUserSkuId(),
        sourceUrl: nextProductUrl,
        sourceType: "product_url",
        previewImageUrl: clientPreviewImageUrl,
        clientPreviewImageDataUrl,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as SaveResponse;
    if (!response.ok) {
      throw new Error(payload.error || `Failed to save item (HTTP ${response.status}).`);
    }
  }

  async function submitImage() {
    const accessToken = await getSupabaseBrowserAccessToken();
    if (!accessToken) {
      throw new Error("Please sign in to add an item.");
    }

    const imageBase64 =
      pastedImageDataUrl || (selectedFile ? await fileToDataUrl(selectedFile) : null);
    if (!imageBase64) {
      throw new Error("Upload or paste an image first.");
    }

    const sourceHint = pastedImageDataUrl ? "pasted_image" : "uploaded_image";
    const response = await fetch("/api/vibode/user-skus/ingest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-roomprintz-ingest-source": sourceHint,
      },
      body: JSON.stringify({
        imageBase64,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as IngestResponse;
    if (!response.ok) {
      const detail = asOptionalString(payload.detail);
      throw new Error(
        payload.error || detail || `Failed to ingest image item (HTTP ${response.status}).`
      );
    }
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === "url") {
        await submitProductUrl();
      } else {
        await submitImage();
      }
      await onSubmitted();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not add item right now.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const clipboardItems = Array.from(event.clipboardData.items || []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    const dataUrl = await fileToDataUrl(file).catch(() => null);
    if (!dataUrl) return;
    setPastedImageDataUrl(dataUrl);
    setSelectedFile(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Add Item"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Add Item</h2>
            <p className="mt-1 text-xs text-slate-400">
              Add from an image or a product link.
            </p>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("image")}
            className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
              mode === "image"
                ? "border-slate-200 bg-slate-100 text-slate-900"
                : "border-slate-700 bg-slate-900/50 text-slate-200 hover:border-slate-500"
            }`}
          >
            Upload or Paste Image
          </button>
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
              mode === "url"
                ? "border-slate-200 bg-slate-100 text-slate-900"
                : "border-slate-700 bg-slate-900/50 text-slate-200 hover:border-slate-500"
            }`}
          >
            Paste Product Link
          </button>
        </div>

        {mode === "image" ? (
          <div
            key="add-item-image-mode"
            className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3"
          >
            <input
              type="file"
              accept="image/*"
              disabled={isSubmitting}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
                setPastedImageDataUrl(null);
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-slate-900"
            />
            <textarea
              rows={3}
              disabled={isSubmitting}
              onPaste={(event) => void handlePasteImage(event)}
              placeholder="Or paste an image here (Cmd/Ctrl+V)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-slate-500"
            />
            {previewUrl ? (
              <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
                <img src={previewUrl} alt="New item preview" className="max-h-48 w-full object-contain" />
              </div>
            ) : null}
          </div>
        ) : (
          <div
            key="add-item-url-mode"
            className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3"
          >
            <input
              value={productUrl ?? ""}
              onChange={(event) => setProductUrl(event.target.value)}
              onPaste={(event) => {
                const clipboardHtml = asOptionalString(event.clipboardData.getData("text/html"));
                const candidate = extractImageUrlFromClipboardHtml(clipboardHtml ?? "");
                setUrlPastedImageUrl(candidate);
              }}
              disabled={isSubmitting}
              placeholder="https://..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-slate-500"
            />
          </div>
        )}

        {submitError ? <p className="mt-3 text-xs text-rose-300">{submitError}</p> : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
          >
            {isSubmitting ? "Adding..." : "Add Item"}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
