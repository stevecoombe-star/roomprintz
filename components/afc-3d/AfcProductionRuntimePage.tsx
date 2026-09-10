"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AfcProductionRoomViewer } from "@/components/afc-3d/AfcProductionRoomViewer";
import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RuntimeResponse = Readonly<{
  status?: unknown;
  generationId?: unknown;
  currentGenerationId?: unknown;
  authority?: unknown;
  failureReason?: unknown;
  originalImageUrl?: unknown;
  error?: unknown;
}>;

function parseRoomId(value: string | null): string | null {
  if (!value) return null;
  const roomId = value.trim();
  return UUID.test(roomId) ? roomId : null;
}

function AfcProductionRuntimePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = parseRoomId(
    searchParams.get("roomId") ?? searchParams.get("vibodeRoomId"),
  );
  const { user, loading: authLoading } = useSupabaseUser();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authority, setAuthority] = useState<AfcV2ProductionRoomAuthority | null>(
    null,
  );
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const next = roomId
        ? `/editor/afc-3d?roomId=${encodeURIComponent(roomId)}`
        : "/editor/afc-3d";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, roomId, router, user]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!roomId || !user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          throw new Error("Your session expired. Sign in again.");
        }
        const response = await fetch(
          `/api/vibode/afc/runtime?roomId=${encodeURIComponent(roomId)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | RuntimeResponse
          | null;
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Failed to restore AFC runtime.",
          );
        }
        if (cancelled) return;
        if (payload?.status !== "ready" || !payload.authority) {
          setAuthority(null);
          setOriginalImageUrl(null);
          setGenerationId(
            typeof payload?.currentGenerationId === "string"
              ? payload.currentGenerationId
              : null,
          );
          setError(
            typeof payload?.failureReason === "string" && payload.failureReason
              ? payload.failureReason
              : "This room has no production-ready AFC generation.",
          );
          return;
        }
        if (typeof payload.originalImageUrl !== "string" || !payload.originalImageUrl) {
          throw new Error("ORIGINAL image URL is unavailable.");
        }
        setAuthority(payload.authority as AfcV2ProductionRoomAuthority);
        setOriginalImageUrl(payload.originalImageUrl);
        setGenerationId(
          typeof payload.generationId === "string" ? payload.generationId : null,
        );
      } catch (loadError) {
        if (cancelled) return;
        setAuthority(null);
        setOriginalImageUrl(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to restore AFC runtime.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [roomId, user]);

  const editorHref = roomId
    ? `/editor?roomId=${encodeURIComponent(roomId)}`
    : "/editor";

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">PI-3A Production AFC runtime</div>
          <div className="truncate text-xs text-neutral-400">
            {roomId ? `room ${roomId}` : "roomId is required"}
            {generationId ? ` · generation ${generationId}` : ""}
          </div>
        </div>
        <Link
          href={editorHref}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
        >
          Back to 2D editor
        </Link>
      </header>
      <main className="relative min-h-0 flex-1">
        {!roomId && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-300">
            Open with /editor/afc-3d?roomId=&lt;uuid&gt;
          </div>
        )}
        {roomId && loading && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-300">
            Restoring persisted AFC authority…
          </div>
        )}
        {roomId && !loading && error && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-200">
            {error}
          </div>
        )}
        {roomId && !loading && authority && originalImageUrl && (
          <AfcProductionRoomViewer
            roomId={roomId}
            authority={authority}
            originalImageUrl={originalImageUrl}
          />
        )}
      </main>
    </div>
  );
}

export function AfcProductionRuntimePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-300">
          Loading AFC runtime…
        </div>
      }
    >
      <AfcProductionRuntimePageInner />
    </Suspense>
  );
}
