import "server-only";

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseCalibratedCameraAppliedAuthority,
  type ParsedCalibratedCameraAppliedAuthority,
} from "../calibrated-camera-applied-authority";
import {
  extractCalibratedCameraAppliedAuthority,
  parseCalibratedCameraFreezeReceipt,
} from "../calibrated-camera-freeze-receipt";
import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../calibrated-camera-readonly-projection";
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
  type P2S2FCameraAuthorityDiagnostics,
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
  orientation: 1;
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
  >["reason"],
  detail: string
): Extract<P2S2FWorldBlockerReviewProjection, { status: "unavailable" }> {
  return Object.freeze({
    status: "unavailable",
    cameraProvenance: "unavailable",
    reason,
    detail,
  });
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
}

type AcceptedCameraFile =
  | Readonly<{ ok: true; serialized: string }>
  | Readonly<{ ok: false; detail: string }>;

async function readAcceptedCameraFile(
  root: string,
  roomId: P2S2FWorldBlockerReviewRoomId,
  originalSha256: string
): Promise<AcceptedCameraFile> {
  const names = [
    `afc-sr1-${originalSha256.slice(0, 16)}-calibrated-camera-authority.v1.json`,
    `${roomId}.json`,
  ];
  for (const name of names) {
    const candidate = path.resolve(root, name);
    if (!inside(root, candidate)) {
      return {
        ok: false,
        detail: `Configured authority source escaped its root: ${name}`,
      };
    }
    try {
      return { ok: true, serialized: await readFile(candidate, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return {
        ok: false,
        detail: `Configured authority source could not be read: ${name}`,
      };
    }
  }
  return {
    ok: false,
    detail:
      "No room-bound authority file exists in the configured snapshot root.",
  };
}

function receiptUnavailableReason(
  reason: string
): Extract<
  P2S2FWorldBlockerReviewProjection,
  { status: "unavailable" }
>["reason"] {
  if (reason === "expected_original_mismatch") {
    return "accepted_camera_original_identity_mismatch";
  }
  if (reason === "expected_empty_mismatch") {
    return "accepted_camera_empty_identity_mismatch";
  }
  if (reason === "expected_tiled_mismatch") {
    return "accepted_camera_tiled_identity_mismatch";
  }
  return "accepted_camera_freeze_receipt_invalid";
}

function rawCameraDiagnostics(
  authority: ParsedCalibratedCameraAppliedAuthority
): P2S2FCameraAuthorityDiagnostics {
  return Object.freeze({
    source: "raw_applied_authority",
    authorityVersion: authority.authorityVersion,
    receiptVersion: null,
    receiptSha256: null,
    receiptPayloadSha256: null,
    originalSha256: authority.imageBasis.basisFingerprint,
    emptySha256: null,
    tiledSha256: null,
    attemptId: null,
    appliedAtIso: authority.appliedAtIso,
    worldWidth: authority.floorMapping.worldWidth,
    worldDepth: authority.floorMapping.worldDepth,
    verticalFovDeg: authority.verticalFovDeg,
    applyFrame: authority.frameSize,
    calibrationVersion: authority.calibrationVersion,
    solver: authority.solver,
  });
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
      projection: unavailable(
        "accepted_camera_snapshot_not_configured",
        "P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT is not configured."
      ),
      result: null,
    };
  }
  const root = path.resolve(configuredRoot);
  const acceptedFile = await readAcceptedCameraFile(
    root,
    roomId,
    imagePair.original.sha256
  );
  if (!acceptedFile.ok) {
    return {
      projection: unavailable(
        "accepted_camera_snapshot_unavailable",
        acceptedFile.detail
      ),
      result: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(acceptedFile.serialized) as unknown;
  } catch {
    return {
      projection: unavailable(
        "accepted_camera_snapshot_invalid",
        "Configured authority source is not valid JSON."
      ),
      result: null,
    };
  }

  let authority: ParsedCalibratedCameraAppliedAuthority;
  let cameraAuthority: P2S2FCameraAuthorityDiagnostics;
  if (isRecord(parsed) && "receiptVersion" in parsed) {
    const receipt = await parseCalibratedCameraFreezeReceipt(parsed, {
      original: imagePair.original,
      empty: imagePair.empty,
    });
    if (!receipt.ok) {
      return {
        projection: unavailable(
          receiptUnavailableReason(receipt.reason),
          `Freeze receipt rejected (${receipt.reason}): ${receipt.detail}`
        ),
        result: null,
      };
    }
    authority = extractCalibratedCameraAppliedAuthority(receipt.value);
    cameraAuthority = Object.freeze({
      source: "freeze_receipt_certified",
      authorityVersion: authority.authorityVersion,
      receiptVersion: receipt.value.receiptVersion,
      receiptSha256: createHash("sha256")
        .update(acceptedFile.serialized)
        .digest("hex"),
      receiptPayloadSha256: receipt.value.integrity.payloadSha256,
      originalSha256: receipt.value.payload.original.sha256,
      emptySha256: receipt.value.payload.empty.sha256,
      tiledSha256: receipt.value.payload.afc.tiled.image.sha256,
      attemptId: receipt.value.payload.afc.attemptId,
      appliedAtIso: authority.appliedAtIso,
      worldWidth: authority.floorMapping.worldWidth,
      worldDepth: authority.floorMapping.worldDepth,
      verticalFovDeg: authority.verticalFovDeg,
      applyFrame: authority.frameSize,
      calibrationVersion: authority.calibrationVersion,
      solver: authority.solver,
    });
  } else {
    const raw = isRecord(parsed) && "calibrationAppliedAuthority" in parsed
      ? parsed.calibrationAppliedAuthority
      : parsed;
    const parsedAuthority = parseCalibratedCameraAppliedAuthority(
      raw,
      FLOOR_SOURCE_COORDINATE_EXTENT
    );
    if (!parsedAuthority.ok) {
      return {
        projection: unavailable(
          "accepted_camera_snapshot_invalid",
          `Raw applied authority rejected: ${parsedAuthority.reason}.`
        ),
        result: null,
      };
    }
    authority = parsedAuthority.value;
    if (
      authority.imageBasis.basisKind !== "original" ||
      authority.imageBasis.basisFingerprint !== imagePair.original.sha256 ||
      authority.imageBasis.decodedWidth !== imagePair.original.decodedWidth ||
      authority.imageBasis.decodedHeight !== imagePair.original.decodedHeight ||
      authority.imageBasis.encodedOrientation !== imagePair.original.orientation
    ) {
      return {
        projection: unavailable(
          "accepted_camera_original_basis_mismatch",
          "Raw applied authority Original identity does not match the controlled room manifest."
        ),
        result: null,
      };
    }
    cameraAuthority = rawCameraDiagnostics(authority);
  }

  const camera = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: authority.verticalFovDeg,
    pose: authority.pose,
    frameSize: authority.frameSize,
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  if (!camera.ok) {
    return {
      projection: unavailable(
        "accepted_camera_frame_invalid",
        `Read-only projection camera rejected the authority: ${camera.reason}`
      ),
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
    containerSize: authority.frameSize,
    calibratedCamera: camera.camera,
  });
  if (!result.ok) {
    return {
      projection: unavailable(
        "accepted_camera_snapshot_invalid",
        `Projection input rejected (${result.reason}): ${result.detail}`
      ),
      result,
    };
  }
  return {
    projection: Object.freeze({
      status: "available",
      cameraProvenance: cameraAuthority.source,
      cameraAppliedAtIso: authority.appliedAtIso,
      cameraAuthority,
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
