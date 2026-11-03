"use client";

import { useState } from "react";

import { RemoveObjectOutlines } from "@/components/stage/RemoveObjectOutlines";
import { mapRemovePointer } from "@/lib/vibode-stage/remove-mask";
import { hitTestRemoveObjects, type RemoveObjectRecord } from "@/lib/vibode-stage/remove-objects";

/**
 * Outline colours come from REMOVE: yellow is available, blue is selected.
 * Here blue means the photograph is brought forward, not hidden.
 */
export function BringForwardSelection({
  objects,
  selectedIds,
  width,
  height,
  onToggle,
}: {
  objects: readonly RemoveObjectRecord[];
  selectedIds: ReadonlySet<string>;
  width: number;
  height: number;
  onToggle: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const locate = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const location = mapRemovePointer({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      originalWidth: width,
      originalHeight: height,
    });
    if (location.status !== "inside") return null;
    return hitTestRemoveObjects({
      objects,
      selectedIds,
      x: location.x,
      y: location.y,
    });
  };
  return (
    <div
      className="absolute inset-0 z-[16]"
      data-bring-forward-selection="true"
      style={{ pointerEvents: "auto" }}
      onPointerLeave={() => setHoveredId(null)}
      onPointerMove={(event) => {
        const id = locate(event);
        setHoveredId((current) => current === id ? current : id);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const id = locate(event);
        if (id) onToggle(id);
      }}
    >
      <RemoveObjectOutlines
        objects={objects}
        selectedIds={selectedIds}
        hoveredId={hoveredId}
        outlinesVisible
      />
    </div>
  );
}
