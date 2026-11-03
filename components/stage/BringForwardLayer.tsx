"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import {
  BringForwardSelectionSurface,
  useBringForward,
} from "@/components/stage/BringForwardSession";
import { useRemoveAlignment } from "@/components/stage/RemoveAlignmentSession";
import { compositeBringForwardRgba } from "@/lib/vibode-stage/bring-forward-cutout";

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
  const forward = useBringForward();
  const removeActive = useRemoveAlignment()?.active === true;
  const noteBackgroundUrl = forward?.noteBackgroundUrl;
  useEffect(() => {
    noteBackgroundUrl?.(backgroundUrl);
  }, [backgroundUrl, noteBackgroundUrl]);
  const verified = forward?.verified ?? null;
  const scan = forward?.scan ?? null;
  const selectedIds = forward?.visibleIds;
  const presentation = useMemo(() => {
    if (removeActive || !verified || !scan || !selectedIds || selectedIds.size === 0) return null;
    if (scan.roomId !== roomId || scan.generationId !== generationId) return null;
    if (verified.width !== scan.original.width || verified.height !== scan.original.height) return null;
    const rgba = compositeBringForwardRgba({
      rgba: verified.rgba,
      width: verified.width,
      height: verified.height,
      objects: scan.objects,
      selectedIds,
    });
    return rgba
      ? { rgba, width: verified.width, height: verified.height }
      : null;
  }, [generationId, removeActive, roomId, scan, selectedIds, verified]);
  const showSelection = !removeActive && forward?.editing === true;
  if (!presentation && !showSelection) return null;
  return (
    <>
      {presentation ? (
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
      ) : null}
      {showSelection ? <BringForwardSelectionSurface /> : null}
    </>
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
