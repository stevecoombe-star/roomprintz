// components/editor/EditorCanvas.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Transformer } from "react-konva";
import type Konva from "konva";

type DragFurniturePayload = {
  skuId: string;
  label: string;
  // Pixel defaults for now; later this becomes real-world dims → pixel mapping
  defaultPxWidth: number;
  defaultPxHeight: number;
};

const DND_MIME = "application/x-roomprintz-furniture";

type FurnitureItem = {
  id: string;
  skuId: string;
  label: string;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type Props = {
  className?: string;
  /**
   * Called when a furniture item is right-clicked.
   * Parent can open a swap modal or context menu.
   */
  onRequestSwap?: (id: string) => void;
};

function safeUUID() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function EditorCanvas({ className, onRequestSwap }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({
    w: 800,
    h: 600,
  });

  const [items, setItems] = useState<FurnitureItem[]>([
    {
      id: "f1",
      skuId: "demo-sofa-001",
      label: "Demo Sofa",
      zIndex: 1,
      x: 220,
      y: 220,
      width: 220,
      height: 120,
      rotation: 0,
    },
  ]);

  const [selectedId, setSelectedId] = useState<string | null>("f1");

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId]
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

  // Attach transformer to selected node
  useEffect(() => {
    const tr = transformerRef.current;
    const node = selectedNodeRef.current;
    if (!tr) return;

    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
    }
  }, [selectedId]);

  const deleteSelected = () => {
    if (!selectedId) return;
    setItems((prev) => prev.filter((it) => it.id !== selectedId));
    setSelectedId(null);
  };

  // Delete key to remove selected + Escape to deselect
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (!selectedId) return;

      if (e.key === "Backspace" || e.key === "Delete") {
        deleteSelected();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const updateItem = (id: string, patch: Partial<FurnitureItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  };

  const bringToFront = (id: string) => {
    setItems((prev) => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.zIndex), 0);
      return prev.map((it) =>
        it.id === id ? { ...it, zIndex: maxZ + 1 } : it
      );
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;

    let payload: DragFurniturePayload | null = null;
    try {
      payload = JSON.parse(raw) as DragFurniturePayload;
    } catch {
      return;
    }
    if (!payload) return;

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;

    const id = safeUUID();

    setItems((prev) => {
      const maxZ = prev.reduce((m, it) => Math.max(m, it.zIndex), 0);
      return [
        ...prev,
        {
          id,
          skuId: payload.skuId,
          label: payload.label,
          zIndex: maxZ + 1,
          x: Math.max(0, dropX - payload.defaultPxWidth / 2),
          y: Math.max(0, dropY - payload.defaultPxHeight / 2),
          width: payload.defaultPxWidth,
          height: payload.defaultPxHeight,
          rotation: 0,
        },
      ];
    });

    setSelectedId(id);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={handleDrop}
    >
      <Stage
        width={stageSize.w}
        height={stageSize.h}
        onContextMenu={(e) => {
          // Disable native browser context menu on the canvas
          e.evt.preventDefault();
        }}
        onMouseDown={(e) => {
          // click empty space -> deselect
          const clickedOnEmpty = e.target === e.target.getStage();
          if (clickedOnEmpty) setSelectedId(null);
        }}
        onTouchStart={(e) => {
          const clickedOnEmpty = e.target === e.target.getStage();
          if (clickedOnEmpty) setSelectedId(null);
        }}
      >
        <Layer>
          {/* Base image placeholder */}
          <Rect
            x={0}
            y={0}
            width={stageSize.w}
            height={stageSize.h}
            fill="#0a0a0a"
          />

          {/* Furniture placeholder objects (sorted by zIndex) */}
          {[...items]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((it) => (
              <Rect
                key={it.id}
                ref={it.id === selectedId ? selectedNodeRef : undefined}
                x={it.x}
                y={it.y}
                width={it.width}
                height={it.height}
                rotation={it.rotation}
                draggable
                fill="#1f2937"
                stroke={it.id === selectedId ? "#e5e7eb" : "#374151"}
                strokeWidth={it.id === selectedId ? 2 : 1}
                onClick={() => {
                  setSelectedId(it.id);
                  bringToFront(it.id);
                }}
                onTap={() => {
                  setSelectedId(it.id);
                  bringToFront(it.id);
                }}
                onDragStart={() => {
                  setSelectedId(it.id);
                  bringToFront(it.id);
                }}
                onDragEnd={(e) => {
                  updateItem(it.id, { x: e.target.x(), y: e.target.y() });
                }}
                onTransformStart={() => {
                  setSelectedId(it.id);
                  bringToFront(it.id);
                }}
                onTransformEnd={(e) => {
                  const node = e.target as Konva.Rect;

                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();

                  // Reset scale to avoid compounding transforms
                  node.scaleX(1);
                  node.scaleY(1);

                  updateItem(it.id, {
                    x: node.x(),
                    y: node.y(),
                    rotation: node.rotation(),
                    width: Math.max(20, node.width() * scaleX),
                    height: Math.max(20, node.height() * scaleY),
                  });
                }}
                onContextMenu={(e) => {
                  // Right-click on an item: select it + let parent open swap modal/menu
                  e.evt.preventDefault();
                  setSelectedId(it.id);
                  bringToFront(it.id);
                  onRequestSwap?.(it.id);
                }}
              />
            ))}

          {/* Transformer for selection */}
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

      {/* Temporary overlay label */}
      <div className="pointer-events-none absolute left-3 top-3 rounded bg-neutral-950/60 px-2 py-1 text-xs text-neutral-300">
        {selectedItem
          ? `Selected: ${selectedItem.label} (${selectedItem.skuId}) — Drag / Resize / Rotate — Del to remove`
          : "Drag furniture from the right panel onto the canvas — Esc to deselect"}
      </div>
    </div>
  );
}
