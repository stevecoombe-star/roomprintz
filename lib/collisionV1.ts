// lib/collisionV1.ts
// ==============================
// Minimal "possible overlap" warning system for Vibode nodes.
// Advisory only — never blocks Generate. Uses AABB in image space.
// ==============================

import type { FurnitureNode, ViewportMapping } from "@/stores/editorStore";
import { toImageSpaceTransform } from "@/stores/editorStore";
import { inferLayerKindFromNode } from "@/lib/layerKind";
import type { LayerKind } from "@/lib/layerKind";

export type Rect = { x: number; y: number; w: number; h: number };

/** AABB overlap area (0 if no overlap). */
export function rectOverlapArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  if (x1 >= x2 || y1 >= y2) return 0;
  return (x2 - x1) * (y2 - y1);
}

function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function rectDiagonal(r: Rect): number {
  return Math.sqrt(r.w * r.w + r.h * r.h);
}

/** Overlap area as fraction of the smaller rect (0..1). */
export function overlapPercentOfSmaller(a: Rect, b: Rect): number {
  const overlap = rectOverlapArea(a, b);
  if (overlap <= 0) return 0;

  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const smaller = Math.min(areaA, areaB);
  if (smaller <= 0) return 0;

  return overlap / smaller;
}

const OVERLAP_THRESHOLD = 0.20; // 20% of smaller rect

/** Layer kinds that participate in v1 overlap checks. wall_art / lighting_ceiling ignored. */
const V1_OVERLAP_LAYERS: Set<LayerKind> = new Set([
  "floor_furniture",
  "decor_floor",
  "lighting_floor",
]);

function shouldConsiderPair(a: FurnitureNode, b: FurnitureNode): boolean {
  const kA = inferLayerKindFromNode(a);
  const kB = inferLayerKindFromNode(b);

  // Exclude rug overlaps with non-rug items
  if (kA === "rug" && kB !== "rug") return false;
  if (kA !== "rug" && kB === "rug") return false;

  // Rug vs rug: consider (optional, keep ON)
  if (kA === "rug" && kB === "rug") return true;

  // Both must be in v1 overlap set
  return V1_OVERLAP_LAYERS.has(kA) && V1_OVERLAP_LAYERS.has(kB);
}

/**
 * Compute set of node IDs that have at least one overlap (per v1 rules).
 * Uses image-space AABB via toImageSpaceTransform.
 */
export function computeOverlappingNodeIds(
  nodes: FurnitureNode[],
  viewport: ViewportMapping
): Set<string> {
  const overlapping = new Set<string>();
  if (!viewport || nodes.length < 2) return overlapping;

  const active = nodes.filter((n) => n.status !== "markedForDelete");
  const rects: { id: string; rect: Rect; node: FurnitureNode }[] = active.map((n) => {
    const t = toImageSpaceTransform(n.transform, viewport);
    return {
      id: n.id,
      rect: { x: t.x, y: t.y, w: t.width, h: t.height },
      node: n,
    };
  });

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const { id: idA, rect: rA, node: nodeA } = rects[i];
      const { id: idB, rect: rB, node: nodeB } = rects[j];

      if (!shouldConsiderPair(nodeA, nodeB)) continue;

      const pct = overlapPercentOfSmaller(rA, rB);
      if (pct < OVERLAP_THRESHOLD) continue;

      const centerA = rectCenter(rA);
      const centerB = rectCenter(rB);
      const centerDistance = Math.sqrt(
        (centerB.x - centerA.x) ** 2 + (centerB.y - centerA.y) ** 2
      );
      const smallerDiagonal = Math.min(rectDiagonal(rA), rectDiagonal(rB));
      if (centerDistance >= 0.35 * smallerDiagonal) continue;

      overlapping.add(idA);
      overlapping.add(idB);
    }
  }

  if (process.env.NODE_ENV !== "production" && overlapping.size > 0) {
    console.log("[collisionV1] overlapped nodes:", overlapping.size, Array.from(overlapping));
  }

  return overlapping;
}
