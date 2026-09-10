"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { AfcProductionRoomViewer } from "@/components/afc-3d/AfcProductionRoomViewer";
import { useAfcProductionRuntime } from "@/lib/afc-v2-runtime/use-afc-production-runtime";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const runtime = useAfcProductionRuntime(roomId, {
    enabled: Boolean(roomId && user),
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const next = roomId
        ? `/editor/afc-3d?roomId=${encodeURIComponent(roomId)}`
        : "/editor/afc-3d";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, roomId, router, user]);

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
            {runtime.generationId ? ` · generation ${runtime.generationId}` : ""}
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
        {roomId && runtime.loading && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-300">
            Restoring persisted AFC authority…
          </div>
        )}
        {roomId && !runtime.loading && runtime.error && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-200">
            {runtime.error}
          </div>
        )}
        {roomId && !runtime.loading && runtime.authority && runtime.originalImageUrl && (
          <AfcProductionRoomViewer
            roomId={roomId}
            authority={runtime.authority}
            originalImageUrl={runtime.originalImageUrl}
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
