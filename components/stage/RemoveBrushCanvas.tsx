"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  acceptRemoveBrushBitmaps,
  initialRemoveStrokeState,
  mapOriginalRectToDisplay,
  mapRemovePointer,
  paintRemoveBrush,
  planRemoveMaskHold,
  reduceRemoveStroke,
  removeBrushScreenDiameter,
  removeMaskedCoveragePercent,
  type RemoveArtifactIdentity,
  type RemoveBrushTool,
  type RemoveDirtyRect,
  type RemoveMaskHoldIdentity,
  type RemoveStrokeEffect,
} from "@/lib/vibode-stage/remove-mask";
import {
  REMOVE_OBJECT_EXPANSION_DEFAULT_PX,
  paintRemoveObjectProtection,
  removeInspectionBackingSize,
  syncRemoveInspectionCoverage,
  watchRemoveDevicePixelRatio,
} from "@/lib/vibode-stage/remove-object-ui";
import type { RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";
import {
  removeAlignmentArtifactPath,
  type RemoveAlignmentReport,
} from "@/lib/vibode-stage/remove-alignment";

export type RemoveMaskHold = RemoveMaskHoldIdentity & Readonly<{
  pixels: Uint8Array;
}>;

export type RemoveMaskSummary = Readonly<{
  width: number;
  height: number;
  coveragePercent: number;
}>;

type BrushBitmaps = Readonly<{
  original: ImageBitmap;
  empty: ImageBitmap;
  identity: RemoveArtifactIdentity;
}>;

type LiveRemoveBrush = Readonly<{
  active: boolean;
  sessionSerial: number;
  roomId: string | null;
  generationId: string | null;
  maskEpoch: number;
}>;

const FULL_IMAGE = "full";
const EMPTY_OBJECTS: readonly RemoveObjectRecord[] = [];
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function closeBitmap(bitmap: ImageBitmap | null) {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    // The bitmap was already closed by an earlier cleanup.
  }
}

async function loadRemoveArtifact(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("unavailable");
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!type.startsWith("image/")) throw new Error("unavailable");
  const bytes = await response.arrayBuffer();
  return createImageBitmap(new Blob([bytes], { type }));
}

function syncBackingStore(canvas: HTMLCanvasElement): "skip" | "same" | "resized" {
  const backing = removeInspectionBackingSize(
    canvas.clientWidth,
    canvas.clientHeight,
    window.devicePixelRatio || 1,
  );
  if (!backing) return "skip";
  if (canvas.width === backing.width && canvas.height === backing.height) return "same";
  canvas.width = backing.width;
  canvas.height = backing.height;
  return "resized";
}

function writeMaskRegion(
  context: CanvasRenderingContext2D,
  pixels: Uint8Array,
  maskWidth: number,
  rect: RemoveDirtyRect,
) {
  const image = context.createImageData(rect.width, rect.height);
  const data = image.data;
  let offset = 0;
  for (let y = 0; y < rect.height; y += 1) {
    let index = (rect.y + y) * maskWidth + rect.x;
    for (let x = 0; x < rect.width; x += 1) {
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = pixels[index] ?? 0;
      offset += 4;
      index += 1;
    }
  }
  context.putImageData(image, rect.x, rect.y);
}

