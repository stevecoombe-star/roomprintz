import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "../calibrated-camera-applied-authority";
import {
  createCalibratedCameraFreezeReceipt,
  serializeCalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceiptPayload,
} from "../calibrated-camera-freeze-receipt";
import { loadP2S2FWorldBlockerReviewRecord } from "./p2-s2f-world-blocker-overlay-review-server";

const ROOM_C_ORIGINAL_SHA =
  "32edb8294a3e5c68d0e54bd5c387eb408b0bc1e15dad781cef0206090df4df1e";
const ROOM_C_EMPTY_SHA =
  "b7283bb606d09bc7803543bfcbca14aa5f2041cfb91c5eb590d69d167355243f";
const TILED_SHA = "3".repeat(64);
const RECEIPT_NAME =
  "afc-sr1-32edb8294a3e5c68-calibrated-camera-authority.v1.json";

function payload(
  originalSha256 = ROOM_C_ORIGINAL_SHA,
  emptySha256 = ROOM_C_EMPTY_SHA
): CalibratedCameraFreezeReceiptPayload {
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
        basisId: `${originalSha256}:7360x4912:https://example.test/original.jpg`,
        basisFingerprint: originalSha256,
        sourceImageUrl: "https://example.test/original.jpg",
        decodedWidth: 7360,
        decodedHeight: 4912,
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
      diagnosticsSummary: "synthetic receipt-ingestion fixture",
    },
    original: {
      sha256: originalSha256,
      decodedWidth: 7360,
      decodedHeight: 4912,
      orientation: 1,
      basisKind: "original",
    },
    empty: {
      sha256: emptySha256,
      decodedWidth: 1264,
      decodedHeight: 848,
      orientation: 1,
    },
    afc: {
      productVersion: "afc-sr1-complete-product-attempt/v2",
      attemptId: "afc-synthetic-ingestion-test",
      resultId: "afc-result-synthetic-ingestion-test",
      labLoadGeneration: 1,
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
        originalCompatibilityTier: "aspect_compatible_rescaled",
        readerSourceFloorQuad: structuredClone(polygon),
        acceptanceBasis: {
          basisFingerprint: originalSha256,
          decodedWidth: 7360,
          decodedHeight: 4912,
          orientation: 1,
          transferKind: "paired_cross_role_aspect_rescaled",
          transferProvenance: "synthetic receipt-ingestion fixture",
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
        token: 1,
        floorAuthorityKey: "synthetic-floor-key",
        committedWorldWidth: 6,
        committedWorldDepth: 5,
        committedVerticalFovDeg: 50,
        rendererFrame: { width: 1600, height: 1200 },
      },
      ratioFovSettle: {
        applySafe: true,
        winningCellId: "synthetic",
        widthDepthRatio: 1.2,
        referenceDepthM: 5,
        worldWidthM: 6,
        worldDepthM: 5,
        verticalFovDeg: 50,
        evaluatedCellCount: 1,
        applySafeCellCount: 1,
        observability: {
          available: true,
          firstFailingGate: "none",
          reason: "synthetic",
          displayAvgPx: 1,
          displayMaxPx: 2,
          averageDeltaPx: 0,
          maximumDeltaPx: 0,
        },
      },
      freshCandidateValidation: {
        basisQualified: true,
        available: true,
        firstFailingGate: "none",
        reason: "synthetic",
        confidence: "high",
        cvAvgPx: 1,
        cvMaxPx: 2,
        displayAvgPx: 1,
        displayMaxPx: 2,
        averageDeltaPx: 0,
        maximumDeltaPx: 0,
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

async function buildReceipt(
  originalSha256 = ROOM_C_ORIGINAL_SHA,
  emptySha256 = ROOM_C_EMPTY_SHA
): Promise<CalibratedCameraFreezeReceipt> {
  const built = await createCalibratedCameraFreezeReceipt(
    payload(originalSha256, emptySha256)
  );
  if (!built.ok) throw new Error(built.detail);
  return built.value;
}

async function withAuthorityFile(
  serialized: string | null,
  run: () => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "p2-s2f-authority-"));
  const previous = process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
  process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT = root;
  try {
    if (serialized !== null) {
      await writeFile(path.join(root, RECEIPT_NAME), serialized, "utf8");
    }
    await run();
  } finally {
    if (typeof previous === "string") {
      process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT = previous;
    } else {
      delete process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("bound freeze receipt parses, extracts, and makes the read-only camera available", async () => {
  const receipt = await buildReceipt();
  await withAuthorityFile(
    serializeCalibratedCameraFreezeReceipt(receipt),
    async () => {
      const loaded = await loadP2S2FWorldBlockerReviewRecord("room-c");
      if (!loaded.ok) assert.fail(loaded.code);
      if (loaded.record.projection.status !== "available") {
        assert.fail(loaded.record.projection.detail);
      }
      const projection = loaded.record.projection;
      assert.equal(projection.cameraProvenance, "freeze_receipt_certified");
      assert.equal(
        projection.cameraAuthority.receiptVersion,
        "afc-sr1-calibrated-camera-freeze-receipt/v1"
      );
      assert.equal(
        projection.cameraAuthority.receiptPayloadSha256,
        receipt.integrity.payloadSha256
      );
      assert.equal(
        projection.cameraAuthority.originalSha256,
        ROOM_C_ORIGINAL_SHA
      );
      assert.equal(projection.cameraAuthority.emptySha256, ROOM_C_EMPTY_SHA);
      assert.equal(projection.cameraAuthority.tiledSha256, TILED_SHA);
      assert.equal(
        projection.cameraAuthority.attemptId,
        "afc-synthetic-ingestion-test"
      );

      const blockCount = loaded.record.policies.filter(
        policy => policy.collisionPolicy === "block"
      ).length;
      assert.equal(
        projection.blockers.length + projection.failures.length,
        blockCount
      );
      assert.ok(loaded.record.diagnostics.every(diagnostic =>
        diagnostic.projectionStatus !== "projected" ||
        diagnostic.sourcePointCount === diagnostic.worldPointCount
      ));
    }
  );
});

test("freeze receipt checksum failure is explicit and cannot fall back", async () => {
  const receipt = structuredClone(await buildReceipt()) as {
    integrity: { payloadSha256: string };
  };
  receipt.integrity.payloadSha256 = "f".repeat(64);
  await withAuthorityFile(JSON.stringify(receipt), async () => {
    const loaded = await loadP2S2FWorldBlockerReviewRecord("room-c");
    if (!loaded.ok) assert.fail(loaded.code);
    assert.equal(loaded.record.projection.status, "unavailable");
    if (loaded.record.projection.status !== "unavailable") return;
    assert.equal(
      loaded.record.projection.reason,
      "accepted_camera_freeze_receipt_invalid"
    );
    assert.match(loaded.record.projection.detail, /\(checksum\)/);
  });
});

test("freeze receipt Original identity mismatch fails closed", async () => {
  const receipt = await buildReceipt("a".repeat(64));
  await withAuthorityFile(
    serializeCalibratedCameraFreezeReceipt(receipt),
    async () => {
      const loaded = await loadP2S2FWorldBlockerReviewRecord("room-c");
      if (!loaded.ok) assert.fail(loaded.code);
      assert.equal(loaded.record.projection.status, "unavailable");
      if (loaded.record.projection.status !== "unavailable") return;
      assert.equal(
        loaded.record.projection.reason,
        "accepted_camera_original_identity_mismatch"
      );
      assert.match(loaded.record.projection.detail, /expected_original_mismatch/);
    }
  );
});

test("freeze receipt EMPTY identity mismatch fails closed", async () => {
  const receipt = await buildReceipt(ROOM_C_ORIGINAL_SHA, "b".repeat(64));
  await withAuthorityFile(
    serializeCalibratedCameraFreezeReceipt(receipt),
    async () => {
      const loaded = await loadP2S2FWorldBlockerReviewRecord("room-c");
      if (!loaded.ok) assert.fail(loaded.code);
      assert.equal(loaded.record.projection.status, "unavailable");
      if (loaded.record.projection.status !== "unavailable") return;
      assert.equal(
        loaded.record.projection.reason,
        "accepted_camera_empty_identity_mismatch"
      );
      assert.match(loaded.record.projection.detail, /expected_empty_mismatch/);
    }
  );
});

test("raw authority cannot acquire freeze-receipt provenance from its filename", async () => {
  const receipt = await buildReceipt();
  await withAuthorityFile(
    JSON.stringify(receipt.payload.authority),
    async () => {
      const loaded = await loadP2S2FWorldBlockerReviewRecord("room-c");
      if (!loaded.ok) assert.fail(loaded.code);
      if (loaded.record.projection.status !== "available") {
        assert.fail(loaded.record.projection.detail);
      }
      assert.equal(
        loaded.record.projection.cameraProvenance,
        "raw_applied_authority"
      );
      assert.equal(loaded.record.projection.cameraAuthority.receiptVersion, null);
      assert.equal(loaded.record.projection.cameraAuthority.receiptSha256, null);
      assert.equal(loaded.record.projection.cameraAuthority.emptySha256, null);
      assert.equal(loaded.record.projection.cameraAuthority.tiledSha256, null);
    }
  );
});

test("absent room-bound authority remains unavailable without a fallback camera", async () => {
  await withAuthorityFile(null, async () => {
    const loaded = await loadP2S2FWorldBlockerReviewRecord("room-c");
    if (!loaded.ok) assert.fail(loaded.code);
    assert.equal(loaded.record.projection.status, "unavailable");
    if (loaded.record.projection.status !== "unavailable") return;
    assert.equal(
      loaded.record.projection.reason,
      "accepted_camera_snapshot_unavailable"
    );
    assert.match(loaded.record.projection.detail, /No room-bound authority/);
    assert.ok(loaded.record.diagnostics.every(diagnostic =>
      diagnostic.projectionStatus === "unavailable" &&
      diagnostic.worldPointCount === 0
    ));
  });
});
