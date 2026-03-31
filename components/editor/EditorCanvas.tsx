// components/editor/EditorCanvas.tsx
"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Rect,
  Transformer,
  Group,
  Circle,
  Line,
  Text,
  Image as KonvaImage,
} from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import { useEditorStore, type FurnitureNode } from "@/stores/editorStore";
import { MOCK_COLLECTIONS } from "@/data/mockCollections";
import { computeOverlappingNodeIds } from "@/lib/collisionV1";

type DragFurniturePayload = {
  skuId: string;
  label?: string;
};

const DND_MIME = "application/x-roomprintz-furniture";
const REMOVE_MARK_STAGE_RADIUS = 18;
const SWAP_MARK_STAGE_RADIUS = 18;
const ROTATE_MARK_STAGE_RADIUS = 18;
const MOVE_MARK_HIT_STAGE_RADIUS = 14;
const MOVE_MARK_ANCHOR_RADIUS = 6;
const MOVE_MARK_ARROW_HEAD_SIZE = 10;
const MOVE_MARK_ANCHOR_FILL = "#00B3A4";
const MOVE_MARK_ARROW_STROKE = "#1FD3C6";
const PASTE_TO_PLACE_PULSE_DURATION_MS = 560;
const PASTE_TO_PLACE_MENU_OFFSET_PX = 12;
const PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX = 8;
const PASTE_TO_PLACE_MENU_ESTIMATED_WIDTH_PX = 220;
const PASTE_TO_PLACE_MENU_ESTIMATED_HEIGHT_PX = 132;
const PASTE_TO_PLACE_MENU_WITH_PREVIEW_ESTIMATED_HEIGHT_PX = 238;
const PASTE_TO_PLACE_PROGRESS_CARD_ESTIMATED_HEIGHT_PX = 120;
type VisualMode = "blueprint" | "thumbnails";
type SilhouetteKind = "sofa" | "chair" | "table" | "lamp" | "bed" | "rug";
type ActiveTool = ReturnType<typeof useEditorStore.getState>["ui"]["activeTool"];
type PasteToPlaceStatus = "reading" | "preparing" | "placing";
type PasteToPlaceMenuState = {
  xNorm: number;
  yNorm: number;
  anchorCssX: number;
  anchorCssY: number;
} | null;
const PASTE_TO_PLACE_PROGRESS_COPY: Record<PasteToPlaceStatus, string> = {
  reading: "Reading copied image...",
  preparing: "Preparing product...",
  placing: "Placing it in your room...",
};

type VibodeDebugWindow = Window & {
  __VIBODE_DEBUG_ROOM_OPEN__?: boolean;
};

function isRoomOpenDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window as VibodeDebugWindow).__VIBODE_DEBUG_ROOM_OPEN__ === true;
}

function logEditorCanvas(event: string, payload?: Record<string, unknown>) {
  if (!isRoomOpenDebugEnabled()) return;
  if (payload) {
    console.log("[editor-canvas]", event, payload);
    return;
  }
  console.log("[editor-canvas]", event);
}

const SILHOUETTE_FILL = "#f8fafc";
const SILHOUETTES: Record<SilhouetteKind, string> = {
  sofa: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><g fill="${SILHOUETTE_FILL}"><rect x="8" y="26" width="84" height="26" rx="8"/><rect x="4" y="18" width="20" height="30" rx="6"/><rect x="76" y="18" width="20" height="30" rx="6"/><rect x="24" y="8" width="52" height="20" rx="8"/></g></svg>`,
  chair: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><g fill="${SILHOUETTE_FILL}"><rect x="22" y="24" width="56" height="22" rx="6"/><rect x="30" y="8" width="40" height="18" rx="6"/><rect x="24" y="44" width="8" height="12"/><rect x="68" y="44" width="8" height="12"/></g></svg>`,
  table: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><g fill="${SILHOUETTE_FILL}"><rect x="10" y="14" width="80" height="14" rx="4"/><rect x="16" y="28" width="8" height="24"/><rect x="76" y="28" width="8" height="24"/><rect x="40" y="28" width="8" height="24"/><rect x="52" y="28" width="8" height="24"/></g></svg>`,
  lamp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><g fill="${SILHOUETTE_FILL}"><rect x="46" y="22" width="8" height="22"/><rect x="40" y="44" width="20" height="6" rx="3"/><path d="M25 22h50l-10-16H35z"/></g></svg>`,
  bed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><g fill="${SILHOUETTE_FILL}"><rect x="10" y="22" width="80" height="26" rx="6"/><rect x="14" y="16" width="22" height="10" rx="4"/><rect x="64" y="16" width="22" height="10" rx="4"/><rect x="10" y="48" width="6" height="8"/><rect x="84" y="48" width="6" height="8"/></g></svg>`,
  rug: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="12" y="12" width="76" height="36" rx="10" fill="${SILHOUETTE_FILL}"/></svg>`,
};
const silhouetteImageCache = new Map<SilhouetteKind, HTMLImageElement>();

function svgToImage(svg: string) {
  const img = new Image();
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return img;
}

function getSilhouetteImage(kind: SilhouetteKind) {
  const cached = silhouetteImageCache.get(kind);
  if (cached) return cached;
  const svg = SILHOUETTES[kind] ?? SILHOUETTES.table;
  const img = svgToImage(svg);
  silhouetteImageCache.set(kind, img);
  return img;
}

function inferSilhouetteKind(node: FurnitureNode): SilhouetteKind {
  const sku = (node.skuId || "").toLowerCase();
  if (sku.includes("sofa")) return "sofa";
  if (sku.includes("chair")) return "chair";
  if (sku.includes("table") || sku.includes("coffee") || sku.includes("dining")) return "table";
  if (sku.includes("lamp")) return "lamp";
  if (sku.includes("bed")) return "bed";
  if (sku.includes("rug")) return "rug";
  return "table";
}

function useSilhouetteImage(kind: SilhouetteKind) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = getSilhouetteImage(kind);
    if (img.complete) {
      setImage(img);
      return;
    }

    let canceled = false;
    const onLoad = () => {
      if (!canceled) setImage(img);
    };
    img.addEventListener("load", onLoad);
    return () => {
      canceled = true;
      img.removeEventListener("load", onLoad);
    };
  }, [kind]);

  return image;
}

function SilhouetteLayer({
  kind,
  x,
  y,
  width,
  height,
  opacity,
}: {
  kind: SilhouetteKind;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}) {
  const image = useSilhouetteImage(kind);
  if (!image) return null;
  return (
    <KonvaImage
      image={image}
      x={x}
      y={y}
      width={width}
      height={height}
      opacity={opacity}
      listening={false}
    />
  );
}

const failedThumbnailUrls = new Set<string>();

