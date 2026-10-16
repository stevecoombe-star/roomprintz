/**
 * Admin QA submission for one Harmonize capture.
 * The browser chooses an idempotency key. It cannot choose the provider.
 */

import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import {
  HarmonizeExportError,
  compositeFurnitureOverRoom,
  encodeRgbaPng,
  harmonizeExportObject,
  harmonizeSceneCanonical,
  sha256HexBytes,
  sortHarmonizeObjects,
  type HarmonizeExportCamera,
  type HarmonizeExportObject,
  type HarmonizeFurnitureCapture,
} from "@/lib/vibode-stage/harmonize-export";
import {
  resolveHarmonizeMaterials,
  type HarmonizeMaterialProvenance,
} from "@/lib/vibode-stage/harmonize-materials";
import { assembleHarmonizePrompt } from "@/lib/vibode-stage/harmonize-prompt";

export const HARMONIZE_QA_POLL_MS = 2_000;

export type HarmonizeQaMaterial = Readonly<{
  objectId: string;
  primaryText: string | null;
  secondaryText: string | null;
  primaryProvenance: HarmonizeMaterialProvenance;
  secondaryProvenance: HarmonizeMaterialProvenance;
}>;

export type HarmonizeQaObject = HarmonizeExportObject & Readonly<{ uniformScale: number }>;

export type HarmonizeQaSubmission = Readonly<{
  roomId: string;
  sourceVersionId: string;
  idempotencyKey: string;
  compositeSha256: string;
  backgroundSha256: string;
  sceneSnapshotSha256: string;
  promptSha256: string;
  generationId: string;
  roomScaleMultiplier: number;
  certifiedMetricScale: number;
  effectiveMetricScale: number;
  camera: HarmonizeExportCamera;
  objects: readonly HarmonizeQaObject[];
  unmountedObjectIds: readonly string[];
  materials: readonly HarmonizeQaMaterial[];
}>;

export type HarmonizeQaJob = Readonly<{
  id: string;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
}>;

export type HarmonizeQaAttemptGate = Readonly<{
  start: () => string | null;
  finish: () => void;
}>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

export function createHarmonizeQaAttemptGate(newId: () => string = () => crypto.randomUUID()): HarmonizeQaAttemptGate {
  let current: string | null = null;
  return {
    start() {
      if (current) return null;
      current = newId();
      return current;
    },
    finish() {
      current = null;
    },
  };
}

export function harmonizeQaJobIsActive(status: string): boolean {
  return status === "queued" || status === "running";
}

export function harmonizeQaErrorMessage(code: string): string {
  switch (code) {
    case "stale_scene":
      return "The current room view does not match its saved Harmonize references. Please refresh the room or report this issue.";
    case "stale_background":
      return "The room image changed. Try again from the current version.";
    case "stale_materials":
      return "Material data changed. Try again.";
    case "stale_prompt":
      return "The Harmonize prompt no longer matches this scene.";
    case "stale_generation":
      return "The room certification changed. Open the current version.";
    case "active_job":
      return "A Harmonize test is already running.";
    case "daily_limit":
      return "The daily Harmonize test limit was reached.";
    case "unsupported_aspect":
      return "This view is outside the supported room aspect ratios.";
    case "unsupported_dimensions":
      return "This view is too large to test.";
    case "composite_too_large":
      return "The composite image is too large.";
    case "scene_missing":
      return "This version has no saved 3D scene.";
    case "source_version_not_found":
      return "Save this room version before testing Harmonize.";
    case "invalid_composite":
      return "The composite did not upload.";
    case "publication_schema_unavailable":
      return "Harmonize cannot queue until the History publication database update is applied.";
    case "publication_authority_unavailable":
      return "This room view cannot be saved to History yet.";
    case "unavailable":
    case "disabled":
    case "Not found.":
      return "Harmonize testing is unavailable.";
    default:
      return "Harmonize testing could not start.";
  }
}

