/**
 * Server-side acceptance for one Harmonize enqueue.
 *
 * The client composite is pixel evidence only after the saved scene,
 * background, certified camera, and catalog materials match. This module
 * does not call a provider and does not write a 3D scene.
 */

import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import {
  canonicalJson,
  harmonizeExportObject,
  harmonizeSceneCanonical,
  readPngSize,
  sha256HexBytes,
  sortHarmonizeObjects,
  type HarmonizeExportCamera,
  type HarmonizeExportObject,
  type HarmonizeVec3,
} from "@/lib/vibode-stage/harmonize-export";
import {
  resolveHarmonizeMaterials,
  type HarmonizeMaterialProvenance,
} from "@/lib/vibode-stage/harmonize-materials";
import {
  HARMONIZE_PROMPT_ASSEMBLY_VERSION,
  assembleHarmonizePrompt,
} from "@/lib/vibode-stage/harmonize-prompt";
import { HARMONIZE_UNIVERSAL_PROMPT_VERSION } from "@/lib/vibode-stage/harmonize-universal-prompt-v2";
import { effectiveMetricScale } from "@/lib/vibode-stage/room-scale";

import { harmonizeActorDecision, harmonizeMode, type HarmonizeMode } from "./access";
import { harmonizePublicationFields } from "./backdrop-kind";
import {
  HARMONIZE_COMPOSITE_MAX_BYTES,
  HARMONIZE_COMPOSITE_MAX_EDGE,
  harmonizeCompositePath,
} from "./policy";
import { harmonizeProviderAcceptsComposite } from "./provider-capability";
import type {
  HarmonizeAcceptedSnapshot,
  HarmonizeJobInsert,
  HarmonizeMaterialDescriptor,
  HarmonizeTrustedCamera,
  HarmonizeTrustedLoad,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const PROVENANCE = new Set<HarmonizeMaterialProvenance>([
  "variant",
  "product",
  "cleared",
  "missing",
  "unsafe",
  "unresolved",
]);

export type HarmonizePlanResult =
  | Readonly<{ ok: true; insert: HarmonizeJobInsert }>
  | Readonly<{ ok: false; code: string }>;

export type HarmonizeEnqueueDiagnostic = Readonly<Record<string, string | number | boolean | null>>;

/** Development server log. The HTTP body stays the public error code. */
export function reportHarmonizeEnqueueMismatch(
  stage: string,
  fields: HarmonizeEnqueueDiagnostic,
): void {
  if (process.env.NODE_ENV !== "development") return;
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/prompt|material|text|cookie|authorization|signed|token|secret|byte/i.test(key)) continue;
    safe[key] = value;
  }
  const summary = [`stage=${stage}`, ...Object.entries(safe).map(([key, value]) => `${key}=${value}`)].join(" ");
  console.info(`[vibode-harmonize] enqueue rejected ${summary}`);
}

export function readHarmonizeEnqueueIds(
  value: unknown,
): Readonly<{ roomId: string; sourceVersionId: string; idempotencyKey: string }> | null {
  if (!isRecord(value)) return null;
  const roomId = uuid(value.roomId);
  const sourceVersionId = uuid(value.sourceVersionId);
  const idempotencyKey = uuid(value.idempotencyKey);
  if (!roomId || !sourceVersionId || !idempotencyKey) return null;
  return { roomId, sourceVersionId, idempotencyKey };
}

