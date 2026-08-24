import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  freezeAppliedTiledAfcCamera,
  type AppliedTiledAfcCameraFreezeInput,
} from "./afc-calibrated-camera-authority-freeze";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "./calibrated-camera-applied-authority";
import {
  CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
  buildCalibratedCameraFreezeReceiptFilename,
  createCalibratedCameraFreezeReceipt,
  extractCalibratedCameraAppliedAuthority,
  parseCalibratedCameraFreezeReceipt,
  serializeCalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceiptPayload,
} from "./calibrated-camera-freeze-receipt";

const ORIGINAL_SHA = "1".repeat(64);
const EMPTY_SHA = "2".repeat(64);
const TILED_SHA = "3".repeat(64);

function payload(): CalibratedCameraFreezeReceiptPayload {
  const polygon = [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.8, y: 0.9 },
    { x: 0.2, y: 0.9 },
  ] as const;
  const pose = {
    position: { x: 0, y: 5, z: 8 },
    lookAt: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };
  return {
    frozenAtIso: "2026-08-24T18:00:00.000Z",
    authority: {
      authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
      appliedAtIso: "2026-08-24T17:59:59.999Z",
      verticalFovDeg: 50,
      frameSize: { width: 1600, height: 1200 },
      pose: structuredClone(pose),
      imageBasis: {
        basisId: `${ORIGINAL_SHA}:1600x1200:https://example.test/original.jpg`,
        basisFingerprint: ORIGINAL_SHA,
        sourceImageUrl: "https://example.test/original.jpg",
        decodedWidth: 1600,
        decodedHeight: 1200,
        encodedOrientation: 1,
        decodedOrientationNormal: true,
        orientationTransform: "identity",
        dimensionSource: "server",
        coordinateSpaceVersion: {
          decoderId: "sharp-metadata/v1",
          normalizationPolicyVersion: "orientation-normal/v1",
          orientationApplied: false,
        },
        basisKind: "original",
      },
      sourceFloorPolygon: structuredClone(polygon),
      floorMapping: { worldWidth: 6, worldDepth: 5 },
      calibrationVersion:
        CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
      diagnosticsSummary:
        "high confidence; residuals within apply gate",
    },
    original: {
      sha256: ORIGINAL_SHA,
      decodedWidth: 1600,
      decodedHeight: 1200,
      orientation: 1,
      basisKind: "original",
    },
    empty: {
      sha256: EMPTY_SHA,
      decodedWidth: 1600,
      decodedHeight: 1200,
      orientation: 1,
    },
    afc: {
      productVersion: "afc-sr1-complete-product-attempt/v2",
      attemptId: "afc-attempt-1",
      resultId: "afc-result-1",
      labLoadGeneration: 7,
      geometryMode: "tiled-perspective-core",
      geometryAuthority: "tiled_perspective_reader",
      perspectiveAuthority: "tiled_perspective_core",
      metricScaleAuthority: "provisional_reference_depth",
      referenceDepthM: 5,
      acceptedReferenceDepthEvidence: {
        kind: "afc-live-metric-reference-depth",
        referenceDepthM: 5,
      },
      tiled: {
        image: {
          sha256: TILED_SHA,
          decodedWidth: 1600,
          decodedHeight: 1200,
          orientation: 1,
        },
        readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        lineageDigest: "4".repeat(64),
        transfer: "identity_source_normalized",
        originalCompatibilityTier: "exact_grid_compatible",
        readerSourceFloorQuad: structuredClone(polygon),
        acceptanceBasis: {
          basisFingerprint: ORIGINAL_SHA,
          decodedWidth: 1600,
          decodedHeight: 1200,
          orientation: 1,
          transferKind: "paired_cross_role_exact_grid",
          transferProvenance: "validated exact-grid lineage",
        },
        perspectiveAdjustment: {
          mode: "tiled_symmetric_near_edge_v1",
          committedDelta: 0,
          adjustmentCount: 0,
        },
      },
    },
    acceptedCalibration: {
      sourceFloorPolygon: structuredClone(polygon),
      worldWidth: 6,
      worldDepth: 5,
      verticalFovDeg: 50,
      applyFrame: { width: 1600, height: 1200 },
      appliedPose: structuredClone(pose),
    },
    applyEvidence: {
      transaction: {
        validation: "passed",
        token: 4,
        floorAuthorityKey: "floor-key",
        committedWorldWidth: 6,
        committedWorldDepth: 5,
        committedVerticalFovDeg: 50,
        rendererFrame: { width: 1600, height: 1200 },
      },
      ratioFovSettle: {
        applySafe: true,
        winningCellId: "ratio=1.200;fov=50.0",
        widthDepthRatio: 1.2,
        referenceDepthM: 5,
        worldWidthM: 6,
        worldDepthM: 5,
        verticalFovDeg: 50,
        evaluatedCellCount: 100,
        applySafeCellCount: 4,
        observability: {
          available: true,
          firstFailingGate: "none",
          reason: "available",
          displayAvgPx: 1.1,
          displayMaxPx: 2.2,
          averageDeltaPx: 0.1,
          maximumDeltaPx: 0.2,
        },
      },
      freshCandidateValidation: {
        basisQualified: true,
        available: true,
        firstFailingGate: "none",
        reason: "available",
        confidence: "high",
        cvAvgPx: 1,
        cvMaxPx: 2,
        displayAvgPx: 1.1,
        displayMaxPx: 2.2,
        averageDeltaPx: 0.1,
        maximumDeltaPx: 0.2,
        scaleRatio: 1,
        frameSize: { width: 1600, height: 1200 },
      },
      cameraApply: {
        writer: "applyCalibratedCameraSnapshotFromCandidate",
        succeeded: true,
        labState: "applied",
        imageBasisQualified: true,
        imageBasisKind: "original",
        snapshotFrameMatchedRenderer: true,
        capturedBeforeSubsequentMutation: true,
      },
    },
  };
}