function compositeBrushRegion(input: Readonly<{
  display: CanvasRenderingContext2D;
  displayCanvas: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
  maskCanvas: HTMLCanvasElement;
  original: ImageBitmap;
  empty: ImageBitmap;
  area: RemoveDirtyRect;
}>) {
  const { display, displayCanvas, scratch, maskCanvas, original, empty, area } = input;
  if (area.width <= 0 || area.height <= 0) return;
  const scaleX = (value: number, size: number) => (value / displayCanvas.width) * size;
  const scaleY = (value: number, size: number) => (value / displayCanvas.height) * size;
  display.imageSmoothingEnabled = true;
  display.drawImage(
    original,
    scaleX(area.x, original.width),
    scaleY(area.y, original.height),
    scaleX(area.width, original.width),
    scaleY(area.height, original.height),
    area.x,
    area.y,
    area.width,
    area.height,
  );
  scratch.width = area.width;
  scratch.height = area.height;
  const scratchContext = scratch.getContext("2d");
  if (!scratchContext) return;
  scratchContext.imageSmoothingEnabled = true;
  scratchContext.globalCompositeOperation = "source-over";
  scratchContext.drawImage(
    empty,
    scaleX(area.x, empty.width),
    scaleY(area.y, empty.height),
    scaleX(area.width, empty.width),
    scaleY(area.height, empty.height),
    0,
    0,
    area.width,
    area.height,
  );
  scratchContext.globalCompositeOperation = "destination-in";
  scratchContext.drawImage(
    maskCanvas,
    scaleX(area.x, maskCanvas.width),
    scaleY(area.y, maskCanvas.height),
    scaleX(area.width, maskCanvas.width),
    scaleY(area.height, maskCanvas.height),
    0,
    0,
    area.width,
    area.height,
  );
  display.drawImage(scratch, area.x, area.y);
}