export async function planHarmonizeEnqueue(input: Readonly<{
  actor: Readonly<{ userId: string | null; email: string | null | undefined }>;
  submission: unknown;
  composite: Uint8Array;
  loadTrusted: (roomId: string, sourceVersionId: string) => Promise<HarmonizeTrustedLoad>;
  mode?: HarmonizeMode;
}>): Promise<HarmonizePlanResult> {
  const decision = harmonizeActorDecision({
    mode: input.mode ?? harmonizeMode(),
    userId: input.actor.userId,
    email: input.actor.email,
  });
  if (decision !== "ok" || !input.actor.userId) return { ok: false, code: decision };
  const parsed = parseSubmission(input.submission);
  if (!parsed.ok) return parsed;
  const trusted = await input.loadTrusted(parsed.value.roomId, parsed.value.sourceVersionId);
  if (!trusted.ok) return { ok: false, code: trusted.code };
  if (trusted.room.userId !== input.actor.userId) return { ok: false, code: "not_found" };
  if (trusted.room.sourceUserId !== input.actor.userId || trusted.room.sourceRoomId !== parsed.value.roomId) {
    return { ok: false, code: "source_version_not_found" };
  }
  const image = await inspectComposite(input.composite, parsed.value.compositeSha256);
  if (!image.ok) return image;
  const note = (stage: string, fields: HarmonizeEnqueueDiagnostic) => {
    reportHarmonizeEnqueueMismatch(stage, {
      roomId: parsed.value.roomId,
      sourceVersionId: parsed.value.sourceVersionId,
      generationId: parsed.value.generationId,
      idempotencyKey: parsed.value.idempotencyKey,
      compositeWidth: image.width,
      compositeHeight: image.height,
      ...fields,
    });
  };
  if (
    parsed.value.generationId !== trusted.room.currentAfcGenerationId
    || trusted.room.scene.afcGenerationId !== trusted.room.currentAfcGenerationId
  ) {
    note("generation", {
      submittedGenerationId: parsed.value.generationId,
      currentGenerationId: trusted.room.currentAfcGenerationId,
      sceneGenerationId: trusted.room.scene.afcGenerationId,
    });
    return { ok: false, code: "stale_generation" };
  }
  // Effective editor coordinates, the representation harmonizeSceneCanonical documents.
  const objects = authoritativeObjects(parsed.value, trusted.room.scene.objects);
  if (!objects.ok) {
    note("objects", objects.diagnostic.reason === "position"
      ? {
          ...objects.diagnostic,
          effectiveScale: effectiveMetricScale(
            trusted.room.certifiedMetricScale,
            trusted.room.roomScaleMultiplier,
          ),
        }
      : objects.diagnostic);
    return { ok: false, code: "stale_scene" };
  }
  if (!cameraMatches(parsed.value.camera, trusted.room.camera)) {
    note("camera", cameraDiagnostic(parsed.value.camera, trusted.room.camera));
    return { ok: false, code: "stale_scene" };
  }
  const expectedEffective = effectiveMetricScale(
    trusted.room.certifiedMetricScale,
    trusted.room.roomScaleMultiplier,
  );
  if (
    parsed.value.roomScaleMultiplier !== trusted.room.roomScaleMultiplier
    || parsed.value.certifiedMetricScale !== trusted.room.certifiedMetricScale
    || parsed.value.effectiveMetricScale !== expectedEffective
  ) {
    note("scale", {
      submittedRoomScale: parsed.value.roomScaleMultiplier,
      trustedRoomScale: trusted.room.roomScaleMultiplier,
      submittedCertifiedScale: parsed.value.certifiedMetricScale,
      trustedCertifiedScale: trusted.room.certifiedMetricScale,
      submittedEffectiveScale: parsed.value.effectiveMetricScale,
      trustedEffectiveScale: expectedEffective,
    });
    return { ok: false, code: "stale_scene" };
  }
  const backgroundSha256 = await sha256HexBytes(trusted.room.background);
  if (backgroundSha256 !== parsed.value.backgroundSha256) {
    note("background", { hashMatch: false });
    return { ok: false, code: "stale_background" };
  }
  const resolved = resolveHarmonizeMaterials({
    objects: objects.objects,
    camera: parsed.value.camera,
    catalog: trusted.room.catalog,
  });
  const materials: HarmonizeMaterialDescriptor[] = resolved.map((object) => ({
    objectId: object.objectId,
    primaryText: object.primary.text,
    secondaryText: object.secondary.text,
    primaryProvenance: object.primary.provenance,
    secondaryProvenance: object.secondary.provenance,
  }));
  if (!sameMaterials(materials, parsed.value.materials)) {
    note("materials", materialDiagnostic(materials, parsed.value.materials));
    return { ok: false, code: "stale_materials" };
  }
  const assembled = assembleHarmonizePrompt({
    objects: objects.objects,
    camera: parsed.value.camera,
    catalog: trusted.room.catalog,
  });
  if (!assembled.text) {
    note("prompt", { assembled: false });
    return { ok: false, code: "stale_prompt" };
  }
  const promptSha256 = await sha256HexBytes(new TextEncoder().encode(assembled.text));
  if (promptSha256 !== parsed.value.promptSha256) {
    note("prompt", { assembled: true, hashMatch: false });
    return { ok: false, code: "stale_prompt" };
  }
  const sceneCanonical = harmonizeSceneCanonical({
    generationId: trusted.room.currentAfcGenerationId,
    roomScaleMultiplier: trusted.room.roomScaleMultiplier,
    certifiedMetricScale: trusted.room.certifiedMetricScale,
    effectiveMetricScale: expectedEffective,
    camera: parsed.value.camera,
    objects: objects.objects,
    unmountedObjectIds: objects.unmountedObjectIds,
  });
  const sceneSnapshotSha256 = await sha256HexBytes(new TextEncoder().encode(sceneCanonical));
  if (sceneSnapshotSha256 !== parsed.value.sceneSnapshotSha256) {
    note("scene_hash", { hashMatch: false });
    return { ok: false, code: "stale_scene" };
  }
  const publication = harmonizePublicationFields({
    backgroundSha256,
    emptySha256: trusted.room.emptySha256,
    originalSha256: trusted.room.originalSha256,
    persistedObjects: trusted.room.persistedObjects,
    effectiveObjectIds: trusted.room.scene.objects.map((object) => object.objectId),
  });
  if (!publication.ok) {
    note("publication", { ready: false });
    return { ok: false, code: "publication_authority_unavailable" };
  }
  const requestSha256 = await sha256HexBytes(new TextEncoder().encode(canonicalJson({
    roomId: parsed.value.roomId,
    sourceVersionId: parsed.value.sourceVersionId,
    generationId: trusted.room.currentAfcGenerationId,
    sceneSnapshotSha256,
    backgroundSha256,
    compositeSha256: image.sha256,
    promptSha256,
  })));
  const snapshot: HarmonizeAcceptedSnapshot = {
    generationId: trusted.room.currentAfcGenerationId,
    roomScaleMultiplier: trusted.room.roomScaleMultiplier,
    certifiedMetricScale: trusted.room.certifiedMetricScale,
    effectiveMetricScale: expectedEffective,
    camera: parsed.value.camera,
    objects: objects.objects,
    unmountedObjectIds: objects.unmountedObjectIds,
    uniformScales: objects.uniformScales,
    materials,
    prompt: assembled.text,
    backgroundSha256,
    compositeSha256: image.sha256,
    sourceVersionId: parsed.value.sourceVersionId,
    sceneSnapshotSha256,
  };
  const insert: HarmonizeJobInsert = {
    userId: input.actor.userId,
    roomId: parsed.value.roomId,
    sourceVersionId: parsed.value.sourceVersionId,
    idempotencyKey: parsed.value.idempotencyKey,
    requestSha256,
    sceneSnapshotSha256,
    backgroundSha256,
    compositeSha256: image.sha256,
    promptSha256,
    promptVersion: HARMONIZE_UNIVERSAL_PROMPT_VERSION,
    assemblyVersion: HARMONIZE_PROMPT_ASSEMBLY_VERSION,
    afcGenerationId: trusted.room.currentAfcGenerationId,
    snapshot,
    compositePath: harmonizeCompositePath(
      parsed.value.roomId,
      input.actor.userId,
      parsed.value.idempotencyKey,
    ),
    compositeByteLength: input.composite.byteLength,
    compositeWidth: image.width,
    compositeHeight: image.height,
    roomUserId: trusted.room.userId,
    sourceUserId: trusted.room.sourceUserId,
    sourceRoomId: trusted.room.sourceRoomId,
    backdropKind: publication.backdropKind,
    sceneObjects: publication.sceneObjects,
  };
  return { ok: true, insert };
}

