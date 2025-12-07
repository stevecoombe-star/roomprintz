// components/ResultPanel.tsx
"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { RoomStyleId, ROOM_STYLES } from "@/components/StyleSelector";

type ResultPanelProps = {
  uploadedPreview: string | null;
  resultUrl: string | null;
  selectedStyle: RoomStyleId | null;
  isGenerating: boolean;
  onDownload?: (url: string | null) => void | Promise<void>;
  onUseAsNewInput?: (url: string | null) => void | Promise<void>;
};

type ViewMode = "before" | "after";

export function ResultPanel({
  uploadedPreview,
  resultUrl,
  selectedStyle,
  isGenerating,
  onDownload,
  onUseAsNewInput,
}: ResultPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("before");

  // NEW: zoom modal state
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [zoomView, setZoomView] = useState<ViewMode>("after");

  // Try to find the style meta; even if we don't use .label, this keeps it future-proof
  const styleMeta = ROOM_STYLES.find((s) => s.id === selectedStyle) || null;

  // Whenever a new result arrives, default to AFTER view
  useEffect(() => {
    if (resultUrl) {
      setViewMode("after");
      setZoomView("after");
    } else {
      setViewMode("before");
      setZoomView("before");
    }
  }, [resultUrl]);

  const hasBefore = Boolean(uploadedPreview);
  const hasAfter = Boolean(resultUrl);

  // Decide which image to show based on viewMode and availability
  let activeSrc: string | null = null;
  let activeLabel = "";

  if (viewMode === "after" && hasAfter) {
    activeSrc = resultUrl!;
    activeLabel = "Staged result";
  } else if (hasBefore) {
    activeSrc = uploadedPreview!;
    activeLabel = "Original room";
  }

  // Simple helper to display style: use id or fall back gracefully
  const styleLabel =
    selectedStyle ??
    (styleMeta ? (styleMeta as any).id : null); // very safe fallback

  const canDownload = Boolean(activeSrc && onDownload);
  const canUseAsNewInput =
    Boolean(resultUrl && onUseAsNewInput) && viewMode === "after";

  // Close zoom modal on Esc
  useEffect(() => {
    if (!isZoomOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsZoomOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isZoomOpen]);

  const openZoom = () => {
    if (!activeSrc) return;
    setZoomView(viewMode); // start zoom on whichever view is active
    setIsZoomOpen(true);
  };

  const showZoomToggle = hasBefore && hasAfter;

  return (
    <>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 min-h-[260px]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold tracking-tight">Result</h2>
            <p className="text-[11px] text-slate-400">
              Compare the original room with the staged version.
            </p>
          </div>

          {styleLabel && (
            <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/5 px-2 py-[2px] text-[10px] font-medium text-emerald-200">
              {styleLabel}
            </span>
          )}
        </div>

        {/* Before/After toggle + actions */}
        <div className="flex items-center justify-between mt-1 gap-2">
          <div className="inline-flex rounded-full bg-slate-950 border border-slate-800 p-[2px] text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode("before")}
              disabled={!hasBefore}
              className={`px-3 py-[3px] rounded-full transition ${
                viewMode === "before"
                  ? "bg-slate-800 text-slate-50"
                  : "text-slate-400 hover:text-slate-100"
              } ${!hasBefore ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              Before
            </button>
            <button
              type="button"
              onClick={() => setViewMode("after")}
              disabled={!hasAfter}
              className={`px-3 py-[3px] rounded-full transition ${
                viewMode === "after"
                  ? "bg-slate-800 text-slate-50"
                  : "text-slate-400 hover:text-slate-100"
              } ${!hasAfter ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              After
            </button>
          </div>

          <div className="flex items-center gap-2">
            {canUseAsNewInput && resultUrl && (
              <button
                type="button"
                onClick={() => onUseAsNewInput?.(resultUrl)}
                className="text-[11px] rounded-lg border border-emerald-500/70 px-2 py-1 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-400 transition"
              >
                Continue from this image
              </button>
            )}

            {canDownload && activeSrc && (
              <button
                type="button"
                onClick={() => onDownload?.(activeSrc)}
                className="text-[11px] rounded-lg border border-slate-700 px-2 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
              >
                Download
              </button>
            )}
          </div>
        </div>

        {/* Image area */}
        <div className="mt-2 relative w-full aspect-[4/3] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex items-center justify-center">
          {isGenerating ? (
            <div className="text-xs text-slate-400 animate-pulse">
              Generating staged room…
            </div>
          ) : activeSrc ? (
            <button
              type="button"
              onClick={openZoom}
              className="group relative w-full h-full text-left"
            >
              <Image
                src={activeSrc}
                alt={activeLabel}
                fill
                sizes="(min-width: 1024px) 320px, 100vw"
                className="object-cover"
              />
              <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-[2px] text-[10px] text-slate-100">
                {activeLabel} • Click to zoom
              </div>
              {hasBefore && hasAfter && (
                <div className="absolute bottom-2 right-2 text-[10px] text-emerald-300 opacity-80 group-hover:opacity-100">
                  Before / After available
                </div>
              )}
            </button>
          ) : (
            <div className="text-[11px] text-slate-500 px-4 text-center">
              Upload a room and generate a staged result to preview it here.
            </div>
          )}
        </div>
      </div>

      {/* ZOOM MODAL */}
      {isZoomOpen && (uploadedPreview || resultUrl) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          {/* backdrop */}
          <div
            className="absolute inset-0"
            onClick={() => setIsZoomOpen(false)}
          />

          {/* modal shell */}
          <div className="relative z-10 max-w-5xl w-full mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Staged room preview
                </span>
                <span className="text-sm text-slate-100 truncate">
                  {zoomView === "after" ? "After" : "Before"}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Before/After toggle inside modal (only if both exist) */}
                {showZoomToggle && (
                  <div className="inline-flex rounded-full border border-slate-700 bg-slate-900 overflow-hidden text-[11px]">
                    <button
                      type="button"
                      onClick={() => setZoomView("before")}
                      className={
                        "px-3 py-1 border-r border-slate-700 transition " +
                        (zoomView === "before"
                          ? "bg-emerald-500/15 text-emerald-200"
                          : "text-slate-400 hover:text-slate-100")
                      }
                    >
                      Before
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomView("after")}
                      className={
                        "px-3 py-1 transition " +
                        (zoomView === "after"
                          ? "bg-emerald-500/15 text-emerald-200"
                          : "text-slate-400 hover:text-slate-100")
                      }
                    >
                      After
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setIsZoomOpen(false)}
                  className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-slate-500 hover:text-slate-100 transition"
                >
                  Close
                </button>
              </div>
            </div>

            {/* body with fixed max height */}
            <div className="p-4 flex-1 flex items-center justify-center bg-slate-950">
              <div className="max-h-[80vh] w-full flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    zoomView === "after"
                      ? resultUrl || uploadedPreview || ""
                      : uploadedPreview || resultUrl || ""
                  }
                  alt={zoomView === "after" ? "After" : "Before"}
                  className="max-h-[75vh] max-w-full object-contain rounded-xl border border-slate-800 bg-black"
                />
              </div>
            </div>

            {/* footer */}
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
              <span>
                View:{" "}
                <span className="text-slate-300">
                  {zoomView === "after"
                    ? "After (staged result)"
                    : "Before (original room)"}
                </span>
              </span>
              <span>Press Esc or click outside to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