test("freezes exact applied camera values with deterministic canonical output", async () => {
  const source = payload();
  const first = await createCalibratedCameraFreezeReceipt(source);
  const second = await createCalibratedCameraFreezeReceipt(source);
  if (!first.ok) throw new Error(first.detail);
  if (!second.ok) throw new Error(second.detail);
  assert.deepEqual(first.value.payload.authority, source.authority);
  assert.deepEqual(
    first.value.payload.acceptedCalibration.appliedPose,
    source.authority.pose
  );
  assert.equal(
    first.value.integrity.payloadSha256,
    second.value.integrity.payloadSha256
  );
  assert.equal(
    serializeCalibratedCameraFreezeReceipt(first.value),
    serializeCalibratedCameraFreezeReceipt(second.value)
  );
});

test("freezing leaves its source unchanged and deeply freezes the receipt", async () => {
  const source = payload();
  const before = structuredClone(source);
  const result = await createCalibratedCameraFreezeReceipt(source);
  if (!result.ok) throw new Error(result.detail);
  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.payload), true);
  assert.equal(Object.isFrozen(result.value.payload.authority.pose), true);
  assert.equal(
    Object.isFrozen(result.value.payload.authority.sourceFloorPolygon[0]),
    true
  );
});

test("parse verifies checksum and exposes the existing applied authority", async () => {
  const built = await createCalibratedCameraFreezeReceipt(payload());
  if (!built.ok) throw new Error(built.detail);
  const parsed = await parseCalibratedCameraFreezeReceipt(
    JSON.parse(serializeCalibratedCameraFreezeReceipt(built.value))
  );
  if (!parsed.ok) throw new Error(parsed.detail);
  assert.equal(
    extractCalibratedCameraAppliedAuthority(parsed.value).authorityVersion,
    CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION
  );
  assert.equal(
    buildCalibratedCameraFreezeReceiptFilename(parsed.value),
    `afc-sr1-${ORIGINAL_SHA.slice(0, 16)}-calibrated-camera-authority.v1.json`
  );
});

test("rejects a bad checksum and wrong receipt version", async () => {
  const built = await createCalibratedCameraFreezeReceipt(payload());
  if (!built.ok) throw new Error(built.detail);
  const checksumTamper = structuredClone(
    built.value
  ) as unknown as {
    integrity: { payloadSha256: string };
  };
  checksumTamper.integrity.payloadSha256 = "f".repeat(64);
  const badChecksum =
    await parseCalibratedCameraFreezeReceipt(checksumTamper);
  assert.deepEqual(
    badChecksum.ok ? null : badChecksum.reason,
    "checksum"
  );
  const versionTamper = structuredClone(built.value) as {
    receiptVersion: string;
  };
  versionTamper.receiptVersion = "wrong/v1";
  const wrongVersion =
    await parseCalibratedCameraFreezeReceipt(versionTamper);
  assert.deepEqual(
    wrongVersion.ok ? null : wrongVersion.reason,
    "receipt_version"
  );
});

test("rejects mismatched Original and expected EMPTY identities", async () => {
  const originalMismatch = payload();
  (
    originalMismatch.original as {
      sha256: string;
    }
  ).sha256 = "9".repeat(64);
  const originalResult =
    await createCalibratedCameraFreezeReceipt(originalMismatch);
  assert.deepEqual(
    originalResult.ok ? null : originalResult.reason,
    "original_authority_mismatch"
  );

  const built = await createCalibratedCameraFreezeReceipt(payload());
  if (!built.ok) throw new Error(built.detail);
  const emptyResult = await parseCalibratedCameraFreezeReceipt(
    built.value,
    {
      empty: {
        ...built.value.payload.empty,
        sha256: "8".repeat(64),
      },
    }
  );
  assert.deepEqual(
    emptyResult.ok ? null : emptyResult.reason,
    "expected_empty_mismatch"
  );
});