type ParsedSubmission = Readonly<{
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
  objects: readonly Readonly<{ object: HarmonizeExportObject; uniformScale: number }>[];
  unmountedObjectIds: readonly string[];
  materials: readonly HarmonizeMaterialDescriptor[];
}>;

function parseSubmission(
  value: unknown,
): Readonly<{ ok: true; value: ParsedSubmission }> | Readonly<{ ok: false; code: "invalid_submission" }> {
  if (!isRecord(value)) return { ok: false, code: "invalid_submission" };
  const roomId = uuid(value.roomId);
  const sourceVersionId = uuid(value.sourceVersionId);
  const idempotencyKey = uuid(value.idempotencyKey);
  const generationId = uuid(value.generationId);
  const compositeSha256 = sha(value.compositeSha256);
  const backgroundSha256 = sha(value.backgroundSha256);
  const sceneSnapshotSha256 = sha(value.sceneSnapshotSha256);
  const promptSha256 = sha(value.promptSha256);
  const roomScaleMultiplier = positive(value.roomScaleMultiplier);
  const certifiedMetricScale = positive(value.certifiedMetricScale);
  const effectiveMetricScale = positive(value.effectiveMetricScale);
  const camera = parseCamera(value.camera);
  const objects = parseObjects(value.objects);
  const unmountedObjectIds = parseIdList(value.unmountedObjectIds);
  const materials = parseMaterials(value.materials);
  if (
    !roomId || !sourceVersionId || !idempotencyKey || !generationId
    || !compositeSha256 || !backgroundSha256 || !sceneSnapshotSha256 || !promptSha256
    || roomScaleMultiplier == null || certifiedMetricScale == null || effectiveMetricScale == null
    || !camera || !objects || !unmountedObjectIds || !materials
  ) {
    return { ok: false, code: "invalid_submission" };
  }
  return {
    ok: true,
    value: {
      roomId,
      sourceVersionId,
      idempotencyKey,
      compositeSha256,
      backgroundSha256,
      sceneSnapshotSha256,
      promptSha256,
      generationId,
      roomScaleMultiplier,
      certifiedMetricScale,
      effectiveMetricScale,
      camera,
      objects,
      unmountedObjectIds,
      materials,
    },
  };
}