export async function buildHarmonizeQaSubmission(input: Readonly<{
  roomId: string;
  sourceVersionId: string;
  idempotencyKey: string;
  backgroundBytes: Uint8Array;
  roomRgba: Uint8Array;
  capture: HarmonizeFurnitureCapture;
}>): Promise<Readonly<{ composite: Uint8Array; submission: HarmonizeQaSubmission }>> {
  if (!input.capture.sceneObjects) {
    throw new HarmonizeExportError("Saved scene is not available for Harmonize testing.");
  }
  const certifiedCamera = input.capture.certifiedCamera;
  if (!certifiedCamera) {
    throw new HarmonizeExportError("Certified camera is not available for Harmonize testing.");
  }
  const mounted = qaObjects(input.capture.sceneObjects, input.capture);
  const objects = mounted.map((entry) => ({
    objectId: entry.objectId,
    assetId: entry.assetId,
    productId: entry.productId,
    variantId: entry.variantId,
    positionM: entry.positionM,
    rotationDeg: entry.rotationDeg,
    userSizeMultiplier: entry.userSizeMultiplier,
    effectiveDimensionsM: entry.effectiveDimensionsM,
  }));
  const unmountedObjectIds = [...input.capture.unmountedObjectIds].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  const catalog = input.capture.materialCatalog ?? null;
  const materials = resolveHarmonizeMaterials({
    objects,
    camera: certifiedCamera,
    catalog,
  }).map((object) => ({
    objectId: object.objectId,
    primaryText: object.primary.text,
    secondaryText: object.secondary.text,
    primaryProvenance: object.primary.provenance,
    secondaryProvenance: object.secondary.provenance,
  }));
  const assembled = assembleHarmonizePrompt({
    objects,
    camera: certifiedCamera,
    catalog,
  });
  if (!assembled.text) {
    throw new HarmonizeExportError("Harmonize prompt could not be assembled.");
  }
  const compositeRgba = compositeFurnitureOverRoom(input.roomRgba, input.capture.rgba);
  const composite = await encodeRgbaPng(compositeRgba, input.capture.width, input.capture.height);
  const sceneSnapshotSha256 = await sha256HexBytes(new TextEncoder().encode(harmonizeSceneCanonical({
    generationId: input.capture.generationId,
    roomScaleMultiplier: input.capture.roomScaleMultiplier,
    certifiedMetricScale: input.capture.certifiedMetricScale,
    effectiveMetricScale: input.capture.effectiveMetricScale,
    camera: certifiedCamera,
    objects,
    unmountedObjectIds,
  })));
  const submission: HarmonizeQaSubmission = {
    roomId: input.roomId,
    sourceVersionId: input.sourceVersionId,
    idempotencyKey: input.idempotencyKey,
    compositeSha256: await sha256HexBytes(composite),
    backgroundSha256: await sha256HexBytes(input.backgroundBytes),
    sceneSnapshotSha256,
    promptSha256: await sha256HexBytes(new TextEncoder().encode(assembled.text)),
    generationId: input.capture.generationId,
    roomScaleMultiplier: input.capture.roomScaleMultiplier,
    certifiedMetricScale: input.capture.certifiedMetricScale,
    effectiveMetricScale: input.capture.effectiveMetricScale,
    camera: certifiedCamera,
    objects: mounted,
    unmountedObjectIds,
    materials,
  };
  return { composite, submission };
}

export async function submitHarmonizeQaAttempt(input: Readonly<{
  composite: Uint8Array;
  submission: HarmonizeQaSubmission;
  fetchImpl?: typeof fetch;
  transportAttempts?: number;
}>): Promise<Readonly<{ jobId: string; status: string; created: boolean }>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const attempts = input.transportAttempts ?? 2;
  const uploaded = await withTransportRetry(attempts, async () => fetchImpl("/api/vibode/harmonize/jobs/upload", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomId: input.submission.roomId,
      sourceVersionId: input.submission.sourceVersionId,
      idempotencyKey: input.submission.idempotencyKey,
      byteLength: input.composite.byteLength,
    }),
  }));
  const uploadBody = await readJson(uploaded);
  if (!uploaded.ok) throw new HarmonizeExportError(harmonizeQaErrorMessage(errorOf(uploadBody)));
  const signedUrl = typeof uploadBody.signedUrl === "string" ? uploadBody.signedUrl : "";
  if (!signedUrl) throw new HarmonizeExportError("The composite did not upload.");
  const put = await withTransportRetry(attempts, async () => fetchImpl(signedUrl, {
    method: "PUT",
    credentials: "omit",
    headers: {
      "content-type": "image/png",
      "x-upsert": "true",
    },
    body: input.composite.buffer.slice(
      input.composite.byteOffset,
      input.composite.byteOffset + input.composite.byteLength,
    ) as ArrayBuffer,
  }));
  if (!put.ok) throw new HarmonizeExportError("The composite did not upload.");
  const enqueued = await withTransportRetry(attempts, async () => fetchImpl("/api/vibode/harmonize/jobs", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.submission),
  }));
  const enqueueBody = await readJson(enqueued);
  if (!enqueued.ok) throw new HarmonizeExportError(harmonizeQaErrorMessage(errorOf(enqueueBody)));
  const jobId = typeof enqueueBody.jobId === "string" ? enqueueBody.jobId : "";
  const status = typeof enqueueBody.status === "string" ? enqueueBody.status : "";
  if (!UUID_RE.test(jobId) || !status) throw new HarmonizeExportError("Harmonize testing could not start.");
  return { jobId, status, created: enqueueBody.created === true };
}