function ThumbnailLayer({
  url,
  x,
  y,
  width,
  height,
  opacity,
}: {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}) {
  const skipLoad = failedThumbnailUrls.has(url);
  const [image, status] = useImage(skipLoad ? "" : url, "anonymous");

  useEffect(() => {
    if (!image || skipLoad) return;
    const onError = () => {
      failedThumbnailUrls.add(url);
    };
    image.addEventListener("error", onError);
    return () => {
      image.removeEventListener("error", onError);
    };
  }, [image, skipLoad, url]);

  if (skipLoad || status === "failed") return null;
  if (!image || width <= 0 || height <= 0) return null;

  const scale = Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const dx = x + (width - w) / 2;
  const dy = y + (height - h) / 2;

  return (
    <KonvaImage
      image={image}
      x={dx}
      y={dy}
      width={w}
      height={h}
      opacity={opacity}
      listening={false}
    />
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getValidAspectRatio(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getAspectRatioFromDimensions(
  width: number | null | undefined,
  height: number | null | undefined
) {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return null;
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) return null;
  return width / height;
}

function findSkuById(skuId: string) {
  for (const c of MOCK_COLLECTIONS) {
    const sku = c.catalog[skuId];
    if (sku) return sku;
  }
  return null;
}

export function EditorCanvas({
  className,
  onRequestSwap,
  pasteToPlaceMenuState = null,
  onOpenPasteToPlaceMenu,
  onPasteToPlaceChoosePlaceHere,
  onPasteToPlaceChooseMyFurnitureAdd,
  onPasteToPlaceChooseSwap,
  onPasteToPlaceChooseAutoPlace,
  onDismissPasteToPlaceMenu,
  pasteToPlaceMenuPreviewUrl = null,
  isMyFurnitureLoading = false,
  isPasteToPlaceMenuPreviewLoading = false,
  pasteToPlaceProgressCardState = null,
  pasteToPlaceProgressCardPreviewUrl = null,
  isPasteToPlaceProgressCardLoading = false,
  markupVisible = true,
  visualMode = "blueprint",
  imageUrl,
  frameAspectRatio = null,
  placeholderImageUrl = null,
  showPlaceholder = false,
  finalImageReady = true,
  isHydratingRoom = false,
  pasteToPlaceStatus = null,
  isSwapPickMode = false,
  onSwapPickPoint,
  onCancelSwapPickMode,
}: {
  className?: string;
  onRequestSwap?: (id: string) => void;
  pasteToPlaceMenuState?: PasteToPlaceMenuState;
  onOpenPasteToPlaceMenu?: (state: NonNullable<PasteToPlaceMenuState>) => void;
  onPasteToPlaceChoosePlaceHere?: () => void;
  onPasteToPlaceChooseMyFurnitureAdd?: () => void;
  onPasteToPlaceChooseSwap?: () => void;
  onPasteToPlaceChooseAutoPlace?: () => void;
  onDismissPasteToPlaceMenu?: () => void;
  pasteToPlaceMenuPreviewUrl?: string | null;
  isMyFurnitureLoading?: boolean;
  isPasteToPlaceMenuPreviewLoading?: boolean;
  pasteToPlaceProgressCardState?: PasteToPlaceMenuState;
  pasteToPlaceProgressCardPreviewUrl?: string | null;
  isPasteToPlaceProgressCardLoading?: boolean;
  markupVisible?: boolean;
  visualMode?: VisualMode;
  imageUrl?: string | null;
  frameAspectRatio?: number | null;
  placeholderImageUrl?: string | null;
  showPlaceholder?: boolean;
  finalImageReady?: boolean;
  isHydratingRoom?: boolean;
  pasteToPlaceStatus?: PasteToPlaceStatus | null;
  isSwapPickMode?: boolean;
  onSwapPickPoint?: (point: { xNorm: number; yNorm: number }) => void;
  onCancelSwapPickMode?: () => void;
}) {
  const instanceId = useId();
  const outerShellRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const baseImageUrl = useEditorStore((s) => s.scene.baseImageUrl);
  const baseImageWidthPx = useEditorStore((s) => s.scene.baseImageWidthPx);
  const baseImageHeightPx = useEditorStore((s) => s.scene.baseImageHeightPx);
  const canvasImageUrl = imageUrl ?? baseImageUrl;
  const nodes = useEditorStore((s) => s.scene.nodes);
  const removeMarks = useEditorStore((s) => s.scene.removeMarks ?? []);
  const swapMarks = useEditorStore((s) => s.scene.swapMarks ?? []);
  const rotateMarks = useEditorStore((s) => s.scene.rotateMarks ?? []);
  const moveMarks = useEditorStore((s) => s.scene.moveMarks ?? []);
  const selectedNodeId = useEditorStore((s) => s.ui.selectedNodeId);
  const selectedRemoveMarkId = useEditorStore((s) => s.ui.selectedRemoveMarkId);
  const selectedSwapMarkId = useEditorStore((s) => s.ui.selectedSwapMarkId);
  const selectedRotateMarkId = useEditorStore((s) => s.ui.selectedRotateMarkId);
  const selectedMoveMarkId = useEditorStore((s) => s.ui.selectedMoveMarkId);
  const activeTool: ActiveTool = useEditorStore((s) => s.ui.activeTool);

  const viewport = useEditorStore((s) => s.viewport);
  const calibration = useEditorStore((s) => s.scene.calibration);
  const ppf = useEditorStore((s) => s.scene.calibration?.ppf);

  const setViewport = useEditorStore((s) => s.setViewport);

  const selectNode = useEditorStore((s) => s.selectNode);
  const addNode = useEditorStore((s) => s.addNode);
  const updateNodeTransform = useEditorStore((s) => s.updateNodeTransform);
  const deleteNode = useEditorStore((s) => s.deleteNode);

  const toggleDelete = useEditorStore((s) => s.toggleDelete);
  const setPendingSwap = useEditorStore((s) => s.setPendingSwap);

  const clearCalibrationDraft = useEditorStore((s) => s.clearCalibrationDraft);
  const setCalibrationPoint = useEditorStore((s) => s.setCalibrationPoint);
  const selectRemoveMark = useEditorStore((s) => s.selectRemoveMark);
  const addRemoveMark = useEditorStore((s) => s.addRemoveMark);
  const updateRemoveMark = useEditorStore((s) => s.updateRemoveMark);
  const removeRemoveMark = useEditorStore((s) => s.removeRemoveMark);
  const selectSwapMark = useEditorStore((s) => s.selectSwapMark);
  const addSwapMark = useEditorStore((s) => s.addSwapMark);
  const updateSwapMark = useEditorStore((s) => s.updateSwapMark);
  const removeSwapMark = useEditorStore((s) => s.removeSwapMark);
  const selectRotateMark = useEditorStore((s) => s.selectRotateMark);
  const addRotateMark = useEditorStore((s) => s.addRotateMark);
  const updateRotateMark = useEditorStore((s) => s.updateRotateMark);
  const removeRotateMark = useEditorStore((s) => s.removeRotateMark);
  const selectMoveMark = useEditorStore((s) => s.selectMoveMark);
  const addMoveMark = useEditorStore((s) => s.addMoveMark);
  const updateMoveVector = useEditorStore((s) => s.updateMoveVector);
  const removeMoveMark = useEditorStore((s) => s.removeMoveMark);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredMoveAnchorId, setHoveredMoveAnchorId] = useState<string | null>(
    null
  );
  const [pasteToPlacePulse, setPasteToPlacePulse] = useState<{ x: number; y: number } | null>(
    null
  );
  const moveVectorDragRef = useRef<{
    id: string;
    anchor: { xNorm: number; yNorm: number };
  } | null>(null);

  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });
  const explicitFrameAspectRatio = getValidAspectRatio(frameAspectRatio);
  const shouldRenderPlaceholder = Boolean(placeholderImageUrl) && showPlaceholder;
  const isFinalLayerVisible = finalImageReady || (!isHydratingRoom && !showPlaceholder);
  const pinnedPlaceholderFrameSize = useMemo(() => {
    if (!explicitFrameAspectRatio) return null;
    let nextW = stageSize.w;
    let nextH = Math.round(nextW / explicitFrameAspectRatio);
    if (nextH > stageSize.h) {
      nextH = stageSize.h;
      nextW = Math.round(nextH * explicitFrameAspectRatio);
    }
    return {
      w: Math.max(1, nextW),
      h: Math.max(1, nextH),
    };
  }, [explicitFrameAspectRatio, stageSize.h, stageSize.w]);
  const shouldUsePinnedPlaceholderShell =
    shouldRenderPlaceholder && Boolean(pinnedPlaceholderFrameSize);
  const pinnedPlaceholderAspectRatio =
    shouldUsePinnedPlaceholderShell && explicitFrameAspectRatio
      ? explicitFrameAspectRatio
      : undefined;

  const [img, imageStatus] = useImage(canvasImageUrl ?? "", "anonymous");
  const [displayImage, setDisplayImage] = useState<HTMLImageElement | null>(null);
  const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (canvasImageUrl) return;
    setDisplayImage(null);
    setDisplayImageUrl(null);
  }, [canvasImageUrl]);

  useEffect(() => {
    if (!canvasImageUrl) return;
    if (imageStatus !== "loaded" || !img) return;
    setDisplayImage(img);
    setDisplayImageUrl(canvasImageUrl);
  }, [canvasImageUrl, imageStatus, img]);

  const loadedImageAspectRatio = useMemo(() => {
    if (imageStatus === "loaded" && img) {
      return getAspectRatioFromDimensions(img.width, img.height);
    }
    if (!displayImage) return null;
    if (canvasImageUrl && displayImageUrl !== canvasImageUrl) return null;
    return getAspectRatioFromDimensions(displayImage.width, displayImage.height);
  }, [canvasImageUrl, displayImage, displayImageUrl, imageStatus, img]);

  const sceneMetadataAspectRatio = useMemo(
    () => getAspectRatioFromDimensions(baseImageWidthPx, baseImageHeightPx),
    [baseImageHeightPx, baseImageWidthPx]
  );

  const normalizedFrameAspectRatio =
    explicitFrameAspectRatio ?? loadedImageAspectRatio ?? sceneMetadataAspectRatio ?? 1;

  useEffect(() => {
    if (!canvasImageUrl) return;
    logEditorCanvas("image-load-start", {
      instanceId,
      canvasImageUrl,
    });
  }, [canvasImageUrl, instanceId]);

  useEffect(() => {
    if (!canvasImageUrl) return;
    if (imageStatus === "loaded" && img) {
      logEditorCanvas("image-load-success", {
        instanceId,
        canvasImageUrl,
        naturalWidth: img.width,
        naturalHeight: img.height,
      });
      return;
    }
    if (imageStatus === "failed") {
      logEditorCanvas("image-load-failed", {
        instanceId,
        canvasImageUrl,
      });
    }
  }, [canvasImageUrl, imageStatus, img, instanceId]);

  const fit = useMemo(() => {
    if (!displayImage) return { x: 0, y: 0, w: stageSize.w, h: stageSize.h, scale: 1 };

    const iw = displayImage.width;
    const ih = displayImage.height;

    const s = Math.min(stageSize.w / iw, stageSize.h / ih);
    const w = iw * s;
    const h = ih * s;
    const x = (stageSize.w - w) / 2;
    const y = (stageSize.h - h) / 2;

    return { x, y, w, h, scale: s };
  }, [displayImage, stageSize.w, stageSize.h]);

  // Publish viewport mapping so Freeze can convert Stage coords -> Image pixel coords
  useEffect(() => {
    if (!displayImage) {
      setViewport(undefined);
      return;
    }

    setViewport({
      imageStageX: fit.x,
      imageStageY: fit.y,
      imageStageW: fit.w,
      imageStageH: fit.h,
      scale: fit.scale, // stage_px per image_px
      imageNaturalW: displayImage.width,
      imageNaturalH: displayImage.height,
    });
  }, [displayImage, fit.x, fit.y, fit.w, fit.h, fit.scale, setViewport]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const overlappingNodeIds = useMemo(() => {
    if (!viewport || nodes.length < 2) return new Set<string>();
    return computeOverlappingNodeIds(nodes, viewport);
  }, [nodes, viewport]);
  const pasteToPlaceProgressMessage = pasteToPlaceStatus
    ? PASTE_TO_PLACE_PROGRESS_COPY[pasteToPlaceStatus]
    : null;
  const pasteToPlaceMenuEstimatedHeight = pasteToPlaceMenuPreviewUrl
    ? PASTE_TO_PLACE_MENU_WITH_PREVIEW_ESTIMATED_HEIGHT_PX
    : PASTE_TO_PLACE_MENU_ESTIMATED_HEIGHT_PX;
  const clampedPasteToPlaceMenuPosition = useMemo(() => {
    if (!pasteToPlaceMenuState) return null;

    const requestedLeft = pasteToPlaceMenuState.anchorCssX + PASTE_TO_PLACE_MENU_OFFSET_PX;
    const requestedTop = pasteToPlaceMenuState.anchorCssY + PASTE_TO_PLACE_MENU_OFFSET_PX;

    const maxLeft = Math.max(
      PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX,
      stageSize.w - PASTE_TO_PLACE_MENU_ESTIMATED_WIDTH_PX - PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX
    );
    const maxTop = Math.max(
      PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX,
      stageSize.h - pasteToPlaceMenuEstimatedHeight - PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX
    );

    return {
      left: clamp(requestedLeft, PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX, maxLeft),
      top: clamp(requestedTop, PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX, maxTop),
    };
  }, [pasteToPlaceMenuEstimatedHeight, pasteToPlaceMenuState, stageSize.h, stageSize.w]);
  const clampedPasteToPlaceProgressCardPosition = useMemo(() => {
    if (!pasteToPlaceProgressCardState) return null;

    const requestedLeft = pasteToPlaceProgressCardState.anchorCssX + PASTE_TO_PLACE_MENU_OFFSET_PX;
    const requestedTop = pasteToPlaceProgressCardState.anchorCssY + PASTE_TO_PLACE_MENU_OFFSET_PX;
    const maxLeft = Math.max(
      PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX,
      stageSize.w - PASTE_TO_PLACE_MENU_ESTIMATED_WIDTH_PX - PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX
    );
    const maxTop = Math.max(
      PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX,
      stageSize.h -
        PASTE_TO_PLACE_PROGRESS_CARD_ESTIMATED_HEIGHT_PX -
        PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX
    );
    return {
      left: clamp(requestedLeft, PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX, maxLeft),
      top: clamp(requestedTop, PASTE_TO_PLACE_MENU_EDGE_GUTTER_PX, maxTop),
    };
  }, [pasteToPlaceProgressCardState, stageSize.h, stageSize.w]);

  const transformerRef = useRef<Konva.Transformer | null>(null);
  const selectedNodeRef = useRef<Konva.Group | null>(null);

  // Stage geometry is always full canvas. Room-open pinning only affects the placeholder shell.
  useEffect(() => {
    const el = outerShellRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const outerW = Math.max(1, Math.floor(cr.width));
      const outerH = Math.max(1, Math.floor(cr.height));
      setStageSize({
        w: outerW,
        h: outerH,
      });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Attach transformer to selected node (locked if marked for delete, and locked in calibrate mode)
  useEffect(() => {
    const tr = transformerRef.current;
    const node = selectedNodeRef.current;
    if (!tr) return;

    const selected = nodes.find((x) => x.id === selectedNodeId);

    if (
      activeTool === "calibrate" ||
      activeTool === "remove" ||
      activeTool === "swap" ||
      activeTool === "rotate" ||
      activeTool === "move" ||
      !node ||
      selected?.status === "markedForDelete"
    ) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }

    tr.nodes([node]);
    tr.getLayer()?.batchDraw();
  }, [selectedNodeId, nodes, activeTool]);

  // Keyboard shortcuts
  // Delete toggles "markedForDelete" (RED X workflow)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isSwapPickMode && onCancelSwapPickMode) {
          onCancelSwapPickMode();
          return;
        }
        if (pasteToPlaceMenuState && onDismissPasteToPlaceMenu) {
          onDismissPasteToPlaceMenu();
          return;
        }
        if (selectedSwapMarkId) {
          selectSwapMark(null);
          return;
        }
        if (selectedRemoveMarkId) {
          selectRemoveMark(null);
          return;
        }
        if (selectedRotateMarkId) {
          selectRotateMark(null);
          return;
        }
        if (selectedMoveMarkId) {
          selectMoveMark(null);
          return;
        }
        selectNode(null);
        return;
      }

      if (selectedSwapMarkId && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        removeSwapMark(selectedSwapMarkId);
        return;
      }

      if (selectedRemoveMarkId && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        removeRemoveMark(selectedRemoveMarkId);
        return;
      }

      if (selectedRotateMarkId && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        removeRotateMark(selectedRotateMarkId);
        return;
      }

      if (selectedMoveMarkId && (e.key === "Backspace" || e.key === "Delete")) {
        e.preventDefault();
        removeMoveMark(selectedMoveMarkId);
        return;
      }

      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        selectedNodeId &&
        activeTool !== "calibrate"
      ) {
        toggleDelete(selectedNodeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTool,
    removeMoveMark,
    removeRemoveMark,
    removeRotateMark,
    removeSwapMark,
    selectNode,
    selectMoveMark,
    selectRemoveMark,
    selectRotateMark,
    selectSwapMark,
    selectedMoveMarkId,
    selectedNodeId,
    selectedRemoveMarkId,
    selectedRotateMarkId,
    selectedSwapMarkId,
    pasteToPlaceMenuState,
    onDismissPasteToPlaceMenu,
    isSwapPickMode,
    onCancelSwapPickMode,
    toggleDelete,
  ]);

  function stagePointerToImage(
    stage: Konva.Stage,
    vp: NonNullable<typeof viewport>
  ) {
    const p = stage.getPointerPosition();
    if (!p) return null;
    const x = (p.x - vp.imageStageX) / vp.scale;
    const y = (p.y - vp.imageStageY) / vp.scale;
    return { x, y };
  }

  function eventPointerToContainerCss(
    evt: MouseEvent | TouchEvent,
    containerEl: HTMLDivElement
  ) {
    const rect = containerEl.getBoundingClientRect();
    const touchEvt = evt as TouchEvent;
    const touch = touchEvt.touches?.[0] ?? touchEvt.changedTouches?.[0];
    if (touch) {
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    const mouseEvt = evt as MouseEvent;
    return {
      x: mouseEvt.clientX - rect.left,
      y: mouseEvt.clientY - rect.top,
    };
  }

  function isInsideImage(
    ptImg: { x: number; y: number },
    vp: NonNullable<typeof viewport>
  ) {
    return (
      ptImg.x >= 0 &&
      ptImg.y >= 0 &&
      ptImg.x <= vp.imageNaturalW &&
      ptImg.y <= vp.imageNaturalH
    );
  }

  function clampToImage(
    ptImg: { x: number; y: number },
    vp: NonNullable<typeof viewport>
  ) {
    return {
      x: clamp(ptImg.x, 0, vp.imageNaturalW),
      y: clamp(ptImg.y, 0, vp.imageNaturalH),
    };
  }

  function imageToStage(
    pt: { x: number; y: number },
    vp: NonNullable<typeof viewport>
  ) {
    return {
      x: vp.imageStageX + pt.x * vp.scale,
      y: vp.imageStageY + pt.y * vp.scale,
    };
  }

  function stageToImage(
    pt: { x: number; y: number },
    vp: NonNullable<typeof viewport>
  ) {
    return {
      x: (pt.x - vp.imageStageX) / vp.scale,
      y: (pt.y - vp.imageStageY) / vp.scale,
    };
  }

  function imageToNormalized(
    pt: { x: number; y: number },
    vp: NonNullable<typeof viewport>
  ) {
    return {
      x: vp.imageNaturalW > 0 ? clamp(pt.x / vp.imageNaturalW, 0, 1) : 0,
      y: vp.imageNaturalH > 0 ? clamp(pt.y / vp.imageNaturalH, 0, 1) : 0,
    };
  }

  function findMoveAnchorHit(
    stagePt: { x: number; y: number },
    vp: NonNullable<typeof viewport>
  ) {
    const hitRadiusSq = MOVE_MARK_HIT_STAGE_RADIUS * MOVE_MARK_HIT_STAGE_RADIUS;
    let best:
      | {
          id: string;
          xNorm: number;
          yNorm: number;
          distSq: number;
        }
      | null = null;

    for (const mark of moveMarks) {
      const anchorImg = {
        x: clamp(mark.xNorm, 0, 1) * vp.imageNaturalW,
        y: clamp(mark.yNorm, 0, 1) * vp.imageNaturalH,
      };
      const anchorStage = imageToStage(anchorImg, vp);
      const dx = stagePt.x - anchorStage.x;
      const dy = stagePt.y - anchorStage.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= hitRadiusSq && (!best || distSq < best.distSq)) {
        best = {
          id: mark.id,
          xNorm: mark.xNorm,
          yNorm: mark.yNorm,
          distSq,
        };
      }
    }

    return best;
  }

  const clearMoveVectorDrag = () => {
    moveVectorDragRef.current = null;
  };

  const updateMoveVectorDrag = (
    stage: Konva.Stage,
    nativeEvt: MouseEvent | TouchEvent
  ) => {
    if (activeTool !== "move" || !viewport) return;
    const drag = moveVectorDragRef.current;
    if (!drag) return;

    const imgPt0 = stagePointerToImage(stage, viewport);
    if (!imgPt0) return;

    const imgPt = clampToImage(imgPt0, viewport);
    const ptNorm = imageToNormalized(imgPt, viewport);

    let dxNorm = ptNorm.x - drag.anchor.xNorm;
    let dyNorm = ptNorm.y - drag.anchor.yNorm;
    if ("shiftKey" in nativeEvt && nativeEvt.shiftKey) {
      if (Math.abs(dxNorm) >= Math.abs(dyNorm)) dyNorm = 0;
      else dxNorm = 0;
    }

    updateMoveVector(drag.id, dxNorm, dyNorm);
  };

  const calP1 = calibration?.draft?.p1;
  const calP2 = calibration?.draft?.p2;

  const preview = useMemo(() => {
    if (!calP1 || !calP2) return null;
    const feet = calibration?.draft?.realFeet ?? 0;

    const dx = calP2.x - calP1.x;
    const dy = calP2.y - calP1.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);

    const ppfPreview = feet > 0 ? distPx / feet : null;

    return { distPx, feet, ppf: ppfPreview };
  }, [calP1, calP2, calibration?.draft?.realFeet]);

  useEffect(() => {
    if (activeTool !== "move") {
      clearMoveVectorDrag();
      if (hoveredMoveAnchorId) setHoveredMoveAnchorId(null);
    }
  }, [activeTool, hoveredMoveAnchorId]);

  useEffect(() => {
    if (!pasteToPlacePulse) return;
    const timeoutId = window.setTimeout(() => {
      setPasteToPlacePulse(null);
    }, PASTE_TO_PLACE_PULSE_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [pasteToPlacePulse]);

  const handleStagePointerDown = async (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (isSwapPickMode && onSwapPickPoint) {
      if (!viewport) return;
      const imgPt0 = stagePointerToImage(stage, viewport);
      if (!imgPt0) return;
      if (!isInsideImage(imgPt0, viewport)) return;

      const imgPt = clampToImage(imgPt0, viewport);
      const ptNorm = imageToNormalized(imgPt, viewport);
      onSwapPickPoint({ xNorm: ptNorm.x, yNorm: ptNorm.y });
      return;
    }

    // Calibration tool intercepts clicks
    if (activeTool === "calibrate") {
      if (!viewport) return;

      const imgPt0 = stagePointerToImage(stage, viewport);
      if (!imgPt0) return;

      // Ignore clicks outside the base image bounds
      if (!isInsideImage(imgPt0, viewport)) return;

      const imgPt = clampToImage(imgPt0, viewport);

      // Point picking logic:
      // click1: set p1
      // click2: set p2
      // click3: start over (new p1)
      if (!calP1) {
        setCalibrationPoint(1, imgPt);
      } else if (calP1 && !calP2) {
        setCalibrationPoint(2, imgPt);
      } else {
        clearCalibrationDraft();
        setCalibrationPoint(1, imgPt);
      }
      return;
    }

    // Remove tool: place red X mark on image
    if (activeTool === "remove") {
      if (!viewport) return;
      if (e.target !== stage) return;

      const imgPt0 = stagePointerToImage(stage, viewport);
      if (!imgPt0) return;

      if (!isInsideImage(imgPt0, viewport)) return;

      const imgPt = clampToImage(imgPt0, viewport);
      const rImage = REMOVE_MARK_STAGE_RADIUS / viewport.scale;
      addRemoveMark(imgPt, rImage);
      return;
    }

    // Swap tool: place swap mark on image
    if (activeTool === "swap") {
      if (!viewport) return;
      if (e.target !== stage) return;

      const imgPt0 = stagePointerToImage(stage, viewport);
      if (!imgPt0) return;

      if (!isInsideImage(imgPt0, viewport)) return;

      const imgPt = clampToImage(imgPt0, viewport);
      addSwapMark(imgPt);
      return;
    }

    // Rotate tool: place rotate mark in normalized image-space [0..1]
    if (activeTool === "rotate") {
      if (!viewport) return;
      if (e.target !== stage) return;

      const imgPt0 = stagePointerToImage(stage, viewport);
      if (!imgPt0) return;

      if (!isInsideImage(imgPt0, viewport)) return;

      const imgPt = clampToImage(imgPt0, viewport);
      const ptNormalized = imageToNormalized(imgPt, viewport);
      addRotateMark(ptNormalized);
      return;
    }

    // Move tool: place/select anchor, then drag to set translation vector.
    if (activeTool === "move") {
      if (!viewport) return;

      const stagePt = stage.getPointerPosition();
      if (!stagePt) return;

      const hit = findMoveAnchorHit(stagePt, viewport);
      if (hit) {
        selectMoveMark(hit.id);
        moveVectorDragRef.current = {
          id: hit.id,
          anchor: { xNorm: hit.xNorm, yNorm: hit.yNorm },
        };
        return;
      }

      if (e.target !== stage) return;

      const imgPt0 = stagePointerToImage(stage, viewport);
      if (!imgPt0) return;
      if (!isInsideImage(imgPt0, viewport)) return;

      const imgPt = clampToImage(imgPt0, viewport);
      const ptNorm = imageToNormalized(imgPt, viewport);
      addMoveMark(ptNorm);

      const createdMoveId = useEditorStore.getState().ui.selectedMoveMarkId;
      if (createdMoveId) {
        moveVectorDragRef.current = {
          id: createdMoveId,
          anchor: { xNorm: ptNorm.x, yNorm: ptNorm.y },
        };
      }
      return;
    }

    const clickedOnEmpty = e.target === stage;
    if (clickedOnEmpty && viewport && onOpenPasteToPlaceMenu) {
      const imgPt0 = stagePointerToImage(stage, viewport);
      if (imgPt0 && isInsideImage(imgPt0, viewport)) {
        const imgPt = clampToImage(imgPt0, viewport);
        const ptNorm = imageToNormalized(imgPt, viewport);
        const containerEl = containerRef.current;
        if (containerEl) {
          const pointerCssPt = eventPointerToContainerCss(e.evt, containerEl);
          setPasteToPlacePulse(pointerCssPt);

          onOpenPasteToPlaceMenu({
            xNorm: ptNorm.x,
            yNorm: ptNorm.y,
            anchorCssX: pointerCssPt.x,
            anchorCssY: pointerCssPt.y,
          });

          return;
        }

        // Fallback path if container ref is temporarily unavailable.
        const pulseStagePt = imageToStage(imgPt, viewport);
        setPasteToPlacePulse(pulseStagePt);
        onOpenPasteToPlaceMenu({
          xNorm: ptNorm.x,
          yNorm: ptNorm.y,
          anchorCssX: pulseStagePt.x,
          anchorCssY: pulseStagePt.y,
        });
        return;
      }
    }
    if (clickedOnEmpty) selectNode(null);
  };

  const handleStagePointerMove = (
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>
  ) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (activeTool !== "move" || !viewport) {
      if (hoveredMoveAnchorId) setHoveredMoveAnchorId(null);
      return;
    }

    const stagePt = stage.getPointerPosition();
    if (!stagePt) {
      if (hoveredMoveAnchorId) setHoveredMoveAnchorId(null);
      return;
    }

    const hit = findMoveAnchorHit(stagePt, viewport);
    const hitId = hit?.id ?? null;
    if (hitId !== hoveredMoveAnchorId) setHoveredMoveAnchorId(hitId);

    updateMoveVectorDrag(stage, e.evt);
  };

  const handleStagePointerUp = () => {
    clearMoveVectorDrag();
  };

  return (
    <div
      className={className}
      style={{
        cursor:
          isSwapPickMode
            ? "copy"
            : activeTool === "move"
            ? hoveredMoveAnchorId
              ? "pointer"
              : "crosshair"
            : undefined,
      }}
    >
      <div ref={outerShellRef} className="relative h-full w-full">
        <div
          ref={containerRef}
          className="absolute inset-0 overflow-hidden bg-neutral-950"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();

            // Do not allow dropping furniture while calibrating or in remove mode
            if (
              activeTool === "calibrate" ||
              activeTool === "remove" ||
              activeTool === "swap" ||
              activeTool === "rotate" ||
              activeTool === "move"
            ) {
              return;
            }

            const raw = e.dataTransfer.getData(DND_MIME);
            if (!raw) return;

            let payload: DragFurniturePayload | null = null;
            try {
              payload = JSON.parse(raw) as DragFurniturePayload;
            } catch {
              return;
            }
            if (!payload?.skuId) return;

            const sku = findSkuById(payload.skuId);
            if (!sku) return;

            const el = containerRef.current;
            if (!el) return;

            const rect = el.getBoundingClientRect();
            const dropX = e.clientX - rect.left;
            const dropY = e.clientY - rect.top;

            // Scale-aware drag defaults:
            // NOTE: ppf is in IMAGE px/ft, but nodes live in STAGE px.
            // Convert to stage px/ft using viewport.scale (stage_px per image_px).
            const stagePpf = ppf && viewport ? ppf * viewport.scale : null;

            const derivedW =
              stagePpf && sku.realWidthFt
                ? Math.round(sku.realWidthFt * stagePpf)
                : sku.defaultPxWidth;

            const derivedH =
              stagePpf && sku.realDepthFt
                ? Math.round(sku.realDepthFt * stagePpf)
                : sku.defaultPxHeight;

            addNode({
              skuId: sku.skuId,
              label: sku.label,
              status: "active",
              zIndex: 9999, // store will normalize zIndex; this is just a hint
              transform: {
                x: Math.max(0, dropX - derivedW / 2),
                y: Math.max(0, dropY - derivedH / 2),
                width: derivedW,
                height: derivedH,
                rotation: 0,
              },
            });
          }}
        >
          <div className="relative h-full w-full">
          {shouldRenderPlaceholder && placeholderImageUrl && (
            <div
              className={`pointer-events-none absolute inset-0 z-0 transition-opacity duration-200 ease-out ${
                finalImageReady ? "opacity-0" : "opacity-100"
              }`}
            >
              <div className="absolute inset-0 bg-neutral-900" />
              <div
                className={
                  shouldUsePinnedPlaceholderShell
                    ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-neutral-950"
                    : "absolute inset-0 overflow-hidden bg-neutral-950"
                }
                style={{
                  width: shouldUsePinnedPlaceholderShell ? pinnedPlaceholderFrameSize?.w : "100%",
                  height: shouldUsePinnedPlaceholderShell ? pinnedPlaceholderFrameSize?.h : "100%",
                  aspectRatio: pinnedPlaceholderAspectRatio,
                }}
              >
                <img
                  src={placeholderImageUrl}
                  alt=""
                  className="h-full w-full object-contain blur-lg saturate-75 opacity-80"
                  draggable={false}
                />
              </div>
              <div className="absolute inset-0 bg-neutral-950/35" />
            </div>
          )}

          <div
            className={`relative z-10 h-full w-full transition-opacity duration-200 ease-out ${
              isFinalLayerVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <Stage
              width={stageSize.w}
              height={stageSize.h}
              onMouseDown={handleStagePointerDown}
              onTap={handleStagePointerDown}
              onMouseMove={handleStagePointerMove}
              onTouchMove={handleStagePointerMove}
              onMouseUp={handleStagePointerUp}
              onTouchEnd={handleStagePointerUp}
              onMouseLeave={handleStagePointerUp}
            >
        <Layer>
          {/* Matte */}
          <Rect
            x={0}
            y={0}
            width={stageSize.w}
            height={stageSize.h}
            fill="#0a0a0a"
            listening={false}
          />

          {/* Base image (scaled to fit) */}
          {displayImage ? (
            <KonvaImage
              image={displayImage}
              x={fit.x}
              y={fit.y}
              width={fit.w}
              height={fit.h}
              opacity={canvasImageUrl && displayImageUrl !== canvasImageUrl ? 0.96 : 1}
              listening={false}
            />
          ) : (
            <Text
              text="Upload a room photo to begin"
              x={24}
              y={24}
              fontSize={14}
              fill="#9ca3af"
              listening={false}
            />
          )}

          {/* Calibration overlay (image-anchored) */}
          {activeTool === "calibrate" && viewport && calP1 && (
            <Group>
              {(() => {
                const p1s = imageToStage(calP1, viewport);
                const p2s = calP2 ? imageToStage(calP2, viewport) : null;

                return (
                  <>
                    {/* Point 1 */}
                    <Circle x={p1s.x} y={p1s.y} radius={6} fill="#dc2626" />
                    <Circle
                      x={p1s.x}
                      y={p1s.y}
                      radius={12}
                      stroke="#dc2626"
                      strokeWidth={2}
                    />

                    {/* Point 2 + line */}
                    {p2s && (
                      <>
                        <Circle x={p2s.x} y={p2s.y} radius={6} fill="#dc2626" />
                        <Circle
                          x={p2s.x}
                          y={p2s.y}
                          radius={12}
                          stroke="#dc2626"
                          strokeWidth={2}
                        />
                        <Line
                          points={[p1s.x, p1s.y, p2s.x, p2s.y]}
                          stroke="#dc2626"
                          strokeWidth={3}
                          lineCap="round"
                        />

                        {/* Inline label near midpoint */}
                        {preview && (
                          <Group
                            x={(p1s.x + p2s.x) / 2 + 8}
                            y={(p1s.y + p2s.y) / 2 - 10}
                          >
                            <Rect
                              width={170}
                              height={18}
                              fill="#111827"
                              opacity={0.85}
                              cornerRadius={6}
                            />
                            <Text
                              text={`${preview.distPx.toFixed(0)}px • ${preview.feet.toFixed(
                                2
                              )}ft • ${
                                preview.ppf ? preview.ppf.toFixed(2) : "—"
                              } px/ft`}
                              x={8}
                              y={4}
                              fontSize={10}
                              fill="#e5e7eb"
                              listening={false}
                            />
                          </Group>
                        )}
                      </>
                    )}

                    {/* Hint text */}
                    <Text
                      text={calP2 ? "Press Apply to set scale" : "Click point 2"}
                      x={viewport.imageStageX + 12}
                      y={viewport.imageStageY + 12}
                      fontSize={12}
                      fill="#e5e7eb"
                      listening={false}
                    />
                  </>
                );
              })()}
            </Group>
          )}

          {/* Remove marks (red X) overlay */}
          {viewport && removeMarks.length > 0 && (
            <Group>
              {removeMarks.map((m) => {
                const center = imageToStage({ x: m.x, y: m.y }, viewport);
                const rStage = m.r * viewport.scale;
                const x1 = -rStage;
                const y1 = -rStage;
                const x2 = rStage;
                const y2 = rStage;
                const isSelected = m.id === selectedRemoveMarkId;
                const commitDragPoint = (stageX: number, stageY: number) => {
                  const imgPt = clampToImage(stageToImage({ x: stageX, y: stageY }, viewport), viewport);
                  updateRemoveMark(m.id, imgPt);
                };
                return (
                  <Group
                    key={m.id}
                    x={center.x}
                    y={center.y}
                    draggable={activeTool === "remove"}
                    dragBoundFunc={(pos) => {
                      const imgPt = clampToImage(stageToImage(pos, viewport), viewport);
                      return imageToStage(imgPt, viewport);
                    }}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onTouchStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (activeTool !== "remove") return;
                      if (e.evt.altKey || e.evt.metaKey) {
                        removeRemoveMark(m.id);
                        return;
                      }
                      selectRemoveMark(m.id);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      if (activeTool !== "remove") return;
                      selectRemoveMark(m.id);
                    }}
                    onDragEnd={(e) => {
                      if (activeTool !== "remove") return;
                      const pos = e.target.getAbsolutePosition();
                      commitDragPoint(pos.x, pos.y);
                    }}
                  >
                    {isSelected && (
                      <Circle
                        x={0}
                        y={0}
                        radius={rStage + 4}
                        stroke="#fca5a5"
                        strokeWidth={Math.max(1.5, 2 * viewport.scale)}
                      />
                    )}
                    <Line
                      points={[x1, y1, x2, y2]}
                      stroke="#dc2626"
                      strokeWidth={Math.max(2, 3 * viewport.scale)}
                      lineCap="round"
                    />
                    <Line
                      points={[x1, y2, x2, y1]}
                      stroke="#dc2626"
                      strokeWidth={Math.max(2, 3 * viewport.scale)}
                      lineCap="round"
                    />
                    {m.labelIndex != null && m.labelIndex > 0 && (
                      <Text
                        x={rStage + 4}
                        y={-8}
                        text={String(m.labelIndex)}
                        fontSize={Math.max(10, 12 * viewport.scale)}
                        fill="#dc2626"
                      />
                    )}
                  </Group>
                );
              })}
            </Group>
          )}

          {/* Swap marks overlay */}
          {viewport && swapMarks.length > 0 && (
            <Group>
              {swapMarks.map((m) => {
                const center = imageToStage(
                  { x: m.ptImage.x, y: m.ptImage.y },
                  viewport
                );
                const isSelected = m.id === selectedSwapMarkId;
                const hasReplacement = !!m.replacement;
                const commitDragPoint = (stageX: number, stageY: number) => {
                  const imgPt = clampToImage(
                    stageToImage({ x: stageX, y: stageY }, viewport),
                    viewport
                  );
                  updateSwapMark(m.id, imgPt);
                };

                return (
                  <Group
                    key={m.id}
                    x={center.x}
                    y={center.y}
                    draggable={activeTool === "swap"}
                    dragBoundFunc={(pos) => {
                      const imgPt = clampToImage(stageToImage(pos, viewport), viewport);
                      return imageToStage(imgPt, viewport);
                    }}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onTouchStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (activeTool !== "swap") return;
                      selectSwapMark(m.id);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      if (activeTool !== "swap") return;
                      selectSwapMark(m.id);
                    }}
                    onDragEnd={(e) => {
                      if (activeTool !== "swap") return;
                      const pos = e.target.getAbsolutePosition();
                      commitDragPoint(pos.x, pos.y);
                    }}
                  >
                    {isSelected && (
                      <Circle
                        x={0}
                        y={0}
                        radius={SWAP_MARK_STAGE_RADIUS + 4}
                        stroke="#93c5fd"
                        strokeWidth={2}
                      />
                    )}
                    <Circle
                      x={0}
                      y={0}
                      radius={SWAP_MARK_STAGE_RADIUS}
                      fill={hasReplacement ? "#2563eb" : "rgba(17, 24, 39, 0.35)"}
                      stroke={hasReplacement ? "#dbeafe" : "#bfdbfe"}
                      strokeWidth={2}
                      dash={hasReplacement ? undefined : [4, 3]}
                      shadowColor="#000"
                      shadowBlur={6}
                      shadowOpacity={0.35}
                    />
                    <Text
                      x={-6}
                      y={-8}
                      text={hasReplacement ? "⇄" : "?"}
                      fontSize={14}
                      fontStyle="bold"
                      fill="#f8fafc"
                      listening={false}
                    />
                  </Group>
                );
              })}
            </Group>
          )}

          {/* Rotate marks overlay */}
          {viewport && rotateMarks.length > 0 && (
            <Group>
              {rotateMarks.map((m) => {
                const imgPt = {
                  x: clamp(m.x, 0, 1) * viewport.imageNaturalW,
                  y: clamp(m.y, 0, 1) * viewport.imageNaturalH,
                };
                const center = imageToStage(imgPt, viewport);
                const isSelected = m.id === selectedRotateMarkId;
                const theta = (m.angleDeg * Math.PI) / 180;
                const pointerLength = ROTATE_MARK_STAGE_RADIUS - 5;
                const px = Math.cos(theta) * pointerLength;
                const py = Math.sin(theta) * pointerLength;

                const commitDragPoint = (stageX: number, stageY: number) => {
                  const nextImg = clampToImage(stageToImage({ x: stageX, y: stageY }, viewport), viewport);
                  updateRotateMark(m.id, {
                    ptImage: {
                      x:
                        viewport.imageNaturalW > 0
                          ? clamp(nextImg.x / viewport.imageNaturalW, 0, 1)
                          : 0,
                      y:
                        viewport.imageNaturalH > 0
                          ? clamp(nextImg.y / viewport.imageNaturalH, 0, 1)
                          : 0,
                    },
                  });
                };

                return (
                  <Group
                    key={m.id}
                    x={center.x}
                    y={center.y}
                    draggable={activeTool === "rotate"}
                    dragBoundFunc={(pos) => {
                      const nextImg = clampToImage(stageToImage(pos, viewport), viewport);
                      return imageToStage(nextImg, viewport);
                    }}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                    }}
                    onTouchStart={(e) => {
                      e.cancelBubble = true;
                    }}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (activeTool !== "rotate") return;
                      selectRotateMark(m.id);
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true;
                      if (activeTool !== "rotate") return;
                      selectRotateMark(m.id);
                    }}
                    onDragEnd={(e) => {
                      if (activeTool !== "rotate") return;
                      const pos = e.target.getAbsolutePosition();
                      commitDragPoint(pos.x, pos.y);
                    }}
                  >
                    {isSelected && (
                      <Circle
                        x={0}
                        y={0}
                        radius={ROTATE_MARK_STAGE_RADIUS + 4}
                        stroke="#ddd6fe"
                        strokeWidth={2}
                      />
                    )}
                    <Circle
                      x={0}
                      y={0}
                      radius={ROTATE_MARK_STAGE_RADIUS}
                      fill="rgba(76, 29, 149, 0.35)"
                      stroke="#c4b5fd"
                      strokeWidth={2}
                      shadowColor="#000"
                      shadowBlur={6}
                      shadowOpacity={0.35}
                    />
                    <Line
                      points={[0, 0, px, py]}
                      stroke="#f5f3ff"
                      strokeWidth={2}
                      lineCap="round"
                    />
                    <Circle x={px} y={py} radius={3.5} fill="#f5f3ff" />
                    <Text
                      x={-5}
                      y={-8}
                      text="R"
                      fontSize={13}
                      fontStyle="bold"
                      fill="#ede9fe"
                      listening={false}
                    />
                  </Group>
                );
              })}
            </Group>
          )}

          {/* Move marks overlay */}
          {viewport && moveMarks.length > 0 && (
            <Group listening={false}>
              {moveMarks.map((m) => {
                const anchorImg = {
                  x: clamp(m.xNorm, 0, 1) * viewport.imageNaturalW,
                  y: clamp(m.yNorm, 0, 1) * viewport.imageNaturalH,
                };
                const endImg = {
                  x: clamp(m.xNorm + m.dxNorm, 0, 1) * viewport.imageNaturalW,
                  y: clamp(m.yNorm + m.dyNorm, 0, 1) * viewport.imageNaturalH,
                };
                const anchor = imageToStage(anchorImg, viewport);
                const end = imageToStage(endImg, viewport);
                const isSelected = m.id === selectedMoveMarkId;

                const vx = end.x - anchor.x;
                const vy = end.y - anchor.y;
                const vLen = Math.hypot(vx, vy);
                const ux = vLen > 0.001 ? vx / vLen : 1;
                const uy = vLen > 0.001 ? vy / vLen : 0;

                const angle = Math.PI / 7;
                const cosA = Math.cos(angle);
                const sinA = Math.sin(angle);
                const lx = ux * cosA - uy * sinA;
                const ly = ux * sinA + uy * cosA;
                const rx = ux * cosA + uy * sinA;
                const ry = -ux * sinA + uy * cosA;

                const leftHead = {
                  x: end.x - lx * MOVE_MARK_ARROW_HEAD_SIZE,
                  y: end.y - ly * MOVE_MARK_ARROW_HEAD_SIZE,
                };
                const rightHead = {
                  x: end.x - rx * MOVE_MARK_ARROW_HEAD_SIZE,
                  y: end.y - ry * MOVE_MARK_ARROW_HEAD_SIZE,
                };

                return (
                  <Group key={m.id}>
                    <Line
                      points={[anchor.x, anchor.y, end.x, end.y]}
                      stroke={MOVE_MARK_ARROW_STROKE}
                      strokeWidth={isSelected ? 3.5 : 2.5}
                      lineCap="round"
                      lineJoin="round"
                    />
                    {vLen > 0.001 && (
                      <Line
                        points={[
                          leftHead.x,
                          leftHead.y,
                          end.x,
                          end.y,
                          rightHead.x,
                          rightHead.y,
                        ]}
                        stroke={MOVE_MARK_ARROW_STROKE}
                        strokeWidth={isSelected ? 3.5 : 2.5}
                        lineCap="round"
                        lineJoin="round"
                      />
                    )}
                    {isSelected && (
                      <Circle
                        x={anchor.x}
                        y={anchor.y}
                        radius={MOVE_MARK_ANCHOR_RADIUS + 6}
                        stroke="#67e8f9"
                        strokeWidth={2}
                      />
                    )}
                    <Circle
                      x={anchor.x}
                      y={anchor.y}
                      radius={MOVE_MARK_ANCHOR_RADIUS + 2}
                      fill="#ffffff"
                    />
                    <Circle
                      x={anchor.x}
                      y={anchor.y}
                      radius={MOVE_MARK_ANCHOR_RADIUS}
                      fill={MOVE_MARK_ANCHOR_FILL}
                      stroke="#ffffff"
                      strokeWidth={1}
                    />
                  </Group>
                );
              })}
            </Group>
          )}

          {/* Render nodes in z-order */}
          {[...nodes]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((n) => {
              const isRemoveMarkerSku = n.skuId === "__remove_marker__";
              const isSelected = n.id === selectedNodeId;
              const isHovered = hoveredId === n.id;
              const isCalibrate = activeTool === "calibrate";
              const showBadges = markupVisible && (isSelected || isHovered) && !isCalibrate;

              const t = n.transform;
              const cx = t.width / 2;
              const cy = t.height / 2;
              const padding = Math.max(4, Math.min(12, Math.min(t.width, t.height) * 0.08));
              const innerW = t.width - padding * 2;
              const innerH = t.height - padding * 2;
              const canRenderVisuals = innerW > 6 && innerH > 6;
              const kind = inferSilhouetteKind(n);
              const thumbnailUrl = n.imageUrl;
              const resolvedThumbnailUrl =
                thumbnailUrl?.includes("ikea.com") && thumbnailUrl
                  ? `/api/img?url=${encodeURIComponent(thumbnailUrl)}`
                  : thumbnailUrl;
              const showThumbnail =
                !!resolvedThumbnailUrl &&
                (visualMode === "thumbnails" ||
                  (visualMode === "blueprint" && (isHovered || isSelected)));
              const thumbnailOpacity = visualMode === "thumbnails" ? 0.35 : 0.4;
              const silhouetteOpacity =
                visualMode === "thumbnails" ? 0.06 : showThumbnail ? 0.1 : 0.2;
              const baseFillOpacity =
                visualMode === "blueprint" ? (isSelected ? 0.82 : 0.7) : 1;
              const nodeOpacity = n.status === "markedForDelete" ? 0.35 : baseFillOpacity;
              const removeMarkerRadius = Math.max(18, Math.min(t.width, t.height) * 0.34);

              return (
                <Group
                  key={n.id}
                  ref={isSelected ? selectedNodeRef : undefined}
                  x={t.x + cx}
                  y={t.y + cy}
                  rotation={t.rotation}
                  offsetX={cx}
                  offsetY={cy}
                  draggable={
                    activeTool !== "calibrate" && n.status !== "markedForDelete"
                  }
                  onMouseEnter={() => setHoveredId(n.id)}
                  onMouseLeave={() =>
                    setHoveredId((cur) => (cur === n.id ? null : cur))
                  }
                  onClick={() => {
                    if (activeTool === "calibrate") return;
                    selectNode(n.id);
                  }}
                  onTap={() => {
                    if (activeTool === "calibrate") return;
                    selectNode(n.id);
                  }}
                  onDragEnd={(e) => {
                    if (activeTool === "calibrate") return;
                    const node = e.target as Konva.Group;
                    updateNodeTransform(n.id, {
                      x: node.x() - t.width / 2,
                      y: node.y() - t.height / 2,
                    });
                  }}
                  onTransformEnd={(e) => {
                    if (activeTool === "calibrate") return;

                    const node = e.target as Konva.Group;

                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();

                    // Prevent compounding transforms
                    node.scaleX(1);
                    node.scaleY(1);

                    const newW = Math.max(20, t.width * scaleX);
                    const newH = Math.max(20, t.height * scaleY);

                    updateNodeTransform(n.id, {
                      x: node.x() - newW / 2,
                      y: node.y() - newH / 2,
                      rotation: node.rotation(),
                      width: newW,
                      height: newH,
                    });
                  }}
                >
                  <Rect
                    x={0}
                    y={0}
                    width={t.width}
                    height={t.height}
                    fill={isRemoveMarkerSku ? "rgba(15, 23, 42, 0.28)" : "#1f2937"}
                    opacity={nodeOpacity}
                    stroke={isRemoveMarkerSku ? (isSelected ? "#fecaca" : "#ef4444") : isSelected ? "#e5e7eb" : "#374151"}
                    strokeWidth={isSelected ? 2 : 1}
                  />

                  {isRemoveMarkerSku && (
                    <Group listening={false}>
                      <Circle
                        x={cx}
                        y={cy}
                        radius={removeMarkerRadius}
                        fill="rgba(15, 23, 42, 0.58)"
                        stroke="#fca5a5"
                        strokeWidth={Math.max(2, Math.min(4, removeMarkerRadius * 0.12))}
                        shadowColor="#000"
                        shadowBlur={8}
                        shadowOpacity={0.35}
                      />
                      <Text
                        text="✕"
                        x={cx - removeMarkerRadius}
                        y={cy - removeMarkerRadius}
                        width={removeMarkerRadius * 2}
                        height={removeMarkerRadius * 2}
                        align="center"
                        verticalAlign="middle"
                        fontSize={Math.max(26, removeMarkerRadius * 1.4)}
                        fontStyle="bold"
                        fill="#ef4444"
                      />
                    </Group>
                  )}

                  {/* Overlap warning badge — top-right, hidden during calibrate */}
                  {markupVisible && !isCalibrate && overlappingNodeIds.has(n.id) && (
                    <Group
                      x={t.width - 28}
                      y={12}
                      listening={false}
                    >
                      <Rect
                        width={18}
                        height={18}
                        x={-9}
                        y={-9}
                        fill="#f59e0b"
                        cornerRadius={4}
                        opacity={0.95}
                      />
                      <Text
                        text="⚠"
                        x={-7}
                        y={-10}
                        fontSize={14}
                        fill="#fff"
                        align="center"
                        listening={false}
                      />
                    </Group>
                  )}

                  {!isRemoveMarkerSku && canRenderVisuals && (
                    <>
                      <SilhouetteLayer
                        kind={kind}
                        x={padding}
                        y={padding}
                        width={innerW}
                        height={innerH}
                        opacity={silhouetteOpacity}
                      />
                      {showThumbnail && resolvedThumbnailUrl && (
                        <ThumbnailLayer
                          url={resolvedThumbnailUrl}
                          x={padding}
                          y={padding}
                          width={innerW}
                          height={innerH}
                          opacity={thumbnailOpacity}
                        />
                      )}
                    </>
                  )}

                  {/* Vibode vibe-flow overlays */}
                  {showBadges && (
                    <Group>
                      {/* RED X (delete/restore toggle) — top-left */}
                      <Group
                        x={12}
                        y={12}
                        onMouseDown={(e) => {
                          e.cancelBubble = true;
                        }}
                        onClick={() => {
                          if (markupVisible) {
                            deleteNode(n.id);
                          } else {
                            toggleDelete(n.id);
                          }
                        }}
                        onTap={() => {
                          if (markupVisible) {
                            deleteNode(n.id);
                          } else {
                            toggleDelete(n.id);
                          }
                        }}
                      >
                        <Circle radius={11} fill="#dc2626" />
                        <Line
                          points={[-5, -5, 5, 5]}
                          stroke="#fff"
                          strokeWidth={2.5}
                          lineCap="round"
                        />
                        <Line
                          points={[-5, 5, 5, -5]}
                          stroke="#fff"
                          strokeWidth={2.5}
                          lineCap="round"
                        />
                      </Group>

                      {/* RED CIRCLE (swap) — top-right */}
                      <Group
                        x={t.width - 12}
                        y={12}
                        onMouseDown={(e) => {
                          e.cancelBubble = true;
                        }}
                        onClick={() => {
                          selectNode(n.id);
                          setPendingSwap(n.id, true);
                          onRequestSwap?.(n.id);
                        }}
                        onTap={() => {
                          selectNode(n.id);
                          setPendingSwap(n.id, true);
                          onRequestSwap?.(n.id);
                        }}
                      >
                        <Circle
                          radius={11}
                          fill={
                            n.status === "pendingSwap" ? "#dc2626" : "transparent"
                          }
                          stroke="#dc2626"
                          strokeWidth={2.5}
                        />
                      </Group>

                      {/* Marked-for-delete hint */}
                      {n.status === "markedForDelete" && (
                        <Group x={12} y={t.height - 18}>
                          <Rect
                            width={150}
                            height={16}
                            fill="#991b1b"
                            cornerRadius={6}
                            opacity={0.92}
                          />
                          <Text
                            text="Queued for removal"
                            x={8}
                            y={2}
                            fontSize={10}
                            fill="#fff"
                            listening={false}
                          />
                        </Group>
                      )}
                    </Group>
                  )}
                </Group>
              );
            })}

          <Transformer
            ref={transformerRef}
            rotateEnabled
            enabledAnchors={[
              "top-left",
              "top-right",
              "bottom-left",
              "bottom-right",
              "middle-left",
              "middle-right",
              "top-center",
              "bottom-center",
            ]}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 20 || newBox.height < 20) return oldBox;
              return newBox;
            }}
          />
        </Layer>
      </Stage>
          </div>

      {pasteToPlacePulse && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pasteToPlacePulse.x}px`, top: `${pasteToPlacePulse.y}px` }}
          aria-hidden="true"
        >
          <div className="paste-to-place-pulse-ring" />
        </div>
      )}

      {pasteToPlaceProgressMessage && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-white/15 bg-neutral-950/75 px-3 py-1.5 text-xs font-medium text-neutral-100 shadow-[0_8px_20px_rgba(0,0,0,0.35)] backdrop-blur-sm">
            <span className="h-3 w-3 animate-spin rounded-full border border-neutral-300/80 border-t-transparent" />
            <span>{pasteToPlaceProgressMessage}</span>
          </div>
        </div>
      )}

      {pasteToPlaceMenuState && onDismissPasteToPlaceMenu && (
        <button
          type="button"
          aria-label="Dismiss Paste-to-Place menu"
          className="absolute inset-0 z-20 bg-transparent"
          onClick={onDismissPasteToPlaceMenu}
        />
      )}
      {pasteToPlaceMenuState && (
        <div
          className="absolute z-30"
          style={{
            left:
              clampedPasteToPlaceMenuPosition?.left ??
              pasteToPlaceMenuState.anchorCssX + PASTE_TO_PLACE_MENU_OFFSET_PX,
            top:
              clampedPasteToPlaceMenuPosition?.top ??
              pasteToPlaceMenuState.anchorCssY + PASTE_TO_PLACE_MENU_OFFSET_PX,
          }}
        >
          <div className="flex flex-col rounded-lg border border-white/10 bg-neutral-950/85 shadow-lg backdrop-blur-sm">
            {(pasteToPlaceMenuPreviewUrl || isPasteToPlaceMenuPreviewLoading) && (
              <div className="relative mx-2 mt-2 mb-1 overflow-hidden rounded-md border border-white/10 bg-neutral-900/70">
                {pasteToPlaceMenuPreviewUrl ? (
                  <img
                    src={pasteToPlaceMenuPreviewUrl}
                    alt="Clipboard product preview"
                    className="h-24 w-full max-w-[220px] object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="h-24 w-[220px] bg-neutral-900/70" />
                )}
                {isPasteToPlaceMenuPreviewLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/35">
                    <span className="h-4 w-4 animate-spin rounded-full border border-neutral-100/85 border-t-transparent" />
                  </div>
                )}
              </div>
            )}
            <button
              className="px-3 py-2 text-left text-sm text-white hover:bg-white/10"
              onClick={onPasteToPlaceChoosePlaceHere}
            >
              ✨ Place here
            </button>
            <button
              className={`px-3 py-2 text-left text-sm hover:bg-white/10 ${
                isMyFurnitureLoading ? "cursor-not-allowed text-neutral-500" : "text-neutral-300"
              }`}
              onClick={onPasteToPlaceChooseMyFurnitureAdd}
              disabled={isMyFurnitureLoading || !onPasteToPlaceChooseMyFurnitureAdd}
            >
              {isMyFurnitureLoading ? "🪑 Loading My Furniture..." : "🪑 My Furniture"}
            </button>
            <button
              className="px-3 py-2 text-left text-sm text-neutral-300 hover:bg-white/10"
              onClick={onPasteToPlaceChooseSwap}
            >
              🔁 Swap item
            </button>
            <button
              className="px-3 py-2 text-left text-sm text-neutral-300 hover:bg-white/10"
              onClick={onPasteToPlaceChooseAutoPlace}
            >
              🎯 Let Vibode decide placement
            </button>
          </div>
        </div>
      )}
      {pasteToPlaceProgressCardState &&
        !pasteToPlaceMenuState &&
        (pasteToPlaceProgressCardPreviewUrl || isPasteToPlaceProgressCardLoading) && (
          <div
            className="pointer-events-none absolute z-30"
            style={{
              left:
                clampedPasteToPlaceProgressCardPosition?.left ??
                pasteToPlaceProgressCardState.anchorCssX + PASTE_TO_PLACE_MENU_OFFSET_PX,
              top:
                clampedPasteToPlaceProgressCardPosition?.top ??
                pasteToPlaceProgressCardState.anchorCssY + PASTE_TO_PLACE_MENU_OFFSET_PX,
            }}
          >
            <div className="flex flex-col rounded-lg border border-white/10 bg-neutral-950/85 shadow-lg backdrop-blur-sm">
              <div className="relative mx-2 my-2 overflow-hidden rounded-md border border-white/10 bg-neutral-900/70">
                {pasteToPlaceProgressCardPreviewUrl ? (
                  <img
                    src={pasteToPlaceProgressCardPreviewUrl}
                    alt="Clipboard product preview"
                    className="h-24 w-full max-w-[220px] object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="h-24 w-[220px] bg-neutral-900/70" />
                )}
                {isPasteToPlaceProgressCardLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-neutral-950/35">
                    <span className="h-4 w-4 animate-spin rounded-full border border-neutral-100/85 border-t-transparent" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      {/* Tiny HUD (temporary) */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300">
        {markupVisible &&
          activeTool !== "calibrate" &&
          hoveredId &&
          overlappingNodeIds.has(hoveredId) && (
            <div className="text-amber-400" title="Possible overlap with another item.">
              Possible overlap with another item.
            </div>
          )}
        {isSwapPickMode
          ? "Swap: click the item to replace — Esc cancels"
          : activeTool === "calibrate"
          ? calP1
            ? calP2
              ? "Calibration: line set — enter feet and click Apply"
              : "Calibration: click point 2"
            : "Calibration: click point 1"
          : selectedNode
          ? `Selected: ${selectedNode.label}${
              selectedNode.variant?.label ? ` — ${selectedNode.variant.label}` : ""
            } (${selectedNode.skuId}) — Drag/Transform — Del deletes (temp)`
          : displayImage
          ? "Drag furniture in — click to select — Esc to deselect"
          : "Upload a room photo → then drag furniture in"}
      </div>

      {activeTool === "move" && (
        <div className="pointer-events-none absolute left-3 top-12 max-w-xs rounded-md bg-neutral-950/70 px-3 py-2 text-xs text-neutral-100 shadow-md">
          <div className="font-medium">Move</div>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-neutral-200">
            <li>Click an object to place an anchor.</li>
            <li>Drag to set direction and distance.</li>
            <li>Hold Shift to lock axis.</li>
            <li>Press Delete to remove a move mark.</li>
          </ul>
        </div>
      )}

      {/* PPF preview HUD (calibration only) */}
      {activeTool === "calibrate" && (
        <div className="pointer-events-none absolute left-3 top-12 rounded bg-neutral-950/70 px-3 py-2 text-xs text-neutral-200">
          {!calP1 && <div>Click point 1 on the photo</div>}
          {calP1 && !calP2 && <div>Click point 2 on the photo</div>}
          {preview && (
            <div className="mt-1">
              <div>Distance: {preview.distPx.toFixed(1)} px</div>
              <div>Real: {preview.feet.toFixed(2)} ft</div>
              <div className="font-medium">
                Preview: {preview.ppf ? `${preview.ppf.toFixed(2)} px/ft` : "—"}
              </div>
            </div>
          )}
        </div>
      )}
          </div>
        </div>
      </div>
    </div>
  );
}