async function inspectComposite(
  bytes: Uint8Array,
  declaredSha256: string,
): Promise<
  | Readonly<{ ok: true; width: number; height: number; sha256: string }>
  | Readonly<{ ok: false; code: "composite_too_large" | "invalid_composite" | "unsupported_dimensions" | "unsupported_aspect" }>
> {
  if (bytes.byteLength > HARMONIZE_COMPOSITE_MAX_BYTES) {
    return { ok: false, code: "composite_too_large" };
  }
  const size = readPngSize(bytes);
  if (!size) return { ok: false, code: "invalid_composite" };
  if (size.width > HARMONIZE_COMPOSITE_MAX_EDGE || size.height > HARMONIZE_COMPOSITE_MAX_EDGE) {
    return { ok: false, code: "unsupported_dimensions" };
  }
  const capability = harmonizeProviderAcceptsComposite(size.width, size.height);
  if (!capability.ok) return capability;
  const digest = await sha256HexBytes(bytes);
  if (digest !== declaredSha256) return { ok: false, code: "invalid_composite" };
  return { ok: true, width: size.width, height: size.height, sha256: digest };
}

function authoritativeObjects(
  submission: ParsedSubmission,
  sceneObjects: readonly SceneObjectDefinition[],
):
  | Readonly<{
      ok: true;
      objects: readonly HarmonizeExportObject[];
      unmountedObjectIds: readonly string[];
      uniformScales: readonly Readonly<{ objectId: string; uniformScale: number }>[];
    }>
  | Readonly<{ ok: false; code: "stale_scene"; diagnostic: HarmonizeEnqueueDiagnostic }> {
  const saved = new Map(sceneObjects.map((object) => [object.objectId, object]));
  const mountedIds = submission.objects.map((entry) => entry.object.objectId);
  if (new Set(mountedIds).size !== mountedIds.length) {
    return sceneReject({ reason: "duplicate_mounted_ids" });
  }
  const mounted = new Set(mountedIds);
  const unmounted = new Set(submission.unmountedObjectIds);
  if (unmounted.size !== submission.unmountedObjectIds.length) {
    return sceneReject({ reason: "duplicate_unmounted_ids" });
  }
  for (const id of mounted) {
    if (unmounted.has(id)) return sceneReject({ reason: "mounted_and_unmounted", objectId: id });
  }
  if (mounted.size + unmounted.size !== saved.size) {
    return sceneReject({
      reason: "membership_count",
      submittedCount: mounted.size + unmounted.size,
      savedCount: saved.size,
    });
  }
  for (const id of [...mounted, ...unmounted]) {
    if (!saved.has(id)) return sceneReject({ reason: "unknown_object", objectId: id });
  }
  const rebuilt: HarmonizeExportObject[] = [];
  const uniformScales: Array<{ objectId: string; uniformScale: number }> = [];
  for (const entry of submission.objects) {
    const sceneObject = saved.get(entry.object.objectId);
    if (!sceneObject || !sameObject(sceneObject, entry.object, entry.uniformScale)) {
      const reason = sceneObject
        ? objectMismatchField(sceneObject, entry.object, entry.uniformScale) ?? "object_field"
        : "missing_object";
      return sceneReject(
        reason === "position" && sceneObject
          ? positionMismatchDiagnostic(sceneObject, entry.object)
          : { reason, objectId: entry.object.objectId },
      );
    }
    rebuilt.push(harmonizeExportObject({
      objectId: sceneObject.objectId,
      assetId: sceneObject.assetId,
      productId: sceneObject.productId ?? null,
      variantId: sceneObject.variantId ?? null,
      positionM: sceneObject.transform.position,
      rotationDeg: sceneObject.transform.rotationDeg,
      userSizeMultiplier: sceneObject.userSizeMultiplier ?? 1,
      localAabb: entry.object.effectiveDimensionsM
        ? {
            min: { x: 0, y: 0, z: 0 },
            max: {
              x: entry.object.effectiveDimensionsM.width,
              y: entry.object.effectiveDimensionsM.height,
              z: entry.object.effectiveDimensionsM.depth,
            },
          }
        : null,
    }));
    uniformScales.push({ objectId: sceneObject.objectId, uniformScale: sceneObject.transform.uniformScale });
  }
  for (const id of submission.unmountedObjectIds) {
    const sceneObject = saved.get(id);
    if (!sceneObject) return sceneReject({ reason: "missing_unmounted_object", objectId: id });
  }
  return {
    ok: true,
    objects: sortHarmonizeObjects(rebuilt),
    unmountedObjectIds: [...submission.unmountedObjectIds].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    uniformScales,
  };
}

