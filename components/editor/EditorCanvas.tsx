// components/editor/EditorCanvas.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useEditorStore } from "@/stores/editorStore";
import { MOCK_COLLECTIONS } from "@/data/mockCollections";

type DragFurniturePayload = {
  skuId: string;
  label?: string;
};

const DND_MIME = "application/x-roomprintz-furniture";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
  markupVisible = true,
}: {
  className?: string;
  onRequestSwap?: (id: string) => void;
  markupVisible?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const baseImageUrl = useEditorStore((s) => s.scene.baseImageUrl);
  const nodes = useEditorStore((s) => s.scene.nodes);
  const selectedNodeId = useEditorStore((s) => s.ui.selectedNodeId);
  const activeTool = useEditorStore((s) => s.ui.activeTool);

  const viewport = useEditorStore((s) => s.viewport);
  const calibration = useEditorStore((s) => s.scene.calibration);
  const ppf = useEditorStore((s) => s.scene.calibration?.ppf);

  const setViewport = useEditorStore((s) => s.setViewport);

  const selectNode = useEditorStore((s) => s.selectNode);
  const addNode = useEditorStore((s) => s.addNode);
  const updateNodeTransform = useEditorStore((s) => s.updateNodeTransform);

  const toggleDelete = useEditorStore((s) => s.toggleDelete);
  const setPendingSwap = useEditorStore((s) => s.setPendingSwap);

  const clearCalibrationDraft = useEditorStore((s) => s.clearCalibrationDraft);
  const setCalibrationPoint = useEditorStore((s) => s.setCalibrationPoint);

  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });

  const [img] = useImage(baseImageUrl ?? "", "anonymous");

  const fit = useMemo(() => {
    if (!img) return { x: 0, y: 0, w: stageSize.w, h: stageSize.h, scale: 1 };

    const iw = img.width;
    const ih = img.height;

    const s = Math.min(stageSize.w / iw, stageSize.h / ih);
    const w = iw * s;
    const h = ih * s;
    const x = (stageSize.w - w) / 2;
    const y = (stageSize.h - h) / 2;

    return { x, y, w, h, scale: s };
  }, [img, stageSize.w, stageSize.h]);

  // Publish viewport mapping so Freeze can convert Stage coords -> Image pixel coords
  useEffect(() => {
    if (!img) {
      setViewport(undefined);
      return;
    }

    setViewport({
      imageStageX: fit.x,
      imageStageY: fit.y,
      imageStageW: fit.w,
      imageStageH: fit.h,
      scale: fit.scale, // stage_px per image_px
      imageNaturalW: img.width,
      imageNaturalH: img.height,
    });
  }, [img, fit.x, fit.y, fit.w, fit.h, fit.scale, setViewport]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const transformerRef = useRef<Konva.Transformer | null>(null);
  const selectedNodeRef = useRef<Konva.Rect | null>(null);

  // Resize stage to container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setStageSize({
        w: Math.max(320, Math.floor(cr.width)),
        h: Math.max(240, Math.floor(cr.height)),
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
        selectNode(null);
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
  }, [selectNode, selectedNodeId, toggleDelete, activeTool]);

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

  return (
    <div
      ref={containerRef}
      className={className}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        e.preventDefault();

        // Do not allow dropping furniture while calibrating
        if (activeTool === "calibrate") return;

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
      <Stage
        width={stageSize.w}
        height={stageSize.h}
        onMouseDown={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;

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

          const clickedOnEmpty = e.target === stage;
          if (clickedOnEmpty) selectNode(null);
        }}
        onTouchStart={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;

          if (activeTool === "calibrate") {
            if (!viewport) return;

            const imgPt0 = stagePointerToImage(stage, viewport);
            if (!imgPt0) return;

            if (!isInsideImage(imgPt0, viewport)) return;

            const imgPt = clampToImage(imgPt0, viewport);

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

          const clickedOnEmpty = e.target === stage;
          if (clickedOnEmpty) selectNode(null);
        }}
      >
        <Layer>
          {/* Matte */}
          <Rect
            x={0}
            y={0}
            width={stageSize.w}
            height={stageSize.h}
            fill="#0a0a0a"
          />

          {/* Base image (scaled to fit) */}
          {img ? (
            <KonvaImage
              image={img}
              x={fit.x}
              y={fit.y}
              width={fit.w}
              height={fit.h}
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

          {/* Render nodes in z-order */}
          {[...nodes]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((n) => {
              const isSelected = n.id === selectedNodeId;
              const isHovered = hoveredNodeId === n.id;
              const showBadges =
                markupVisible && (isSelected || isHovered) && activeTool !== "calibrate";

              const t = n.transform;

              return (
                <React.Fragment key={n.id}>
                  <Rect
                    ref={isSelected ? selectedNodeRef : undefined}
                    x={t.x}
                    y={t.y}
                    width={t.width}
                    height={t.height}
                    rotation={t.rotation}
                    draggable={
                      activeTool !== "calibrate" && n.status !== "markedForDelete"
                    }
                    fill="#1f2937"
                    opacity={n.status === "markedForDelete" ? 0.35 : 1}
                    stroke={isSelected ? "#e5e7eb" : "#374151"}
                    strokeWidth={isSelected ? 2 : 1}
                    onMouseEnter={() => setHoveredNodeId(n.id)}
                    onMouseLeave={() =>
                      setHoveredNodeId((cur) => (cur === n.id ? null : cur))
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
                      updateNodeTransform(n.id, {
                        x: e.target.x(),
                        y: e.target.y(),
                      });
                    }}
                    onTransformEnd={(e) => {
                      if (activeTool === "calibrate") return;

                      const node = e.target as Konva.Rect;

                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();

                      // Prevent compounding transforms
                      node.scaleX(1);
                      node.scaleY(1);

                      updateNodeTransform(n.id, {
                        x: node.x(),
                        y: node.y(),
                        rotation: node.rotation(),
                        width: Math.max(20, node.width() * scaleX),
                        height: Math.max(20, node.height() * scaleY),
                      });
                    }}
                  />

                  {/* Vibode vibe-flow overlays */}
                  {showBadges && (
                    <Group>
                      {/* RED X (delete/restore toggle) — top-left */}
                      <Group
                        x={t.x + 12}
                        y={t.y + 12}
                        onMouseDown={(e) => {
                          e.cancelBubble = true;
                        }}
                        onClick={() => toggleDelete(n.id)}
                        onTap={() => toggleDelete(n.id)}
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
                        x={t.x + t.width - 12}
                        y={t.y + 12}
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
                        <Group x={t.x + 12} y={t.y + t.height - 18}>
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
                </React.Fragment>
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

      {/* Tiny HUD (temporary) */}
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300">
        {activeTool === "calibrate"
          ? calP1
            ? calP2
              ? "Calibration: line set — enter feet and click Apply"
              : "Calibration: click point 2"
            : "Calibration: click point 1"
          : selectedNode
          ? `Selected: ${selectedNode.label}${
              selectedNode.variant?.label ? ` — ${selectedNode.variant.label}` : ""
            } (${selectedNode.skuId}) — Drag/Transform — Del deletes (temp)`
          : img
          ? "Drag furniture in — click to select — Esc to deselect"
          : "Upload a room photo → then drag furniture in"}
      </div>

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
  );
}
