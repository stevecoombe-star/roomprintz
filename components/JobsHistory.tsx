// components/JobsHistory.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

type Job = {
  id: string;
  style_id: string | null;
  staged_image_url: string; // we filter out blanks below
  created_at: string;
  room_name: string | null;
};

type JobsHistoryProps = {
  refreshToken: number;
  onUseAsNewInput?: (url: string | null) => void | Promise<void>;
};

type SortOrder = "desc" | "asc";

// Shared helper: robust cross-origin download using Blob
async function downloadJobImage(
  url: string | null | undefined,
  fileName?: string
) {
  if (!url || url.trim().length === 0) {
    console.warn("[JobsHistory] No URL provided for download.");
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(
        "[JobsHistory] download fetch error:",
        response.status,
        response.statusText
      );
      alert("Sorry, we couldn't download this image. Please try again.");
      return;
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName || "roomprintz-image.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error("[JobsHistory] download error:", err);
    alert("Sorry, something went wrong downloading this image.");
  }
}

export function JobsHistory({ refreshToken, onUseAsNewInput }: JobsHistoryProps) {
  const { user, loading: authLoading } = useSupabaseUser();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxRoomKey, setLightboxRoomKey] = useState<string | null>(null);
  const [lightboxJobId, setLightboxJobId] = useState<string | null>(null);

  // --------- LOAD JOBS ---------

  useEffect(() => {
    const loadJobs = async () => {
      if (!user) {
        setJobs([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("jobs")
          .select("id, style_id, staged_image_url, created_at, room_name")
          .eq("user_id", user.id)
          .order("created_at", { ascending: sortOrder === "asc" })
          .limit(12); // ✅ cap history at 12 latest jobs

        if (error) {
          console.error("[JobsHistory] error loading jobs:", error);
          setJobs([]);
          return;
        }

        // Filter out blank-room jobs / rows with no staged_image_url
        const cleaned =
          (data ?? []).filter(
            (job) =>
              job.staged_image_url &&
              job.staged_image_url.trim().length > 0
          ) as Job[];

        setJobs(cleaned);
      } catch (err) {
        console.error("[JobsHistory] unexpected error:", err);
        setJobs([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadJobs();
  }, [user?.id, refreshToken, sortOrder]);

  // --------- HELPERS ---------

  const handleDownload = async (job: Job) => {
    await downloadJobImage(job.staged_image_url, `roomprintz-${job.id}.png`);
  };

  const handleDelete = async (jobId: string) => {
    const confirmDelete = window.confirm(
      "Delete this staged room from your history? This cannot be undone."
    );
    if (!confirmDelete) return;

    setDeletingId(jobId);
    try {
      const { error } = await supabase.from("jobs").delete().eq("id", jobId);

      if (error) {
        console.error("[JobsHistory] delete error:", error);
        alert("Could not delete this job. Check console for details.");
        return;
      }

      setJobs((prev) => prev.filter((job) => job.id !== jobId));

      // If this was open in the lightbox, close it
      if (lightboxJobId === jobId) {
        setLightboxOpen(false);
        setLightboxJobId(null);
        setLightboxRoomKey(null);
      }
    } catch (err) {
      console.error("[JobsHistory] unexpected delete error:", err);
      alert("Unexpected error deleting this job.");
    } finally {
      setDeletingId(null);
    }
  };

  const roomKeyForJob = (job: Job) =>
    job.room_name?.trim() || "Unlabeled room";

  // Lightbox subset: only jobs from the same room
  const lightboxRoomJobs = useMemo(() => {
    if (!lightboxOpen || !lightboxRoomKey) return [];
    return jobs.filter((job) => roomKeyForJob(job) === lightboxRoomKey);
  }, [jobs, lightboxOpen, lightboxRoomKey]);

  const lightboxIndex = useMemo(() => {
    if (!lightboxOpen || !lightboxJobId) return -1;
    return lightboxRoomJobs.findIndex((job) => job.id === lightboxJobId);
  }, [lightboxOpen, lightboxJobId, lightboxRoomJobs]);

  const lightboxJob =
    lightboxIndex >= 0 && lightboxIndex < lightboxRoomJobs.length
      ? lightboxRoomJobs[lightboxIndex]
      : null;

  const openLightboxForJob = (job: Job) => {
    const key = roomKeyForJob(job);
    setLightboxRoomKey(key);
    setLightboxJobId(job.id);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setLightboxRoomKey(null);
    setLightboxJobId(null);
  };

  const goNextInLightbox = () => {
    if (!lightboxRoomJobs.length || lightboxIndex < 0) return;
    const nextIndex = (lightboxIndex + 1) % lightboxRoomJobs.length;
    setLightboxJobId(lightboxRoomJobs[nextIndex].id);
  };

  const goPrevInLightbox = () => {
    if (!lightboxRoomJobs.length || lightboxIndex < 0) return;
    const prevIndex =
      (lightboxIndex - 1 + lightboxRoomJobs.length) % lightboxRoomJobs.length;
    setLightboxJobId(lightboxRoomJobs[prevIndex].id);
  };

  // Keyboard navigation for lightbox: ← / → / Esc
  useEffect(() => {
    if (!lightboxOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextInLightbox();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevInLightbox();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen, lightboxIndex, lightboxRoomJobs.length]);

  // --------- MAIN CONTENT ---------

  const renderContent = () => {
    if (authLoading) {
      return (
        <div className="text-xs text-slate-400 py-6">
          Checking your session…
        </div>
      );
    }

    if (!user) {
      return (
        <div className="text-xs text-slate-500 py-6">
          Log in above to see your staging history.
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="text-xs text-slate-400 py-6">
          Loading your recent staged rooms…
        </div>
      );
    }

    if (jobs.length === 0) {
      return (
        <div className="text-xs text-slate-500 py-6">
          No history yet. Generate a staged room to see it appear here.
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-2">
        {jobs.map((job) => {
          const createdDate = new Date(job.created_at);
          const createdLabel = createdDate.toLocaleString();
          const isDeleting = deletingId === job.id;
          const styleLabel = job.style_id || "Staged room";
          const roomLabel = roomKeyForJob(job);
          const canUseAsNewInput = Boolean(
            onUseAsNewInput && job.staged_image_url
          );

          return (
            <article
              key={job.id}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-[0_0_0_1px_rgba(15,23,42,0.6)] hover:shadow-[0_18px_40px_rgba(15,23,42,0.8)] hover:border-emerald-500/40 transition-transform transition-shadow duration-200 hover:-translate-y-[2px]"
            >
              <button
                type="button"
                onClick={() => openLightboxForJob(job)}
                className="relative w-full h-40 bg-slate-950 text-left"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={job.staged_image_url}
                  alt={`Staged room (${styleLabel})`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-[2px] text-[10px] text-slate-100">
                  {styleLabel}
                </div>
                <div className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-[2px] text-[9px] text-slate-200 max-w-[70%] truncate">
                  {roomLabel}
                </div>
              </button>

              <div className="px-3 py-2.5 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 truncate">
                    {createdLabel}
                  </span>
                </div>

                <div className="mt-1 flex flex-col gap-1.5">
                  {canUseAsNewInput && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUseAsNewInput?.(job.staged_image_url || null);
                      }}
                      className="text-[11px] rounded-lg border border-emerald-500/70 px-2 py-1 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-400 transition w-full text-center"
                    >
                      Continue from this image
                    </button>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(job);
                      }}
                      className="text-[11px] rounded-lg border border-slate-700 px-2 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition w-full text-center"
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(job.id);
                      }}
                      disabled={isDeleting}
                      className="text-[11px] rounded-lg border border-rose-700/80 text-rose-300 px-2 py-1 hover:border-rose-400 hover:text-rose-200 transition disabled:opacity-60 w-full text-center"
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  };

  return (
    <section className="mt-10 border-t border-slate-800 pt-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Recent staged rooms
          </h2>
          <p className="text-xs text-slate-400">
            Showing your latest 12 staged rooms. View, download, or reuse them
            as fresh starting points.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>Sort by</span>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-[3px] text-[11px] text-slate-100 outline-none focus:border-emerald-400"
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      </div>

      {renderContent()}

      {/* LIGHTBOX MODAL */}
      {lightboxOpen && lightboxJob && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70">
          {/* click-to-close backdrop */}
          <div
            className="absolute inset-0"
            onClick={closeLightbox}
          />

          {/* modal */}
          <div className="relative z-50 max-w-5xl w-full mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Staged room
                </span>
                <span className="text-sm text-slate-100 truncate">
                  {roomKeyForJob(lightboxJob)}
                </span>
                <span className="text-[11px] text-slate-400">
                  {new Date(lightboxJob.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {onUseAsNewInput && lightboxJob.staged_image_url && (
                  <button
                    type="button"
                    onClick={() =>
                      onUseAsNewInput?.(lightboxJob.staged_image_url || null)
                    }
                    className="text-[11px] rounded-lg border border-emerald-500/70 px-3 py-1.5 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-400 transition"
                  >
                    Continue from this image
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDownload(lightboxJob)}
                  className="text-[11px] rounded-lg border border-slate-700 px-3 py-1.5 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(lightboxJob.id)}
                  disabled={deletingId === lightboxJob.id}
                  className="text-[11px] rounded-lg border border-rose-700/80 text-rose-300 px-3 py-1.5 hover:border-rose-400 hover:text-rose-200 transition disabled:opacity-60"
                >
                  {deletingId === lightboxJob.id ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={closeLightbox}
                  className="text-[11px] rounded-lg border border-slate-700 px-3 py-1.5 hover:border-slate-500 hover:text-slate-100 transition"
                >
                  Close
                </button>
              </div>
            </div>

            {/* body with fixed max height */}
            <div className="relative flex-1 bg-slate-950">
              <div className="p-4 flex-1 flex items-center justify-center">
                <div className="max-h-[80vh] w-full flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lightboxJob.staged_image_url}
                    alt={lightboxJob.style_id || "Staged room"}
                    className="max-h-[75vh] max-w-full object-contain rounded-xl border border-slate-800 bg-black"
                  />
                </div>
              </div>

              {/* Left/right arrow buttons (per room) */}
              {lightboxRoomJobs.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrevInLightbox}
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-2 text-slate-200 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={goNextInLightbox}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-2 text-slate-200 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                  >
                    ›
                  </button>
                </>
              )}
            </div>

            {/* footer */}
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
              <span>
                Job ID:{" "}
                <span className="text-slate-400">{lightboxJob.id}</span>
              </span>
              {lightboxJob.style_id && (
                <span>
                  Style:{" "}
                  <span className="uppercase tracking-[0.18em] text-slate-400">
                    {lightboxJob.style_id}
                  </span>
                </span>
              )}
              <span className="hidden sm:inline">
                Tip: use ← / → to navigate, Esc to close.
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