function sceneReject(diagnostic: HarmonizeEnqueueDiagnostic) {
  return { ok: false as const, code: "stale_scene" as const, diagnostic };
}

function positionMismatchDiagnostic(
  sceneObject: SceneObjectDefinition,
  submitted: HarmonizeExportObject,
): HarmonizeEnqueueDiagnostic {
  const trusted = sceneObject.transform.position;
  const sent = submitted.positionM;
  return {
    reason: "position",
    objectId: sceneObject.objectId,
    submittedX: sent.x,
    submittedY: sent.y,
    submittedZ: sent.z,
    trustedX: trusted.x,
    trustedY: trusted.y,
    trustedZ: trusted.z,
    deltaX: sent.x - trusted.x,
    deltaY: sent.y - trusted.y,
    deltaZ: sent.z - trusted.z,
  };
}

function objectMismatchField(
  sceneObject: SceneObjectDefinition,
  submitted: HarmonizeExportObject,
  uniformScale: number,
): string | null {
  if (sceneObject.assetId !== submitted.assetId) return "assetId";
  if ((sceneObject.productId ?? null) !== submitted.productId) return "productId";
  if ((sceneObject.variantId ?? null) !== submitted.variantId) return "variantId";
  if ((sceneObject.userSizeMultiplier ?? 1) !== submitted.userSizeMultiplier) return "userSizeMultiplier";
  if (sceneObject.transform.uniformScale !== uniformScale) return "uniformScale";
  if (!sameVec(sceneObject.transform.position, submitted.positionM)) return "position";
  if (!sameVec(sceneObject.transform.rotationDeg, submitted.rotationDeg)) return "rotation";
  return null;
}

function sameObject(
  sceneObject: SceneObjectDefinition,
  submitted: HarmonizeExportObject,
  uniformScale: number,
): boolean {
  return sceneObject.assetId === submitted.assetId
    && (sceneObject.productId ?? null) === submitted.productId
    && (sceneObject.variantId ?? null) === submitted.variantId
    && (sceneObject.userSizeMultiplier ?? 1) === submitted.userSizeMultiplier
    && sceneObject.transform.uniformScale === uniformScale
    && sameVec(sceneObject.transform.position, submitted.positionM)
    && sameVec(sceneObject.transform.rotationDeg, submitted.rotationDeg);
}

