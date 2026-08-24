import "server-only";

import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../calibrated-camera-readonly-projection";
import { parseCalibratedCameraAppliedAuthority } from "../calibrated-camera-restore-authority";
import { FLOOR_SOURCE_COORDINATE_EXTENT } from "../floor-coordinate-extent";
import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import { projectVisibleFloorBlockersToWorldXZ } from "./empty-visible-floor-blocker-world-projection";
import {
  loadP2S2ETerminationCollisionReviewImage,
  loadP2S2ETerminationCollisionReviewRecord,
  type P2S2ETerminationCollisionReviewImageLoadResult,
} from "./p2-s2e-termination-collision-overlay-review-server";
import {
  buildP2S2FFragmentReviewDiagnostics,
  type P2S2FWorldBlockerReviewProjection,
  type P2S2FWorldBlockerReviewRecord,
  type P2S2FWorldBlockerReviewRoomId,
} from "./p2-s2f-world-blocker-overlay-review";

export type P2S2FWorldBlockerReviewLoadResult =
  | Readonly<{ ok: true; record: P2S2FWorldBlockerReviewRecord }>
  | Readonly<{
      ok: false;
      code:
        | "source_review_unavailable"
        | "source_image_pair_authority_unavailable"
        | "projection_input_invalid";
    }>;

export type P2S2FWorldBlockerReviewImageLoadResult =
  P2S2ETerminationCollisionReviewImageLoadResult;

type ManifestImage = Readonly<{
  sha256: string;
  decodedWidth: number;
  decodedHeight: number;
  orientation: number;
}>;

type ImagePairAuthority = Readonly<{
  original: ManifestImage;
  empty: ManifestImage;
}>;

type ImageManifest = Readonly<{
  contractVersion: "afc-r3c-image-manifest/v1";
  roomId: string;
  original: ManifestImage;
  emptyRoomAssist: ManifestImage & Readonly<{
    generatedFromOriginalSha256: string;
  }>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0;
}

function manifestImage(value: unknown): value is ManifestImage {
  return isRecord(value) &&
    typeof value.sha256 === "string" &&
    finitePositiveInteger(value.decodedWidth) &&
    finitePositiveInteger(value.decodedHeight) &&
    value.orientation === 1;
}

function parseManifest(value: unknown): ImageManifest | null {
  if (
    !isRecord(value) ||
    value.contractVersion !== "afc-r3c-image-manifest/v1" ||
    typeof value.roomId !== "string" ||
    !manifestImage(value.original) ||
    !isRecord(value.emptyRoomAssist) ||
    typeof value.emptyRoomAssist.generatedFromOriginalSha256 !== "string" ||
    !manifestImage(value.emptyRoomAssist)
  ) return null;
  return value as ImageManifest;
}

async function loadImagePairAuthority(
  roomId: P2S2FWorldBlockerReviewRoomId,
  expectedEmpty: Readonly<{
    sha256: string;
    dimensions: Readonly<{ width: number; height: number }>;
  }>
): Promise<ImagePairAuthority | null> {
  const configuredRoot = process.env.AFC_UI1_FIXED_INPUTS_ROOT ?? path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );
  const root = await resolveAfcUi2aFixedInputsRoot(configuredRoot);
  if (!root.ok) return null;
  const roomDirectory = path.join(root.root, roomId);
  let names: string[];
  try {
    names = (await readdir(roomDirectory))
      .filter(name => name.endsWith(".image-manifest.v1.json"))
      .sort();
  } catch {
    return null;
  }

  const matches: ImagePairAuthority[] = [];
  for (const name of names) {
    let parsed: ImageManifest | null;
    try {
      parsed = parseManifest(JSON.parse(
        await readFile(path.join(roomDirectory, name), "utf8")
      ) as unknown);
    } catch {
      parsed = null;
    }
    if (
      !parsed ||
      parsed.roomId !== roomId ||
      parsed.emptyRoomAssist.sha256 !== expectedEmpty.sha256 ||
      parsed.emptyRoomAssist.decodedWidth !== expectedEmpty.dimensions.width ||
      parsed.emptyRoomAssist.decodedHeight !== expectedEmpty.dimensions.height ||
      parsed.emptyRoomAssist.generatedFromOriginalSha256 !== parsed.original.sha256
    ) continue;
    matches.push(Object.freeze({
      original: parsed.original,
      empty: parsed.emptyRoomAssist,
    }));
  }
  return matches.length === 1 ? matches[0] : null;
}

