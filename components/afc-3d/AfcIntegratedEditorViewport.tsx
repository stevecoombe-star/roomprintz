"use client";

import type { ReactNode } from "react";

import type { AfcProductionRuntimeLoadState } from "@/lib/afc-v2-runtime/production-runtime-client";
import type { Prepare3dRoomState } from "@/lib/afc-v2-runtime/prepare-3d-room-client";
import type { RuntimeTransformMode } from "@/lib/afc-v2-runtime/types";
import { integrated3dViewportPresentation, INTEGRATED_3D_RESTORE_ERROR_MESSAGE } from "@/lib/afc-v2-runtime/editor-viewport-mode";

import { AfcProductionRoomViewer } from "@/components/afc-3d/AfcProductionRoomViewer";
import { Prepare3dRoomControl } from "@/components/afc-3d/Prepare3dRoomControl";

type Props = Readonly<{
  roomId: string;
  prepareState: Prepare3dRoomState;
  onPrepare: () => void;
  onRetryRestore?: () => void;
  runtime: AfcProductionRuntimeLoadState;
  backgroundImageUrl?: string | null;
  transformMode: RuntimeTransformMode;
  onTransformModeChange: (mode: RuntimeTransformMode) => void;
}>;

function ViewportMessage({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      className={`px-6 text-center text-sm ${
        tone === "error" ? "text-red-200" : "text-neutral-300"
      }`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      {children}
    </div>
  );
}

export function AfcIntegratedEditorViewport({
  roomId,
  prepareState,
  onPrepare,
  onRetryRestore,
  runtime,
  backgroundImageUrl,
  transformMode,
  onTransformModeChange,
}: Props) {
  const presentation = integrated3dViewportPresentation({
    preparePhase: prepareState.phase,
    runtimeLoading: runtime.loading,
    runtimeError: runtime.error,
    hasAuthority: runtime.authority != null,
    hasOriginalImage: Boolean(runtime.originalImageUrl),
  });

  if (presentation.surface === "status") {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase={presentation.phase}
      >
        <ViewportMessage>{presentation.message}</ViewportMessage>
      </div>
    );
  }

  if (presentation.surface === "prepare-error") {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="error"
      >
        <Prepare3dRoomControl state={prepareState} onPrepare={onPrepare} />
      </div>
    );
  }

  if (presentation.surface === "restore-error") {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="error"
      >
        <ViewportMessage tone="error">{presentation.message}</ViewportMessage>
        {onRetryRestore ? (
          <button
            type="button"
            onClick={onRetryRestore}
            className="rounded-md border border-emerald-500/70 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-100 transition hover:bg-emerald-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
          >
            Try Again
          </button>
        ) : null}
      </div>
    );
  }

  if (!runtime.authority || !runtime.originalImageUrl) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="error"
      >
        <ViewportMessage tone="error">
          {presentation.message ?? INTEGRATED_3D_RESTORE_ERROR_MESSAGE}
        </ViewportMessage>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0"
      data-editor-viewport-renderer="afc"
      data-afc-integrated-phase="ready"
    >
      <AfcProductionRoomViewer
        roomId={roomId}
        authority={runtime.authority}
        backgroundImageUrl={backgroundImageUrl}
        originalImageUrl={runtime.originalImageUrl}
        transformMode={transformMode}
        onTransformModeChange={onTransformModeChange}
        showInternalControls={false}
      />
    </div>
  );
}