function cameraMatches(camera: HarmonizeExportCamera, trusted: HarmonizeTrustedCamera): boolean {
  return camera.projection === "frozen-production-perspective"
    && camera.verticalFovDeg === trusted.verticalFovDeg
    && camera.near === AFC_V2_RUNTIME_CAMERA_NEAR
    && camera.far === AFC_V2_RUNTIME_CAMERA_FAR
    && camera.frame.width === trusted.frame.width
    && camera.frame.height === trusted.frame.height
    && close(camera.aspect, trusted.frame.width / trusted.frame.height)
    && sameVec(camera.pose.position, trusted.pose.position)
    && sameVec(camera.pose.lookAt, trusted.pose.lookAt)
    && sameVec(camera.pose.up, trusted.pose.up);
}

function cameraDiagnostic(
  camera: HarmonizeExportCamera,
  trusted: HarmonizeTrustedCamera,
): HarmonizeEnqueueDiagnostic {
  const fields: Record<string, string | number | boolean | null> = {};
  if (camera.projection !== "frozen-production-perspective") fields.projection = camera.projection;
  if (camera.verticalFovDeg !== trusted.verticalFovDeg) {
    fields.submittedFov = camera.verticalFovDeg;
    fields.trustedFov = trusted.verticalFovDeg;
  }
  if (camera.near !== AFC_V2_RUNTIME_CAMERA_NEAR) fields.submittedNear = camera.near;
  if (camera.far !== AFC_V2_RUNTIME_CAMERA_FAR) fields.submittedFar = camera.far;
  if (camera.frame.width !== trusted.frame.width || camera.frame.height !== trusted.frame.height) {
    fields.submittedFrameWidth = camera.frame.width;
    fields.submittedFrameHeight = camera.frame.height;
    fields.trustedFrameWidth = trusted.frame.width;
    fields.trustedFrameHeight = trusted.frame.height;
  }
  if (!close(camera.aspect, trusted.frame.width / trusted.frame.height)) {
    fields.submittedAspect = camera.aspect;
    fields.trustedAspect = trusted.frame.width / trusted.frame.height;
  }
  const axes = ["position", "lookAt", "up"] as const;
  for (const axis of axes) {
    if (sameVec(camera.pose[axis], trusted.pose[axis])) continue;
    fields[`submitted${axis}X`] = camera.pose[axis].x;
    fields[`submitted${axis}Y`] = camera.pose[axis].y;
    fields[`submitted${axis}Z`] = camera.pose[axis].z;
    fields[`trusted${axis}X`] = trusted.pose[axis].x;
    fields[`trusted${axis}Y`] = trusted.pose[axis].y;
    fields[`trusted${axis}Z`] = trusted.pose[axis].z;
  }
  return fields;
}

function materialDiagnostic(
  server: readonly HarmonizeMaterialDescriptor[],
  client: readonly HarmonizeMaterialDescriptor[],
): HarmonizeEnqueueDiagnostic {
  if (server.length !== client.length) {
    return { reason: "count", serverCount: server.length, clientCount: client.length };
  }
  const byId = new Map(client.map((item) => [item.objectId, item]));
  for (const item of server) {
    const other = byId.get(item.objectId);
    if (!other) return { reason: "missing_object", objectId: item.objectId };
    if (
      other.primaryProvenance !== item.primaryProvenance
      || other.secondaryProvenance !== item.secondaryProvenance
      || other.primaryText !== item.primaryText
      || other.secondaryText !== item.secondaryText
    ) {
      return {
        reason: "descriptor",
        objectId: item.objectId,
        serverPrimaryProvenance: item.primaryProvenance,
        clientPrimaryProvenance: other.primaryProvenance,
        serverSecondaryProvenance: item.secondaryProvenance,
        clientSecondaryProvenance: other.secondaryProvenance,
        primaryEqual: other.primaryText === item.primaryText,
        secondaryEqual: other.secondaryText === item.secondaryText,
      };
    }
  }
  return { reason: "descriptor" };
}

function sameMaterials(
  server: readonly HarmonizeMaterialDescriptor[],
  client: readonly HarmonizeMaterialDescriptor[],
): boolean {
  if (server.length !== client.length) return false;
  const byId = new Map(client.map((item) => [item.objectId, item]));
  return server.every((item) => {
    const other = byId.get(item.objectId);
    return !!other
      && other.primaryText === item.primaryText
      && other.secondaryText === item.secondaryText
      && other.primaryProvenance === item.primaryProvenance
      && other.secondaryProvenance === item.secondaryProvenance;
  });
}