function unavailable(
  reason: Extract<
    P2S2FWorldBlockerReviewProjection,
    { status: "unavailable" }
  >["reason"]
): Extract<P2S2FWorldBlockerReviewProjection, { status: "unavailable" }> {
  return Object.freeze({
    status: "unavailable",
    cameraProvenance: "unavailable",
    reason,
  });
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

async function loadProjection(
  roomId: P2S2FWorldBlockerReviewRoomId,
  source: Extract<
    Awaited<ReturnType<typeof loadP2S2ETerminationCollisionReviewRecord>>,
    { ok: true }
  >["record"],
  imagePair: ImagePairAuthority
): Promise<Readonly<{
  projection: P2S2FWorldBlockerReviewProjection;
  result: ReturnType<typeof projectVisibleFloorBlockersToWorldXZ> | null;
}>> {
  const configuredRoot =
    process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT?.trim();
  if (!configuredRoot) {
    return {
      projection: unavailable("accepted_camera_snapshot_not_configured"),
      result: null,
    };
  }
  const root = path.resolve(configuredRoot);
  const snapshotPath = path.resolve(root, `${roomId}.json`);
  if (!inside(root, snapshotPath)) {
    return {
      projection: unavailable("accepted_camera_snapshot_unavailable"),
      result: null,
    };
  }

  let raw: unknown;
  try {
    const parsed = JSON.parse(await readFile(snapshotPath, "utf8")) as unknown;
    raw = isRecord(parsed) && "calibrationAppliedAuthority" in parsed
      ? parsed.calibrationAppliedAuthority
      : parsed;
  } catch {
    return {
      projection: unavailable("accepted_camera_snapshot_unavailable"),
      result: null,
    };
  }
  const authority = parseCalibratedCameraAppliedAuthority(
    raw,
    FLOOR_SOURCE_COORDINATE_EXTENT
  );
  if (!authority.ok) {
    return {
      projection: unavailable("accepted_camera_snapshot_invalid"),
      result: null,
    };
  }
  if (
    authority.value.imageBasis.basisKind !== "original" ||
    authority.value.imageBasis.basisFingerprint !== imagePair.original.sha256 ||
    authority.value.imageBasis.decodedWidth !== imagePair.original.decodedWidth ||
    authority.value.imageBasis.decodedHeight !== imagePair.original.decodedHeight ||
    authority.value.imageBasis.encodedOrientation !== imagePair.original.orientation
  ) {
    return {
      projection: unavailable("accepted_camera_original_basis_mismatch"),
      result: null,
    };
  }

  const camera = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: authority.value.verticalFovDeg,
    pose: authority.value.pose,
    frameSize: authority.value.frameSize,
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  if (!camera.ok) {
    return {
      projection: unavailable("accepted_camera_snapshot_invalid"),
      result: null,
    };
  }
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: imagePair.original.sha256,
      decodedWidth: imagePair.original.decodedWidth,
      decodedHeight: imagePair.original.decodedHeight,
      orientation: imagePair.original.orientation,
    },
    {
      fingerprint: imagePair.empty.sha256,
      decodedWidth: imagePair.empty.decodedWidth,
      decodedHeight: imagePair.empty.decodedHeight,
      orientation: imagePair.empty.orientation,
    }
  );
  const result = projectVisibleFloorBlockersToWorldXZ({
    fragments: source.fragments,
    policies: source.policies,
    emptyIntrinsicSize: source.dimensions,
    originalIntrinsicSize: {
      width: imagePair.original.decodedWidth,
      height: imagePair.original.decodedHeight,
    },
    compatibility,
    containerSize: authority.value.frameSize,
    calibratedCamera: camera.camera,
  });
  if (!result.ok) return { projection: unavailable("accepted_camera_snapshot_invalid"), result };
  return {
    projection: Object.freeze({
      status: "available",
      cameraProvenance: "reconstituted_accepted_snapshot",
      cameraAppliedAtIso: authority.value.appliedAtIso,
      blockers: result.blockers,
      failures: result.failures,
    }),
    result,
  };
}

export async function loadP2S2FWorldBlockerReviewImage(
  roomId: P2S2FWorldBlockerReviewRoomId
): Promise<P2S2FWorldBlockerReviewImageLoadResult> {
  return loadP2S2ETerminationCollisionReviewImage(roomId);
}

export async function loadP2S2FWorldBlockerReviewRecord(
  roomId: P2S2FWorldBlockerReviewRoomId
): Promise<P2S2FWorldBlockerReviewLoadResult> {
  const source = await loadP2S2ETerminationCollisionReviewRecord(roomId);
  if (!source.ok) return { ok: false, code: "source_review_unavailable" };
  const imagePair = await loadImagePairAuthority(roomId, {
    sha256: source.record.emptyImageSha256,
    dimensions: source.record.dimensions,
  });
  if (!imagePair) {
    return { ok: false, code: "source_image_pair_authority_unavailable" };
  }
  const projected = await loadProjection(roomId, source.record, imagePair);
  if (projected.result && !projected.result.ok) {
    return { ok: false, code: "projection_input_invalid" };
  }
  return Object.freeze({
    ok: true,
    record: Object.freeze({
      roomId,
      emptyImageSha256: source.record.emptyImageSha256,
      dimensions: source.record.dimensions,
      fragments: source.record.fragments,
      policies: source.record.policies,
      projection: projected.projection,
      diagnostics: buildP2S2FFragmentReviewDiagnostics(
        source.record.fragments,
        source.record.policies,
        projected.result
      ),
    }),
  });
}
