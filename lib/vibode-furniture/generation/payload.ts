/**
 * Turns a MESHY-1B draft into a Meshy 7.1 create body.
 *
 * OpenAPI checked 2026-11-06:
 * single image uses `image_url`; multi image uses `image_urls` (1–4),
 * and the first image is the front view. Multi-image `geometry_resolution`
 * accepts `standard` and `2k` only. `4k` is single-image only.
 * Task `name` is the reconciliation handle because `X-Meshy-Metadata` is
 * ignored except on Studio and Enterprise plans.
 * Images travel as base64 data URIs so Vibode does not publish them.
 */

import { isUuidLike } from "@/lib/vibode-stage/asset-id";

import type { MeshyGenerationDraft } from "@/lib/vibode-furniture/generator/request";
import {
  FURNITURE_VIEW_SLOT_ORDER,
  type FurnitureViewSlot,
} from "@/lib/vibode-furniture/generator/images";

import { imageDataUri, type InspectedFurnitureImage } from "./images";
import type { MeshyGenerationOperation } from "./credits";

export type MeshyCreateRequest = Readonly<{
  operation: MeshyGenerationOperation;
  path: "/v1/image-to-3d" | "/v1/multi-image-to-3d";
  taskName: string;
  body: Readonly<Record<string, unknown>>;
}>;

const TASK_NAME = /^vibode-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function meshyTaskNameForJob(jobId: string): string | null {
  const normalized = jobId.trim().toLowerCase();
  if (!isUuidLike(normalized)) return null;
  const name = `vibode-${normalized}`;
  return name.length <= 100 ? name : null;
}

export function buildMeshyCreateRequest(input: Readonly<{
  draft: MeshyGenerationDraft;
  images: readonly InspectedFurnitureImage[];
  taskName: string;
}>): { ok: true; request: MeshyCreateRequest } | { ok: false; message: string } {
  if (!TASK_NAME.test(input.taskName)) {
    return { ok: false, message: "The generation request could not be prepared." };
  }
  if (input.draft.provider !== "meshy" || input.draft.aiModel !== "meshy-7.1") {
    return { ok: false, message: "This generator model is not available." };
  }
  if (input.draft.body.model_type !== "standard" || input.draft.body.ai_model !== "meshy-7.1") {
    return { ok: false, message: "This generator model is not available." };
  }
  if (input.draft.body.target_formats.length !== 1 || input.draft.body.target_formats[0] !== "glb") {
    return { ok: false, message: "Only a GLB result can be requested." };
  }
  if (input.draft.operation === "multi-image-to-3d" && input.draft.body.geometry_resolution === "4k") {
    return { ok: false, message: "4K Ultra geometry is available for one photo only." };
  }
  if (!sameSlots(input.draft.imageSlots, input.images.map((image) => image.slot))) {
    return { ok: false, message: "The photos do not match this generation." };
  }
  if (!slotsStayInOrder(input.images.map((image) => image.slot))) {
    return { ok: false, message: "The photos do not match this generation." };
  }
  const body: Record<string, unknown> = {
    ...input.draft.body,
    name: input.taskName,
    target_formats: ["glb"],
  };
  delete body.image_url;
  delete body.image_urls;
  if (input.draft.operation === "image-to-3d") {
    if (input.images.length !== 1 || input.images[0]?.slot !== "front") {
      return { ok: false, message: "A front photo is required." };
    }
    const front = input.images[0];
    body.image_url = imageDataUri(front.mimeType, front.bytes);
    return {
      ok: true,
      request: { operation: "image-to-3d", path: "/v1/image-to-3d", taskName: input.taskName, body },
    };
  }
  if (input.images.length < 2 || input.images.length > 4) {
    return { ok: false, message: "Multi-image generation needs two to four photos." };
  }
  body.image_urls = input.images.map((image) => imageDataUri(image.mimeType, image.bytes));
  return {
    ok: true,
    request: {
      operation: "multi-image-to-3d",
      path: "/v1/multi-image-to-3d",
      taskName: input.taskName,
      body,
    },
  };
}

function sameSlots(
  expected: readonly FurnitureViewSlot[],
  actual: readonly FurnitureViewSlot[],
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((slot, index) => slot === actual[index]);
}

function slotsStayInOrder(slots: readonly FurnitureViewSlot[]): boolean {
  let previous = -1;
  for (const slot of slots) {
    const index = FURNITURE_VIEW_SLOT_ORDER.indexOf(slot);
    if (index <= previous) return false;
    previous = index;
  }
  return slots[0] === "front";
}
