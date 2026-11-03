"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useRemoveAlignment } from "@/components/stage/RemoveAlignmentSession";
import { removeAlignmentArtifactPath } from "@/lib/vibode-stage/remove-alignment";
import {
  assessBringForwardDisplay,
  compositeBringForwardRgba,
  emptyBringForwardSession,
  retainBringForwardSession,
  type BringForwardObservation,
  type BringForwardSession,
} from "@/lib/vibode-stage/bring-forward-cutout";

type VerifiedOriginal = Readonly<{
  key: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}>;

/**
 * Photographic cutout above the STAGE furniture canvas.
 * The bitmap stays at verified ORIGINAL resolution and CSS fills the certified
 * frame. This component does not measure the viewport or move the camera.
 */
export function BringForwardLayer({
  roomId,
  generationId,
  backgroundUrl,
}: {
  roomId: string;
  generationId: string;
  backgroundUrl: string | null;
}) {
  const alignment = useRemoveAlignment();
  const removeActive = alignment?.active === true;
  const phase = alignment?.objectUi.phase ?? "idle";
  const readyObjects = phase === "ready" ? alignment?.objectUi.objects ?? null : null;
  const report = alignment?.report ?? null;
  const alignmentRoomId = alignment?.roomId ?? null;
  const observed = useMemo<BringForwardObservation | null>(() => {
    if (!report || phase !== "ready" || !readyObjects) return null;
    if (alignmentRoomId !== roomId || report.generationId !== generationId) return null;
    return {
      phase: "ready",
      roomId,
      generationId,
      originalSha256: report.original.sha256,
      originalWidth: report.original.decodedWidth,
      originalHeight: report.original.decodedHeight,
      objects: readyObjects,
    };
  }, [alignmentRoomId, generationId, phase, readyObjects, report, roomId]);
  const observationKey = [
    roomId,
    generationId,
    observed?.originalSha256 ?? "",
    observed?.originalWidth ?? 0,
    observed?.originalHeight ?? 0,
    observed?.phase ?? "idle",
    observed?.objects.map((object) => object.id).join("\n") ?? "",
  ].join("\0");
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [session, setSession] = useState<BringForwardSession>(emptyBringForwardSession);
  if (appliedKey !== observationKey) {
    setAppliedKey(observationKey);
    setSession((current) => retainBringForwardSession(current, {
      roomId,
      generationId,
      observed,
    }));
  }
  const [verified, setVerified] = useState<VerifiedOriginal | null>(null);
  const snapshot = session.snapshot;
  const selectedIds = session.selectedIds;
  const imageKey = snapshot && backgroundUrl
    ? [
      roomId,
      generationId,
      backgroundUrl,
      snapshot.original.sha256,
      snapshot.original.width,
      snapshot.original.height,
    ].join("\0")
    : null;

  useEffect(() => {
    if (!imageKey || !snapshot || !backgroundUrl || selectedIds.size === 0) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    const key = imageKey;
    const sourceUrl = removeAlignmentArtifactPath(roomId, "original", snapshot.generationId);
    void (async () => {
      const [displayed, source] = await Promise.all([
        loadBringForwardImage(backgroundUrl, controller.signal, false),
        loadBringForwardImage(sourceUrl, controller.signal, true),
      ]);
      if (cancelled) return;
      const decision = assessBringForwardDisplay({
        snapshot,
        roomId,
        generationId,
        displayed: displayed
          ? { sha256: displayed.sha256, width: displayed.width, height: displayed.height }
          : null,
        source: source
          ? { sha256: source.sha256, width: source.width, height: source.height }
          : null,
        removeActive: false,
      });
      if (decision !== "show" || !source?.rgba) {
        setVerified((current) => (current && current.key === key ? null : current));
        return;
      }
      setVerified({
        key,
        rgba: source.rgba,
        width: source.width,
        height: source.height,
      });
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [backgroundUrl, generationId, imageKey, roomId, selectedIds.size, snapshot]);

  const presentation = useMemo(() => {
    if (!verified || verified.key !== imageKey || !snapshot) return null;
    const rgba = compositeBringForwardRgba({
      rgba: verified.rgba,
      width: verified.width,
      height: verified.height,
      objects: snapshot.objects,
      selectedIds,
    });
    return rgba
      ? { rgba, width: verified.width, height: verified.height }
      : null;
  }, [imageKey, selectedIds, snapshot, verified]);

  if (removeActive || !presentation) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[15]"
      data-bring-forward="true"
      style={{ pointerEvents: "none" }}
    >
      <BringForwardCanvas
        rgba={presentation.rgba}
        width={presentation.width}
        height={presentation.height}
      />
    </div>
  );
}

export function BringForwardCanvas({
  rgba,
  width,
  height,
}: {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const image = context.createImageData(width, height);
    image.data.set(rgba);
    context.putImageData(image, 0, 0);
  }, [height, rgba, width]);
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      aria-hidden="true"
      data-bring-forward-canvas="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}

type LoadedBringForwardImage = Readonly<{
  sha256: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray | null;
}>;

async function loadBringForwardImage(
  url: string,
  signal: AbortSignal,
  readPixels: boolean,
): Promise<LoadedBringForwardImage | null> {
  if (signal.aborted || url.trim().length === 0) return null;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return null;
  }
  if (!response.ok || signal.aborted) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type && !type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted || bytes.byteLength === 0) return null;
  let sha256: string;
  try {
    sha256 = await sha256Hex(bytes);
  } catch {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: type || "image/jpeg" }));
  } catch {
    return null;
  }
  try {
    if (signal.aborted || bitmap.width < 1 || bitmap.height < 1) return null;
    const rgba = readPixels ? imageRgba(bitmap) : null;
    if (readPixels && !rgba) return null;
    return { sha256, width: bitmap.width, height: bitmap.height, rgba };
  } finally {
    bitmap.close();
  }
}

function imageRgba(bitmap: ImageBitmap): Uint8ClampedArray | null {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    return null;
  }
  context.drawImage(bitmap, 0, 0);
  try {
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  let hex = "";
  for (const value of new Uint8Array(digest)) {
    hex += value.toString(16).padStart(2, "0");
  }
  return hex;
}
