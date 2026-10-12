/**
 * Maps service-role reads into the trusted room plan.
 * Callers may only SELECT. This module has no writes.
 */

import { editorSceneObjectsFromAuthority } from "@/lib/afc-v2-runtime/editor-scene-objects";
import { validatePersistedSceneObjects } from "@/lib/afc-v2-runtime/persisted-scene";
import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import { storedMaterial } from "@/lib/vibode-stage/material-text";
import type { HarmonizeMaterialCatalog } from "@/lib/vibode-stage/harmonize-materials";
import { parseRoomScaleMultiplier } from "@/lib/vibode-stage/room-scale";

import type { HarmonizeTrustedCamera, HarmonizeTrustedLoad, HarmonizeTrustedRoom } from "./types";

export function harmonizeTrustedRoomFromRecords(input: Readonly<{
  userId: string;
  roomId: string;
  sourceVersionId: string;
  room: unknown;
  source: unknown;
  background: Uint8Array | null;
  scene: unknown;
  generation: unknown;
  products: unknown;
  variants: unknown;
}>): HarmonizeTrustedLoad {
  const room = record(input.room);
  if (!room || text(room.user_id) !== input.userId || text(room.id) !== input.roomId) {
    return { ok: false, code: "not_found" };
  }
  const generationId = text(room.current_afc_generation_id);
  if (!generationId) return { ok: false, code: "authority_unavailable" };
  const roomScale = room.room_scale_multiplier == null
    ? 1
    : parseRoomScaleMultiplier(room.room_scale_multiplier);
  if (roomScale == null) return { ok: false, code: "authority_unavailable" };

  const source = record(input.source);
  if (
    !source
    || text(source.user_id) !== input.userId
    || text(source.room_id) !== input.roomId
    || text(source.id) !== input.sourceVersionId
  ) {
    return { ok: false, code: "source_version_not_found" };
  }
  if (!input.background) return { ok: false, code: "source_unreadable" };

  const sceneRow = record(input.scene);
  if (!sceneRow) return { ok: false, code: "scene_missing" };
  const sceneGenerationId = text(sceneRow.afc_generation_id);
  const objects = validatePersistedSceneObjects(sceneRow.objects_json);
  if (!sceneGenerationId || !objects.ok) return { ok: false, code: "scene_missing" };

  const authority = readAuthority(input.generation, input.roomId, input.userId, generationId);
  if (!authority) return { ok: false, code: "authority_unavailable" };
  const generation = record(input.generation);
  const placed = editorSceneObjectsFromAuthority({
    objects: objects.objects,
    productionAuthority: generation?.production_authority,
    manualPerspective: generation?.manual_perspective,
    direction: "to-effective",
  });
  if (!placed.ok) return { ok: false, code: "stale_scene" };

  const catalog = readCatalog(input.products, input.variants);
  if (!catalog) return { ok: false, code: "catalog_unavailable" };

  const trusted: HarmonizeTrustedRoom = {
    userId: input.userId,
    currentAfcGenerationId: generationId,
    roomScaleMultiplier: roomScale,
    certifiedMetricScale: authority.certifiedMetricScale,
    camera: authority.camera,
    sourceUserId: input.userId,
    sourceRoomId: input.roomId,
    background: input.background,
    scene: {
      afcGenerationId: sceneGenerationId,
      objects: placed.objects,
    },
    catalog,
  };
  return { ok: true, room: trusted };
}

export function harmonizeSceneProductIds(objects: readonly SceneObjectDefinition[]): Readonly<{
  productIds: string[];
  variantIds: string[];
}> {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const object of objects) {
    if (object.productId) productIds.add(object.productId);
    if (object.variantId) variantIds.add(object.variantId);
  }
  return { productIds: [...productIds], variantIds: [...variantIds] };
}

function readAuthority(
  value: unknown,
  roomId: string,
  userId: string,
  generationId: string,
): Readonly<{ certifiedMetricScale: number; camera: HarmonizeTrustedCamera }> | null {
  const row = record(value);
  if (!row || text(row.id) !== generationId || text(row.room_id) !== roomId || text(row.user_id) !== userId) {
    return null;
  }
  if (row.status !== "ready") return null;
  const authority = record(row.production_authority);
  if (!authority || text(authority.generationId) !== generationId) return null;
  const metric = record(authority.metric);
  const certifiedMetricScale = typeof metric?.metricScale === "number" ? metric.metricScale : null;
  if (certifiedMetricScale == null || !(certifiedMetricScale > 0) || !Number.isFinite(certifiedMetricScale)) {
    return null;
  }
  const camera = readCamera(authority.frozenCamera);
  if (!camera) return null;
  return { certifiedMetricScale, camera };
}

function readCamera(value: unknown): HarmonizeTrustedCamera | null {
  const camera = record(value);
  const frame = camera ? record(camera.frame) : null;
  const pose = camera ? record(camera.pose) : null;
  if (!camera || !frame || !pose) return null;
  const verticalFovDeg = camera.verticalFovDeg;
  const width = frame.width;
  const height = frame.height;
  const position = pose ? readVec(pose.position) : null;
  const lookAt = pose ? readVec(pose.lookAt) : null;
  const up = pose ? readVec(pose.up) : null;
  if (
    typeof verticalFovDeg !== "number" || !(verticalFovDeg > 0)
    || typeof width !== "number" || !Number.isInteger(width) || width < 1
    || typeof height !== "number" || !Number.isInteger(height) || height < 1
    || !position || !lookAt || !up
  ) {
    return null;
  }
  return {
    verticalFovDeg,
    frame: { width, height },
    pose: { position, lookAt, up },
  };
}

function readCatalog(productsValue: unknown, variantsValue: unknown): HarmonizeMaterialCatalog | null {
  if (!Array.isArray(productsValue) || !Array.isArray(variantsValue)) return null;
  const products = [];
  for (const entry of productsValue) {
    const row = record(entry);
    const productId = row ? text(row.product_id) : "";
    const name = row ? text(row.name) : "";
    if (!row || !productId || !name) return null;
    products.push({
      productId,
      name,
      primaryMaterial: storedMaterial(typeof row.primary_material === "string" ? row.primary_material : null),
      secondaryMaterial: storedMaterial(typeof row.secondary_material === "string" ? row.secondary_material : null),
    });
  }
  const variants = [];
  for (const entry of variantsValue) {
    const row = record(entry);
    const variantId = row ? text(row.variant_id) : "";
    const productId = row ? text(row.product_id) : "";
    if (!row || !variantId || !productId) return null;
    variants.push({
      variantId,
      productId,
      finishLabel: typeof row.finish_label === "string" && row.finish_label.trim() ? row.finish_label : null,
      primaryMaterial: storedMaterial(typeof row.primary_material === "string" ? row.primary_material : null),
      secondaryMaterial: storedMaterial(typeof row.secondary_material === "string" ? row.secondary_material : null),
    });
  }
  return { products, variants };
}

function readVec(value: unknown): Readonly<{ x: number; y: number; z: number }> | null {
  const point = record(value);
  if (!point) return null;
  const { x, y, z } = point;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function record(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
