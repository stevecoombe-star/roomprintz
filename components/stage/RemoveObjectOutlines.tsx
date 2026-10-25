"use client";

import { useEffect, useMemo, useRef } from "react";

import {
  mapOriginalBoxToBacking,
  removeInspectionBackingSize,
  removeObjectBoundaryPixels,
  removeObjectOutlineRender,
  watchRemoveDevicePixelRatio,
} from "@/lib/vibode-stage/remove-object-ui";
import type { RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";

export function RemoveObjectOutlines({
  objects,
  selectedIds,
  hoveredId,
  outlinesVisible,
}: {
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  hoveredId: string | null;
  outlinesVisible: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sprites = useMemo(() => objects.flatMap((object) => {
    if (typeof document === "undefined") return [];
    const bounds = object.mask.bounds;
    if (bounds.width <= 0 || bounds.height <= 0) return [];
    const sprite = document.createElement("canvas");
    sprite.width = bounds.width;
    sprite.height = bounds.height;
    const context = sprite.getContext("2d");
    if (!context) return [];
    const image = context.createImageData(bounds.width, bounds.height);
    for (const point of removeObjectBoundaryPixels(object.mask)) {
      const localX = point.x - bounds.x;
      const localY = point.y - bounds.y;
      if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height) continue;
      const offset = (localY * bounds.width + localX) * 4;
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return [{
      id: object.id,
      sprite,
      bounds,
      width: object.mask.width,
      height: object.mask.height,
    }];
  }), [objects]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const scratch = document.createElement("canvas");
    const draw = () => {
      const backing = removeInspectionBackingSize(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio || 1,
      );
      if (!backing) return;
      if (canvas.width !== backing.width || canvas.height !== backing.height) {
        canvas.width = backing.width;
        canvas.height = backing.height;
      }
      const display = canvas.getContext("2d");
      if (!display) return;
      display.clearRect(0, 0, canvas.width, canvas.height);
      display.imageSmoothingEnabled = false;
      for (const item of sprites) {
        const policy = removeObjectOutlineRender({
          outlinesVisible,
          hidden: selectedIds.has(item.id),
          hovered: item.id === hoveredId,
        });
        if (!policy.rendered || !policy.color) continue;
        const box = mapOriginalBoxToBacking({
          box: item.bounds,
          originalWidth: item.width,
          originalHeight: item.height,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
        });
        if (!box) continue;
        const color = policy.color;
        const emphasized = policy.emphasized;
        scratch.width = Math.max(1, Math.ceil(box.width));
        scratch.height = Math.max(1, Math.ceil(box.height));
        const tint = scratch.getContext("2d");
        if (!tint) continue;
        tint.setTransform(1, 0, 0, 1, 0, 0);
        tint.globalCompositeOperation = "source-over";
        tint.clearRect(0, 0, scratch.width, scratch.height);
        tint.imageSmoothingEnabled = false;
        tint.drawImage(item.sprite, 0, 0, scratch.width, scratch.height);
        tint.globalCompositeOperation = "source-in";
        tint.fillStyle = color;
        tint.fillRect(0, 0, scratch.width, scratch.height);
        display.globalAlpha = emphasized ? 1 : 0.82;
        display.drawImage(scratch, box.x, box.y);
        if (emphasized) {
          display.drawImage(scratch, box.x + 1, box.y);
          display.drawImage(scratch, box.x, box.y + 1);
        }
      }
      display.globalAlpha = 1;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    window.addEventListener("resize", draw);
    const stopRatio = watchRemoveDevicePixelRatio(draw);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
      stopRatio();
      scratch.width = 0;
    };
  }, [hoveredId, outlinesVisible, selectedIds, sprites]);

  if (!removeObjectOutlineRender({
    outlinesVisible,
    hidden: false,
    hovered: true,
  }).rendered) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-remove-object-outlines="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