test("rejects altered pose and floor mapping instead of reconstructing", async () => {
  const poseTamper = payload();
  poseTamper.authority.pose.position.x = 1;
  const poseResult =
    await createCalibratedCameraFreezeReceipt(poseTamper);
  assert.deepEqual(
    poseResult.ok ? null : poseResult.reason,
    "accepted_calibration_mismatch"
  );

  const mappingTamper = payload();
  mappingTamper.authority.floorMapping.worldWidth = 7;
  const mappingResult =
    await createCalibratedCameraFreezeReceipt(mappingTamper);
  assert.deepEqual(
    mappingResult.ok ? null : mappingResult.reason,
    "accepted_calibration_mismatch"
  );
});

function hostInput(): AppliedTiledAfcCameraFreezeInput {
  const base = payload();
  return {
    appliedSnapshot: {
      pose: structuredClone(base.authority.pose),
      fovDeg: base.authority.verticalFovDeg,
      frameSize: { ...base.authority.frameSize },
      diagnosticsSummary: base.authority.diagnosticsSummary,
      appliedAtIso: base.authority.appliedAtIso,
      imageBasis: structuredClone(base.authority.imageBasis),
      sourceFloorPolygon: structuredClone(
        base.authority.sourceFloorPolygon
      ),
    },
    liveResult: {
      status: "authoritative_geometry",
      schemaVersion: "afc-sr1-complete-product-attempt/v2",
      attemptId: base.afc.attemptId,
      resultId: base.afc.resultId,
      labLoadGeneration: base.afc.labLoadGeneration,
      originalBasis: {
        ...base.original,
        byteCount: 100,
        mimeType: "image/jpeg",
      },
      emptyBasis: {
        ...base.empty,
        byteCount: 90,
        mimeType: "image/png",
      },
      geometry: {
        mode: "tiled-perspective-core",
        geometryAuthority: "tiled_perspective_reader",
        sourceNormalizedPolygon:
          base.afc.tiled.readerSourceFloorQuad,
        acceptanceBasis: base.afc.tiled.acceptanceBasis,
        tiledPerspective: {
          tiledBasis: {
            ...base.afc.tiled.image,
            byteCount: 110,
            mimeType: "image/png",
          },
          emptyToTiledLineageDigest:
            base.afc.tiled.lineageDigest,
          emptyToTiledTransfer:
            "identity_source_normalized",
          emptyToOriginalCompatibilityTier:
            "exact_grid_compatible",
          readerVersion:
            "afc-sr1-tiled-perspective-reader/s1",
        },
      },
      metric: {
        perspectiveAuthority: "tiled_perspective_core",
        metricScaleAuthority: "provisional_reference_depth",
        referenceDepthM: 5,
      },
    } as unknown as AppliedTiledAfcCameraFreezeInput["liveResult"],
    pending: {
      token: 4,
      floorAuthorityKey: "floor-key",
      basisFingerprint: ORIGINAL_SHA,
      decodedWidth: 1600,
      decodedHeight: 1200,
      worldWidthM: 6,
      worldDepthM: 5,
      verticalFovDeg: 50,
      frameWidth: 1600,
      frameHeight: 1200,
    },
    settle: {
      ok: true,
      widthDepthRatio: 1.2,
      referenceDepthM: 5,
      worldWidthM: 6,
      worldDepthM: 5,
      verticalFovDeg: 50,
      winningCellId: "ratio=1.200;fov=50.0",
      applyObservability:
        base.applyEvidence.ratioFovSettle.observability,
      evaluatedCellCount: 100,
      applySafeCellCount: 4,
    },
    candidate: {
      confidence: "high",
      cvAvgPx: 1,
      cvMaxPx: 2,
      displayAvgPx: 1.1,
      displayMaxPx: 2.2,
      scaleRatio: 1,
      frameSize: { width: 1600, height: 1200 },
    },
    candidateEvaluation: {
      available: true,
      reason: "available",
      firstFailingGate: "none",
    },
    basisQualified: true,
    frozenAtIso: base.frozenAtIso,
    perspectiveAdjustment: base.afc.tiled.perspectiveAdjustment,
  };
}

test("apply seam freezes only a successful snapshot and uses it exactly", async () => {
  const input = hostInput();
  const successful = await freezeAppliedTiledAfcCamera(input);
  if (!successful.ok) throw new Error(successful.detail);
  assert.deepEqual(
    successful.value.payload.authority.pose,
    input.appliedSnapshot?.pose
  );

  const failed = await freezeAppliedTiledAfcCamera({
    ...input,
    appliedSnapshot: null,
  });
  assert.deepEqual(
    failed.ok ? null : failed.reason,
    "camera_apply_not_successful"
  );
});

test("freeze builder and parser are structurally isolated from solve paths", () => {
  for (const relative of [
    "./calibrated-camera-applied-authority.ts",
    "./calibrated-camera-freeze-receipt.ts",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(perspective-solve|ratio-fov-harness|afc-fixed-seam-calibration|tiled-live-product|compositor)[^"']*["']/
    );
  }
});

test("receipt contract version remains independent of camera authority version", () => {
  assert.equal(
    CALIBRATED_CAMERA_FREEZE_RECEIPT_VERSION,
    "afc-sr1-calibrated-camera-freeze-receipt/v1"
  );
  assert.equal(
    CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
    "calibrated-camera-applied-authority/v1"
  );
});