export function RemoveBrushCanvas({
  active,
  roomId,
  report,
  sessionSerial,
  maskEpoch,
  tool,
  diameterPx,
  featherPx,
  maskHoldRef,
  onMaskSummary,
  onDisplayedSize,
  interaction = "brush",
  backdrop = true,
  objects = EMPTY_OBJECTS,
  selectedIds = EMPTY_SELECTION,
  expansionPx = REMOVE_OBJECT_EXPANSION_DEFAULT_PX,
  protectObjects = false,
  onObjectClick,
  onObjectHover,
}: {
  active: boolean;
  roomId: string;
  report: RemoveAlignmentReport;
  sessionSerial: number;
  maskEpoch: number;
  tool: RemoveBrushTool;
  diameterPx: number;
  featherPx: number;
  maskHoldRef: { current: RemoveMaskHold | null };
  onMaskSummary: (summary: RemoveMaskSummary | null) => void;
  onDisplayedSize: (artifact: "original" | "empty", size: { width: number; height: number }) => void;
  interaction?: "brush" | "objects";
  backdrop?: boolean;
  objects?: readonly RemoveObjectRecord[];
  selectedIds?: ReadonlySet<string>;
  expansionPx?: number;
  protectObjects?: boolean;
  onObjectClick?: (point: Readonly<{ x: number; y: number }>) => void;
  onObjectHover?: (point: Readonly<{ x: number; y: number }> | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const bitmapsRef = useRef<BrushBitmaps | null>(null);
  const [bitmapVersion, setBitmapVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const toolRef = useRef(tool);
  const diameterRef = useRef(diameterPx);
  const featherRef = useRef(featherPx);
  const summaryRef = useRef(onMaskSummary);
  const displayedSizeRef = useRef(onDisplayedSize);
  const interactionRef = useRef(interaction);
  const objectsRef = useRef(objects);
  const selectedRef = useRef(selectedIds);
  const objectClickRef = useRef(onObjectClick);
  const objectHoverRef = useRef(onObjectHover);
  const expansionRef = useRef(expansionPx);
  const protectRef = useRef(protectObjects);
  const repaintRef = useRef<(() => void) | null>(null);
  const endBrushRef = useRef<() => void>(() => {});
  const liveRef = useRef<LiveRemoveBrush>({
    active,
    sessionSerial,
    roomId,
    generationId: report.generationId,
    maskEpoch,
  });
  const loadTokenRef = useRef(0);
  const loadKey = `${sessionSerial}:${roomId}:${report.generationId}`;
  const [loadKeySeen, setLoadKeySeen] = useState(loadKey);
  if (loadKeySeen !== loadKey) {
    setLoadKeySeen(loadKey);
    setLoadError(null);
  }

  useLayoutEffect(() => {
    toolRef.current = tool;
    diameterRef.current = diameterPx;
    featherRef.current = featherPx;
    summaryRef.current = onMaskSummary;
    displayedSizeRef.current = onDisplayedSize;
    liveRef.current = {
      active,
      sessionSerial,
      roomId,
      generationId: report.generationId,
      maskEpoch,
    };
    return () => {
      liveRef.current = { ...liveRef.current, active: false };
    };
  }, [
    active,
    diameterPx,
    featherPx,
    maskEpoch,
    onDisplayedSize,
    onMaskSummary,
    report.generationId,
    roomId,
    sessionSerial,
    tool,
  ]);

  useLayoutEffect(() => {
    objectClickRef.current = onObjectClick;
    objectHoverRef.current = onObjectHover;
    protectRef.current = protectObjects;
  }, [onObjectClick, onObjectHover, protectObjects]);

  useLayoutEffect(() => {
    expansionRef.current = expansionPx;
    interactionRef.current = interaction;
    objectsRef.current = objects;
    selectedRef.current = selectedIds;
    if (interaction !== "brush") {
      if (cursorRef.current) cursorRef.current.style.display = "none";
      endBrushRef.current();
    }
    repaintRef.current?.();
  }, [expansionPx, interaction, objects, selectedIds]);

  useEffect(() => () => {
    const pair = bitmapsRef.current;
    bitmapsRef.current = null;
    if (!pair) return;
    closeBitmap(pair.original);
    closeBitmap(pair.empty);
  }, []);

  useEffect(() => {
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    let cancelled = false;
    let handedOff = false;
    const owned = { original: null as ImageBitmap | null, empty: null as ImageBitmap | null };
    const controller = new AbortController();
    const displayed = bitmapsRef.current;
    if (
      displayed
      && (
        displayed.identity.sessionSerial !== sessionSerial
        || displayed.identity.roomId !== roomId
        || displayed.identity.generationId !== report.generationId
      )
    ) {
      bitmapsRef.current = null;
      closeBitmap(displayed.original);
      closeBitmap(displayed.empty);
    }
    const requested: RemoveArtifactIdentity = {
      sessionSerial,
      roomId,
      generationId: report.generationId,
    };
    const closeOwned = () => {
      closeBitmap(owned.original);
      closeBitmap(owned.empty);
      owned.original = null;
      owned.empty = null;
    };
    void (async () => {
      try {
        const [original, empty] = await Promise.all([
          loadRemoveArtifact(
            removeAlignmentArtifactPath(roomId, "original", report.generationId),
            controller.signal,
          ),
          loadRemoveArtifact(
            removeAlignmentArtifactPath(roomId, "empty", report.generationId),
            controller.signal,
          ),
        ]);
        owned.original = original;
        owned.empty = empty;
        if (cancelled || token !== loadTokenRef.current) {
          closeOwned();
          return;
        }
        const live = liveRef.current;
        const decision = acceptRemoveBrushBitmaps({
          requested,
          current: live.roomId && live.generationId
            ? {
              sessionSerial: live.sessionSerial,
              roomId: live.roomId,
              generationId: live.generationId,
            }
            : null,
          active: live.active,
          original: { width: original.width, height: original.height },
          empty: { width: empty.width, height: empty.height },
          expectedOriginal: {
            width: report.original.decodedWidth,
            height: report.original.decodedHeight,
          },
          expectedEmpty: {
            width: report.empty.decodedWidth,
            height: report.empty.decodedHeight,
          },
        });
        if (!decision.accept) {
          if (decision.reason === "dimensions") {
            displayedSizeRef.current("original", { width: original.width, height: original.height });
            displayedSizeRef.current("empty", { width: empty.width, height: empty.height });
          }
          closeOwned();
          return;
        }
        const next: RemoveMaskHoldIdentity = {
          sessionSerial: requested.sessionSerial,
          roomId: requested.roomId,
          generationId: requested.generationId,
          width: original.width,
          height: original.height,
          epoch: live.maskEpoch,
        };
        const plan = planRemoveMaskHold({
          disposition: decision,
          existing: maskHoldRef.current,
          next,
        });
        if (plan === "ignore" || cancelled || token !== loadTokenRef.current) {
          closeOwned();
          return;
        }
        if (plan === "allocate") {
          maskHoldRef.current = {
            ...next,
            pixels: new Uint8Array(next.width * next.height),
          };
        } else if (plan === "reset" && maskHoldRef.current) {
          maskHoldRef.current.pixels.fill(0);
          maskHoldRef.current = { ...maskHoldRef.current, epoch: next.epoch };
        }
        displayedSizeRef.current("original", { width: original.width, height: original.height });
        displayedSizeRef.current("empty", { width: empty.width, height: empty.height });
        const previous = bitmapsRef.current;
        handedOff = true;
        bitmapsRef.current = { original, empty, identity: requested };
        owned.original = null;
        owned.empty = null;
        closeBitmap(previous?.original ?? null);
        closeBitmap(previous?.empty ?? null);
        setBitmapVersion((value) => value + 1);
      } catch {
        closeOwned();
        if (cancelled || token !== loadTokenRef.current) return;
        const live = liveRef.current;
        if (
          live.active
          && live.sessionSerial === requested.sessionSerial
          && live.roomId === requested.roomId
          && live.generationId === requested.generationId
        ) {
          setLoadError("Authoritative ORIGINAL and EMPTY images are unavailable.");
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (!handedOff) closeOwned();
    };
  }, [maskHoldRef, report, roomId, sessionSerial]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pair = bitmapsRef.current;
    const hold = maskHoldRef.current;
    const identityMatches = pair !== null
      && hold !== null
      && pair.identity.sessionSerial === sessionSerial
      && pair.identity.roomId === roomId
      && pair.identity.generationId === report.generationId
      && hold.sessionSerial === sessionSerial
      && hold.roomId === roomId
      && hold.generationId === report.generationId
      && hold.width === pair.original.width
      && hold.height === pair.original.height;
    if (!canvas || !pair || !hold || !identityMatches) {
      if (canvas) {
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return undefined;
    }
    if (hold.epoch !== maskEpoch) {
      hold.pixels.fill(0);
      maskHoldRef.current = { ...hold, epoch: maskEpoch };
    }
    const pixels = maskHoldRef.current?.pixels;
    if (!pixels) return undefined;
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = hold.width;
    maskCanvas.height = hold.height;
    const scratch = document.createElement("canvas");
    const display = canvas.getContext("2d", { alpha: interactionRef.current === "objects" });
    const maskContext = maskCanvas.getContext("2d");
    if (!display || !maskContext) {
      maskCanvas.width = 0;
      return undefined;
    }
    const objectUnion = new Uint8Array(hold.width * hold.height);
    const dilated = new Uint8Array(hold.width * hold.height);
    const effective = new Uint8Array(hold.width * hold.height);
    let protectionCache: {
      objects: readonly RemoveObjectRecord[];
      pixels: Uint8Array;
    } | null = null;
    const protectionPixels = (): Uint8Array | undefined => {
      if (!protectRef.current) return undefined;
      const currentObjects = objectsRef.current;
      if (protectionCache && protectionCache.objects === currentObjects) return protectionCache.pixels;
      const buffer = new Uint8Array(hold.width * hold.height);
      const painted = paintRemoveObjectProtection({
        destination: buffer,
        width: hold.width,
        height: hold.height,
        objects: currentObjects,
        bounds: { x: 0, y: 0, width: hold.width, height: hold.height },
      });
      if (!painted) {
        protectionCache = null;
        return undefined;
      }
      protectionCache = { objects: currentObjects, pixels: buffer };
      return buffer;
    };

    const publish = () => {
      const current = maskHoldRef.current;
      if (!current) return;
      summaryRef.current({
        width: current.width,
        height: current.height,
        coveragePercent: removeMaskedCoveragePercent(current.pixels),
      });
    };
    const writeMask = (rect: RemoveDirtyRect): RemoveDirtyRect => {
      const written = syncRemoveInspectionCoverage({
        brush: pixels,
        objectUnion,
        dilated,
        destination: effective,
        width: hold.width,
        height: hold.height,
        objects: objectsRef.current,
        selectedIds: selectedRef.current,
        bounds: rect,
        expansionPx: expansionRef.current,
      });
      writeMaskRegion(maskContext, written ? effective : pixels, hold.width, written ?? rect);
      return written ?? rect;
    };
    const paintDisplay = (dirty: RemoveDirtyRect | typeof FULL_IMAGE) => {
      const backing = syncBackingStore(canvas);
      if (backing === "skip") return;
      const area = backing === "resized" || dirty === FULL_IMAGE
        ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
        : mapOriginalRectToDisplay({
          dirty,
          maskWidth: hold.width,
          maskHeight: hold.height,
          displayWidth: canvas.width,
          displayHeight: canvas.height,
          pad: 2,
        });
      if (!area) return;
      if (backing === "resized" || dirty === FULL_IMAGE) {
        writeMask({ x: 0, y: 0, width: hold.width, height: hold.height });
      }
      compositeBrushRegion({
        display,
        displayCanvas: canvas,
        scratch,
        maskCanvas,
        original: pair.original,
        empty: pair.empty,
        area,
      });
    };

    writeMask({ x: 0, y: 0, width: hold.width, height: hold.height });
    paintDisplay(FULL_IMAGE);
    publish();

    const stroke = { current: initialRemoveStrokeState() };
    const applyEffect = (effect: RemoveStrokeEffect) => {
      if (effect.capturePointerId != null) {
        try {
          canvas.setPointerCapture(effect.capturePointerId);
        } catch {
          // Capture is best-effort until the pointer is released.
        }
      }
      if (effect.paint) {
        const dirty = paintRemoveBrush({
          mask: pixels,
          width: hold.width,
          height: hold.height,
          from: effect.paint.from,
          to: effect.paint.to,
          diameterPx: diameterRef.current,
          featherPx: featherRef.current,
          tool: toolRef.current,
          protection: protectionPixels(),
        });
        if (dirty) paintDisplay(writeMask(dirty));
      }
      if (effect.releasePointerId != null) {
        try {
          if (canvas.hasPointerCapture(effect.releasePointerId)) {
            canvas.releasePointerCapture(effect.releasePointerId);
          }
        } catch {
          // The browser already released this pointer.
        }
        publish();
      }
    };
    const locate = (event: PointerEvent) => mapRemovePointer({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: canvas.getBoundingClientRect(),
      originalWidth: hold.width,
      originalHeight: hold.height,
    });
    const releaseBrush = () => {
      if (stroke.current.phase !== "active") return;
      const ended = reduceRemoveStroke(stroke.current, { type: "end" });
      stroke.current = ended.state;
      applyEffect(ended.effect);
    };
    endBrushRef.current = releaseBrush;
    repaintRef.current = () => paintDisplay(FULL_IMAGE);
    const updateCursor = (event: PointerEvent) => {
      const cursor = cursorRef.current;
      const parent = canvas.parentElement;
      if (!cursor || !parent || interactionRef.current !== "brush") return;
      const frame = canvas.getBoundingClientRect();
      const location = mapRemovePointer({
        clientX: event.clientX,
        clientY: event.clientY,
        rect: frame,
        originalWidth: hold.width,
        originalHeight: hold.height,
      });
      if (location.status !== "inside") {
        cursor.style.display = "none";
        return;
      }
      const parentRect = parent.getBoundingClientRect();
      const screen = removeBrushScreenDiameter({
        diameterPx: diameterRef.current,
        frameWidth: frame.width,
        originalWidth: hold.width,
      });
      cursor.style.display = "block";
      cursor.style.width = `${screen}px`;
      cursor.style.height = `${screen}px`;
      cursor.style.transform = `translate(${event.clientX - parentRect.left}px, ${event.clientY - parentRect.top}px) translate(-50%, -50%)`;
    };
    const onDown = (event: PointerEvent) => {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (interactionRef.current === "objects") {
        releaseBrush();
        const location = locate(event);
        if (location.status === "inside") objectClickRef.current?.(location);
        return;
      }
      const location = locate(event);
      if (location.status === "unavailable") {
        const ended = reduceRemoveStroke(stroke.current, { type: "unavailable", pointerId: event.pointerId });
        stroke.current = ended.state;
        applyEffect(ended.effect);
        return;
      }
      const result = reduceRemoveStroke(stroke.current, {
        type: "down",
        pointerId: event.pointerId,
        primary: event.isPrimary,
        button: event.button,
        location,
      });
      stroke.current = result.state;
      applyEffect(result.effect);
      updateCursor(event);
    };
    const onMove = (event: PointerEvent) => {
      if (interactionRef.current === "objects") {
        const location = locate(event);
        objectHoverRef.current?.(location.status === "inside" ? location : null);
        return;
      }
      updateCursor(event);
      const location = locate(event);
      if (location.status === "unavailable") {
        const ended = reduceRemoveStroke(stroke.current, { type: "unavailable", pointerId: event.pointerId });
        stroke.current = ended.state;
        applyEffect(ended.effect);
        return;
      }
      const result = reduceRemoveStroke(stroke.current, {
        type: "move",
        pointerId: event.pointerId,
        location,
      });
      stroke.current = result.state;
      applyEffect(result.effect);
    };
    const onUp = (event: PointerEvent) => {
      if (interactionRef.current === "objects") return;
      const result = reduceRemoveStroke(stroke.current, {
        type: "up",
        pointerId: event.pointerId,
        location: locate(event),
      });
      stroke.current = result.state;
      applyEffect(result.effect);
      updateCursor(event);
    };
    const onCancel = (event: PointerEvent) => {
      const result = reduceRemoveStroke(stroke.current, { type: "cancel", pointerId: event.pointerId });
      stroke.current = result.state;
      applyEffect(result.effect);
    };
    const onLost = (event: PointerEvent) => {
      const result = reduceRemoveStroke(stroke.current, {
        type: "lostcapture",
        pointerId: event.pointerId,
      });
      stroke.current = result.state;
      applyEffect(result.effect);
    };
    const onLeave = () => {
      if (interactionRef.current === "objects") {
        objectHoverRef.current?.(null);
        return;
      }
      if (cursorRef.current && stroke.current.phase !== "active") {
        cursorRef.current.style.display = "none";
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("lostpointercapture", onLost);
    canvas.addEventListener("pointerleave", onLeave);
    const redraw = () => paintDisplay(FULL_IMAGE);
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    window.addEventListener("resize", redraw);
    const stopRatio = watchRemoveDevicePixelRatio(redraw);

    return () => {
      repaintRef.current = null;
      endBrushRef.current = () => {};
      const ended = reduceRemoveStroke(stroke.current, { type: "end" });
      stroke.current = ended.state;
      applyEffect(ended.effect);
      observer.disconnect();
      window.removeEventListener("resize", redraw);
      stopRatio();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("lostpointercapture", onLost);
      canvas.removeEventListener("pointerleave", onLeave);
      maskCanvas.width = 0;
      scratch.width = 0;
    };
  }, [bitmapVersion, maskEpoch, maskHoldRef, report.generationId, roomId, sessionSerial]);

  return (
    <>
      {backdrop ? (
        <div className="absolute inset-0 bg-neutral-950" data-remove-brush-backdrop="true" />
      ) : null}
      <canvas
        ref={canvasRef}
        aria-label={interaction === "objects" ? "Remove objects" : "Remove brush"}
        data-remove-brush-canvas="true"
        data-remove-interaction={interaction}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "auto", touchAction: "none" }}
      />
      <div
        ref={cursorRef}
        data-remove-brush-cursor="true"
        className="pointer-events-none absolute left-0 top-0 rounded-full border border-white/80"
        style={{ display: "none" }}
      />
      {loadError ? (
        <div className="pointer-events-none absolute inset-x-6 top-6 text-center text-xs text-neutral-300" role="status">
          {loadError}
        </div>
      ) : null}
    </>
  );
}