function parseCamera(value: unknown): HarmonizeExportCamera | null {
  if (!isRecord(value) || !isRecord(value.frame) || !isRecord(value.pose)) return null;
  const verticalFovDeg = positive(value.verticalFovDeg);
  const aspect = positive(value.aspect);
  const near = finite(value.near);
  const far = finite(value.far);
  const width = positiveInteger(value.frame.width);
  const height = positiveInteger(value.frame.height);
  const position = parseVec(value.pose.position);
  const lookAt = parseVec(value.pose.lookAt);
  const up = parseVec(value.pose.up);
  if (
    value.projection !== "frozen-production-perspective"
    || verticalFovDeg == null || aspect == null || near == null || far == null
    || width == null || height == null || !position || !lookAt || !up
  ) {
    return null;
  }
  return {
    projection: "frozen-production-perspective",
    verticalFovDeg,
    aspect,
    near,
    far,
    frame: { width, height },
    pose: { position, lookAt, up },
  };
}

function parseObjects(
  value: unknown,
): readonly Readonly<{ object: HarmonizeExportObject; uniformScale: number }>[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const objects: Array<{ object: HarmonizeExportObject; uniformScale: number }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const uniformScale = finite(entry.uniformScale);
    const dimensions = parseDimensions(entry.effectiveDimensionsM);
    if (uniformScale == null || dimensions === undefined) return null;
    if (typeof entry.objectId !== "string" || typeof entry.assetId !== "string") return null;
    const productId = optionalId(entry.productId);
    const variantId = optionalId(entry.variantId);
    if (productId === undefined || variantId === undefined) return null;
    try {
      const object = harmonizeExportObject({
        objectId: entry.objectId,
        assetId: entry.assetId,
        productId,
        variantId,
        positionM: parseVec(entry.positionM) ?? { x: Number.NaN, y: 0, z: 0 },
        rotationDeg: parseVec(entry.rotationDeg) ?? { x: Number.NaN, y: 0, z: 0 },
        userSizeMultiplier: finite(entry.userSizeMultiplier) ?? Number.NaN,
        localAabb: dimensions,
      });
      objects.push({ object, uniformScale });
    } catch {
      return null;
    }
  }
  return objects;
}

function parseDimensions(
  value: unknown,
): { min: HarmonizeVec3; max: HarmonizeVec3 } | null | undefined {
  if (value == null) return null;
  if (!isRecord(value)) return undefined;
  const width = positive(value.width);
  const height = positive(value.height);
  const depth = positive(value.depth);
  if (width == null || height == null || depth == null) return undefined;
  return {
    min: { x: 0, y: 0, z: 0 },
    max: { x: width, y: height, z: depth },
  };
}

function parseMaterials(value: unknown): HarmonizeMaterialDescriptor[] | null {
  if (!Array.isArray(value)) return null;
  const materials: HarmonizeMaterialDescriptor[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.objectId !== "string" || entry.objectId.length === 0) return null;
    if (!isProvenance(entry.primaryProvenance) || !isProvenance(entry.secondaryProvenance)) return null;
    const primaryText = nullableString(entry.primaryText);
    const secondaryText = nullableString(entry.secondaryText);
    if (primaryText === undefined || secondaryText === undefined) return null;
    materials.push({
      objectId: entry.objectId,
      primaryText,
      secondaryText,
      primaryProvenance: entry.primaryProvenance,
      secondaryProvenance: entry.secondaryProvenance,
    });
  }
  return materials;
}

function parseIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) return null;
    ids.push(entry);
  }
  return ids;
}

function parseVec(value: unknown): HarmonizeVec3 | null {
  if (!isRecord(value)) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  const z = finite(value.z);
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

function sameVec(left: HarmonizeVec3, right: HarmonizeVec3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function close(left: number, right: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= 1e-6;
}

function isProvenance(value: unknown): value is HarmonizeMaterialProvenance {
  return typeof value === "string" && PROVENANCE.has(value as HarmonizeMaterialProvenance);
}

function optionalId(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return undefined;
  return value;
}

function nullableString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  return value;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function sha(value: unknown): string | null {
  return typeof value === "string" && SHA_RE.test(value) ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number != null && number > 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = positive(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