export async function readHarmonizeQaRoom(input: Readonly<{
  roomId: string;
  fetchImpl?: typeof fetch;
}>): Promise<Readonly<{ available: true; job: HarmonizeQaJob | null }> | Readonly<{ available: false }>> {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/vibode/harmonize/jobs?roomId=${encodeURIComponent(input.roomId)}`,
    { method: "GET", credentials: "same-origin", cache: "no-store" },
  );
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return { available: false };
  }
  if (!response.ok) return { available: true, job: null };
  const body = await readJson(response);
  return { available: true, job: readJob(body.job) };
}

export async function readHarmonizeQaJob(input: Readonly<{
  jobId: string;
  fetchImpl?: typeof fetch;
}>): Promise<HarmonizeQaJob | null> {
  const response = await (input.fetchImpl ?? fetch)(`/api/vibode/harmonize/jobs/${input.jobId}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) return null;
  const body = await readJson(response);
  return readJob(body.job);
}

export function harmonizeQaOutputUrl(jobId: string): string {
  return `/api/vibode/harmonize/jobs/${jobId}/output`;
}

export async function fetchHarmonizeQaOutput(input: Readonly<{
  jobId: string;
  fetchImpl?: typeof fetch;
}>): Promise<Blob> {
  const response = await (input.fetchImpl ?? fetch)(harmonizeQaOutputUrl(input.jobId), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new HarmonizeExportError("The Harmonize image is not available.");
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("image/jpeg")) throw new HarmonizeExportError("The Harmonize image is not available.");
  return response.blob();
}

function qaObjects(
  saved: readonly SceneObjectDefinition[],
  capture: HarmonizeFurnitureCapture,
): HarmonizeQaObject[] {
  const unmounted = new Set(capture.unmountedObjectIds);
  const dimensions = new Map(capture.objects.map((object) => [object.objectId, object.effectiveDimensionsM]));
  const mounted = saved.filter((object) => !unmounted.has(object.objectId));
  const scales = new Map(mounted.map((object) => [object.objectId, object.transform.uniformScale]));
  const exported = sortHarmonizeObjects(mounted.map((object) => {
    const dims = dimensions.get(object.objectId) ?? null;
    return harmonizeExportObject({
      objectId: object.objectId,
      assetId: object.assetId,
      productId: object.productId ?? null,
      variantId: object.variantId ?? null,
      positionM: object.transform.position,
      rotationDeg: object.transform.rotationDeg,
      userSizeMultiplier: object.userSizeMultiplier ?? 1,
      localAabb: dims
        ? { min: { x: 0, y: 0, z: 0 }, max: { x: dims.width, y: dims.height, z: dims.depth } }
        : null,
    });
  }));
  return exported.map((object) => {
    const uniformScale = scales.get(object.objectId);
    if (typeof uniformScale !== "number" || !Number.isFinite(uniformScale)) {
      throw new HarmonizeExportError("Saved scene scale is not available for Harmonize testing.");
    }
    return { ...object, uniformScale };
  });
}

async function withTransportRetry(
  attempts: number,
  run: () => Promise<Response>,
): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await run();
      if (response.ok || !TRANSIENT_HTTP.has(response.status) || attempt === attempts - 1) return response;
    } catch (error) {
      last = error;
      if (attempt === attempts - 1) throw error;
    }
  }
  throw last instanceof Error ? last : new HarmonizeExportError("Harmonize testing could not start.");
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorOf(body: Record<string, unknown>): string {
  return typeof body.error === "string" ? body.error : "";
}

function readJob(value: unknown): HarmonizeQaJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const status = typeof row.status === "string" ? row.status : "";
  if (!UUID_RE.test(id) || !status) return null;
  return {
    id,
    status,
    failureCode: typeof row.failureCode === "string" ? row.failureCode : null,
    failureMessage: typeof row.failureMessage === "string" ? row.failureMessage : null,
  };
}
