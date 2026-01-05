// components/JobsHistory.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

type Job = {
  id: string;
  style_id: string | null;
  staged_image_url: string;
  created_at: string;
  room_name: string | null;
  property_id: string | null; // ✅ prevents cross-property room collisions
};

type RoomRow = {
  id: string;
  name: string;
  property_id: string;
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

  // ✅ mounted guard for portal (prevents SSR/hydration issues)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ✅ Lightbox state (restored)
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxRoomKey, setLightboxRoomKey] = useState<string | null>(null);
  const [lightboxJobId, setLightboxJobId] = useState<string | null>(null);

  // ✅ Move modal state
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveJobId, setMoveJobId] = useState<string | null>(null);
  const [movePropertyId, setMovePropertyId] = useState<string | null>(null);
  const [moveFromRoomName, setMoveFromRoomName] = useState<string | null>(null);
  const [roomsForMove, setRoomsForMove] = useState<RoomRow[]>([]);
  const [moveTargetRoomName, setMoveTargetRoomName] = useState<string>("");
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

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
          .select(
            "id, style_id, staged_image_url, created_at, room_name, property_id"
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: sortOrder === "asc" })
          .limit(12);

        if (error) {
          console.error("[JobsHistory] error loading jobs:", error);
          setJobs([]);
          return;
        }

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
  }, [user, refreshToken, sortOrder]);

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
      const { error } = await supabase
        .from("jobs")
        .delete()
        .eq("id", jobId)
        .eq("user_id", user?.id ?? "");

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

  // ✅ INTERNAL key (collision-safe)
  const roomKeyForJob = (job: Job) => {
    const room = job.room_name?.trim() || "Unlabeled room";
    const prop = job.property_id || "no-property";
    return `${prop}::${room}`;
  };

  // ✅ USER-FACING label
  const roomLabelForJob = (job: Job) =>
    job.room_name?.trim() || "Unlabeled room";

  // Grouping helpers (used by lightbox navigation)
  const jobsByRoomKey = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) {
      const k = roomKeyForJob(j);
      const arr = map.get(k) ?? [];
      arr.push(j);
      map.set(k, arr);
    }
    return map;
  }, [jobs]);

  // --------- LIGHTBOX (restored) ---------

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

  const lightboxRoomJobs = useMemo(() => {
    if (!lightboxOpen || !lightboxRoomKey) return [];
    return jobsByRoomKey.get(lightboxRoomKey) ?? [];
  }, [jobsByRoomKey, lightboxOpen, lightboxRoomKey]);

  const lightboxIndex = useMemo(() => {
    if (!lightboxOpen || !lightboxJobId) return -1;
    return lightboxRoomJobs.findIndex((j) => j.id === lightboxJobId);
  }, [lightboxOpen, lightboxJobId, lightboxRoomJobs]);

  const lightboxJob =
    lightboxIndex >= 0 && lightboxIndex < lightboxRoomJobs.length
      ? lightboxRoomJobs[lightboxIndex]
      : null;

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

  // --------- MOVE IMAGE (job) BETWEEN ROOMS (same property) ---------

  const openMoveModal = async (job: Job) => {
    if (!user) return;

    if (!job.property_id) {
      alert(
        "This image is not associated with a property, so it can't be moved between rooms."
      );
      return;
    }

    setMoveError(null);
    setMoveOpen(true);
    setMoveJobId(job.id);
    setMovePropertyId(job.property_id);
    setMoveFromRoomName(job.room_name?.trim() || null);
    setRoomsForMove([]);
    setMoveTargetRoomName("");

    setMoveLoading(true);
    try {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, name, property_id")
        .eq("user_id", user.id)
        .eq("property_id", job.property_id)
        .order("name", { ascending: true });

      if (error) {
        console.error("[JobsHistory] load rooms for move error:", error);
        setMoveError("Could not load rooms for this property.");
        return;
      }

      const rows = (data ?? []) as RoomRow[];
      setRoomsForMove(rows);

      // Default target: first room that isn't the current label (if any)
      const currentLabel = (job.room_name ?? "").trim();
      const firstDifferent = rows.find(
        (r) => r.name.trim().toLowerCase() !== currentLabel.toLowerCase()
      );
      if (firstDifferent) setMoveTargetRoomName(firstDifferent.name);
      else if (rows[0]) setMoveTargetRoomName(rows[0].name);
    } catch (err) {
      console.error("[JobsHistory] unexpected rooms load error:", err);
      setMoveError("Unexpected error loading rooms.");
    } finally {
      setMoveLoading(false);
    }
  };

  const closeMoveModal = () => {
    if (moveLoading) return;
    setMoveOpen(false);
    setMoveJobId(null);
    setMovePropertyId(null);
    setMoveFromRoomName(null);
    setRoomsForMove([]);
    setMoveTargetRoomName("");
    setMoveError(null);
  };

  const confirmMove = async () => {
    if (!user) return;
    if (!moveJobId || !movePropertyId) return;

    const target = moveTargetRoomName.trim();
    if (!target) {
      setMoveError("Please select a destination room.");
      return;
    }

    // MVP rule: move only within SAME property.
    // We enforce this by scoping the update to property_id too.
    setMoveLoading(true);
    setMoveError(null);

    try {
      // Optional UX: if moving to same name, no-op
      const current = (moveFromRoomName ?? "").trim();
      if (current && current.toLowerCase() === target.toLowerCase()) {
        closeMoveModal();
        return;
      }

      const { error } = await supabase
        .from("jobs")
        .update({ room_name: target })
        .eq("id", moveJobId)
        .eq("user_id", user.id)
        .eq("property_id", movePropertyId);

      if (error) {
        console.error("[JobsHistory] move job update error:", error);
        setMoveError("Could not move this image. Please try again.");
        return;
      }

      // Update local state (instant UI)
      setJobs((prev) =>
        prev.map((j) => (j.id === moveJobId ? { ...j, room_name: target } : j))
      );

      closeMoveModal();
    } catch (err) {
      console.error("[JobsHistory] unexpected move error:", err);
      setMoveError("Unexpected error moving this image.");
    } finally {
      setMoveLoading(false);
    }
  };

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
          const createdLabel = new Date(job.created_at).toLocaleString();
          const isDeleting = deletingId === job.id;
          const styleLabel = job.style_id || "Staged room";
          const roomLabel = roomLabelForJob(job);
          const canUseAsNewInput = Boolean(
            onUseAsNewInput && job.staged_image_url
          );

          return (
            <article
              key={job.id}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-[0_0_0_1px_rgba(15,23,42,0.6)] hover:shadow-[0_18px_40px_rgba(15,23,42,0.8)] hover:border-emerald-500/40 transition-transform transition-shadow duration-200 hover:-translate-y-[2px]"
            >
              {/* ✅ Clickable image opens lightbox */}
              <button
                type="button"
                onClick={() => openLightboxForJob(job)}
                className="relative w-full h-40 bg-slate-950 text-left"
                aria-label="Open preview"
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
                <span className="text-[11px] text-slate-400 truncate">
                  {createdLabel}
                </span>

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
                        openMoveModal(job);
                      }}
                      className="text-[11px] rounded-lg border border-slate-700 px-2 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition w-full text-center"
                      title={
                        job.property_id
                          ? "Move this image to a different room (same property)"
                          : "No property assigned"
                      }
                    >
                      Move
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
            Showing your latest 12 staged rooms. View, download, move, or reuse
            them as fresh starting points.
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

      {/* ✅ LIGHTBOX (PORTAL) */}
      {mounted &&
        lightboxOpen &&
        lightboxJob &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
            {/* backdrop */}
            <div className="absolute inset-0" onClick={closeLightbox} />

            {/* modal */}
            <div className="relative z-50 max-w-5xl w-full mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden">
              {/* header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    Staged room
                  </span>
                  <span className="text-sm text-slate-100 truncate">
                    {roomLabelForJob(lightboxJob)}
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
                    onClick={closeLightbox}
                    className="text-[11px] rounded-lg border border-slate-700 px-3 py-1.5 hover:border-slate-500 hover:text-slate-100 transition"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* body */}
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

                {/* Left/right arrows (per room) */}
                {lightboxRoomJobs.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={goPrevInLightbox}
                      className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-2 text-slate-200 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                      aria-label="Previous image"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={goNextInLightbox}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-2 text-slate-200 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                      aria-label="Next image"
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
          </div>,
          document.body
        )}

      {/* MOVE MODAL */}
      {moveOpen && (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/70">
          <div className="absolute inset-0" onClick={closeMoveModal} />

          <div className="relative z-50 w-full max-w-lg mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  Move image
                </span>
                <span className="text-sm text-slate-100">
                  Choose a destination room
                </span>
              </div>
              <button
                type="button"
                onClick={closeMoveModal}
                disabled={moveLoading}
                className="text-[11px] rounded-lg border border-slate-700 px-3 py-1.5 hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-3 text-xs space-y-3">
              <div className="text-[11px] text-slate-400">
                This move is restricted to the{" "}
                <span className="text-slate-200">same property</span>. Only this
                image will move (descendants stay put).
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">
                  Destination room
                </label>

                {moveLoading ? (
                  <div className="text-[11px] text-slate-500 py-2">
                    Loading rooms…
                  </div>
                ) : roomsForMove.length === 0 ? (
                  <div className="text-[11px] text-slate-500 py-2">
                    No rooms found for this property.
                  </div>
                ) : (
                  <select
                    value={moveTargetRoomName}
                    onChange={(e) => setMoveTargetRoomName(e.target.value)}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                  >
                    {roomsForMove.map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}

                {moveFromRoomName && (
                  <div className="text-[10px] text-slate-500 mt-1">
                    Current:{" "}
                    <span className="text-slate-300">{moveFromRoomName}</span>
                  </div>
                )}
              </div>

              {moveError && (
                <div className="text-[11px] text-rose-300">{moveError}</div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeMoveModal}
                disabled={moveLoading}
                className="text-[11px] rounded-lg border border-slate-700 px-3 py-1.5 hover:border-slate-500 transition disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmMove}
                disabled={
                  moveLoading ||
                  !moveJobId ||
                  !movePropertyId ||
                  roomsForMove.length === 0 ||
                  !moveTargetRoomName.trim()
                }
                className="text-[11px] rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-3 py-1.5 font-medium transition"
              >
                {moveLoading ? "Moving…" : "Move image"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
