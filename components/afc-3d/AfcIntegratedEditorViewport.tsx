"use client";

import type { ReactNode } from "react";

import type { AfcProductionRuntimeLoadState } from "@/lib/afc-v2-runtime/production-runtime-client";
import type { Prepare3dRoomState } from "@/lib/afc-v2-runtime/prepare-3d-room-client";
import type { RuntimeTransformMode } from "@/lib/afc-v2-runtime/types";

import { AfcProductionRoomViewer } from "@/components/afc-3d/AfcProductionRoomViewer";
import { Prepare3dRoomControl } from "@/components/afc-3d/Prepare3dRoomControl";

type Props = Readonly<{
  roomId: string;
  prepareState: Prepare3dRoomState;
  onPrepare: () => void;
  runtime: AfcProductionRuntimeLoadState;
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
      className={`flex h-full items-center justify-center px-6 text-center text-sm ${
        tone === "error" ? "text-red-200" : "text-neutral-300"
      }`}
    >
      {children}
    </div>
  );
}

export function AfcIntegratedEditorViewport({
  roomId,
  prepareState,
  onPrepare,
  runtime,
  transformMode,
  onTransformModeChange,
}: Props) {
  if (prepareState.phase === "checking") {
    return (
      <div
        className="absolute inset-0 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="checking"
      >
        <ViewportMessage>Restoring 3D room…</ViewportMessage>
      </div>
    );
  }

  if (prepareState.phase === "running") {
    return (
      <div
        className="absolute inset-0 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="running"
      >
        <ViewportMessage>Preparing your room…</ViewportMessage>
      </div>
    );
  }

  if (prepareState.phase !== "ready") {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase={prepareState.phase}
      >
        <Prepare3dRoomControl state={prepareState} onPrepare={onPrepare} />
      </div>
    );
  }

  if (runtime.loading) {
    return (
      <div
        className="absolute inset-0 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="restoring"
      >
        <ViewportMessage>Restoring 3D room…</ViewportMessage>
      </div>
    );
  }

  if (runtime.error || !runtime.authority || !runtime.originalImageUrl) {
    return (
      <div
        className="absolute inset-0 bg-neutral-950"
        data-editor-viewport-renderer="afc"
        data-afc-integrated-phase="error"
      >
        <ViewportMessage tone="error">
          {runtime.error ?? "This room has no production-ready AFC generation."}
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
        originalImageUrl={runtime.originalImageUrl}
        transformMode={transformMode}
        onTransformModeChange={onTransformModeChange}
        showInternalControls={false}
      />
    </div>
  );
}
