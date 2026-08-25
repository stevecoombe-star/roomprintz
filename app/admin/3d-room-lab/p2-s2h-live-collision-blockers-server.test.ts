import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getAfcSr1LiveAttemptEvidence,
  retainAfcSr1LiveAttemptEmptyEvidence,
  retainAfcSr1LiveAttemptTiledEvidence,
  type AfcSr1LiveAttemptEvidence,
} from "./afc-sr1-live-product";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "./calibrated-camera-applied-authority";
import {
  createCalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceiptPayload,
} from "./calibrated-camera-freeze-receipt";
import {
  P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION,
  P2_S2F_WORLD_COORDINATE_SPACE,
  P2_S2F_WORLD_GEOMETRY_KIND,
  type ProjectedVisibleFloorBlocker,
} from "./research/empty-visible-floor-blocker-world-projection";
import {
  loadP2S2DFloorContactReviewImage,
} from "./research/p2-s2d-floor-contact-overlay-review-server";
import {
  P2_S2H_LIVE_COLLISION_BLOCKERS_CONTRACT_VERSION,
  type P2S2HLiveCollisionBlockersRequest,
} from "./p2-s2h-live-collision-blockers-contract";
import {
  produceP2S2HLiveCollisionBlockers,
} from "./p2-s2h-live-collision-blockers-server";

const ATTEMPT_ID = "s2h-live-attempt";
const RESULT_ID = "s2h-live-result";
const ORIGINAL_SHA = "1".repeat(64);
const EMPTY_SHA = "2".repeat(64);
const TILED_SHA = "3".repeat(64);
const EMPTY_BYTES = Uint8Array.of(1, 2, 3, 4);

const originalBasis = Object.freeze({
  sha256: ORIGINAL_SHA,
  byteCount: 100,
  decodedWidth: 1600,
  decodedHeight: 1200,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
});
const emptyBasis = Object.freeze({
  sha256: EMPTY_SHA,
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1600,
  decodedHeight: 1200,
  mimeType: "image/png" as const,
  orientation: 1 as const,
});
const tiledBasis = Object.freeze({
  sha256: TILED_SHA,
  byteCount: 120,
  decodedWidth: 1600,
  decodedHeight: 1200,
  mimeType: "image/png" as const,
  orientation: 1 as const,
});

function payload(
  options: Readonly<{
    attemptId?: string;
    resultId?: string;
    originalSha?: string;
    emptySha?: string;
    originalWidth?: number;
    originalHeight?: number;
    emptyWidth?: number;
    emptyHeight?: number;
    compatibilityTier?:
      | "exact_grid_compatible"
      | "aspect_compatible_rescaled";
  }> = {}
): CalibratedCameraFreezeReceiptPayload {
  const attemptId = options.attemptId ?? ATTEMPT_ID;
  const resultId = options.resultId ?? RESULT_ID;
  const originalSha = options.originalSha ?? ORIGINAL_SHA;
  const emptySha = options.emptySha ?? EMPTY_SHA;
  const originalWidth = options.originalWidth ?? 1600;
  const originalHeight = options.originalHeight ?? 1200;
  const emptyWidth = options.emptyWidth ?? 1600;
  const emptyHeight = options.emptyHeight ?? 1200;
  const compatibilityTier =
    options.compatibilityTier ?? "exact_grid_compatible";
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
        basisId:
          `${originalSha}:${originalWidth}x${originalHeight}:https://example.test/original.jpg`,
        basisFingerprint: originalSha,
        sourceImageUrl: "https://example.test/original.jpg",
        decodedWidth: originalWidth,
        decodedHeight: originalHeight,
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
      diagnosticsSummary: "S2H-c live handoff test",
    },
    original: {
      sha256: originalSha,
      decodedWidth: originalWidth,
      decodedHeight: originalHeight,
      orientation: 1,
      basisKind: "original",
    },
    empty: {
      sha256: emptySha,
      decodedWidth: emptyWidth,
      decodedHeight: emptyHeight,
      orientation: 1,
    },
    afc: {
      productVersion: "afc-sr1-complete-product-attempt/v2",
      attemptId,
      resultId,
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
        originalCompatibilityTier: compatibilityTier,
        readerSourceFloorQuad: structuredClone(polygon),
        acceptanceBasis: {
          basisFingerprint: originalSha,
          decodedWidth: originalWidth,
          decodedHeight: originalHeight,
          orientation: 1,
          transferKind: compatibilityTier === "exact_grid_compatible"
            ? "paired_cross_role_exact_grid"
            : "paired_cross_role_aspect_rescaled",
          transferProvenance: "S2H-c exact-grid test",
        },
        perspectiveAdjustment: null,
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
        floorAuthorityKey: "s2h-live-floor",
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
        evaluatedCellCount: 10,
        applySafeCellCount: 2,
        observability: {
          available: true,
          firstFailingGate: "none",
          reason: "available",
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
        reason: "available",
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

async function receipt(
  options?: Parameters<typeof payload>[0]
): Promise<CalibratedCameraFreezeReceipt> {
  const built = await createCalibratedCameraFreezeReceipt(payload(options));
  if (!built.ok) assert.fail(`${built.reason}: ${built.detail}`);
  return built.value;
}

function request(
  freezeReceipt: unknown,
  overrides: Partial<P2S2HLiveCollisionBlockersRequest> = {}
): P2S2HLiveCollisionBlockersRequest {
  return {
    attemptId: ATTEMPT_ID,
    resultId: RESULT_ID,
    labLoadGeneration: 7,
    freezeReceipt,
    ...overrides,
  };
}

function evidence(
  overrides: Readonly<{
    attemptId?: string;
    resultId?: string;
    labLoadGeneration?: number;
    originalBasis?: typeof originalBasis;
    emptyBasis?: typeof emptyBasis;
    floorEmptyBasis?: typeof emptyBasis;
    tiledBasis?: typeof tiledBasis;
    tiledResultId?: string;
  }> = {}
): AfcSr1LiveAttemptEvidence {
  const boundEmpty = overrides.emptyBasis ?? emptyBasis;
  return {
    binding: {
      attemptId: overrides.attemptId ?? ATTEMPT_ID,
      resultId: overrides.resultId ?? RESULT_ID,
      labLoadGeneration: overrides.labLoadGeneration ?? 7,
      originalBasis: overrides.originalBasis ?? originalBasis,
      emptyBasis: boundEmpty,
    },
    floorRead: {
      emptyBytes: EMPTY_BYTES,
      emptyBasis: overrides.floorEmptyBasis ?? boundEmpty,
    },
    tiledPerspective: {
      tiledBytes: Uint8Array.of(5, 6, 7),
      tiledBasis: overrides.tiledBasis ?? tiledBasis,
      resultId: overrides.tiledResultId ?? overrides.resultId ?? RESULT_ID,
    },
  };
}

const fragment = Object.freeze({
  id: "live-fragment",
  roomId: ATTEMPT_ID,
  emptyImageSha256: EMPTY_SHA,
  coordinateSpace: "empty-source-normalized/v1",
  proposalVersion: "p2-s2d-visible-floor-contact-localizer/v1",
  geometryKind: "finite_open_visible_floor_termination",
  pointsSourceNormalized: Object.freeze([
    Object.freeze({ x: 0.35, y: 0.65 }),
    Object.freeze({ x: 0.65, y: 0.65 }),
  ]),
  startEndpoint: Object.freeze({
    state: "uncertain_support_limit",
    pointSourceNormalized: Object.freeze({ x: 0.35, y: 0.65 }),
  }),
  endEndpoint: Object.freeze({
    state: "uncertain_support_limit",
    pointSourceNormalized: Object.freeze({ x: 0.65, y: 0.65 }),
  }),
});

function localizedDependencies(
  retained: AfcSr1LiveAttemptEvidence = evidence()
) {
  return {
    getEvidence: () => retained,
    readFragments: async (
      bytes: Uint8Array,
      sourceIdentity: Readonly<{
        roomId: string;
        emptyImage: Readonly<{
          sha256: string;
          dimensions: Readonly<{ width: number; height: number }>;
        }>;
      }>
    ) => {
      assert.deepEqual(bytes, EMPTY_BYTES);
      assert.deepEqual(sourceIdentity, {
        roomId: ATTEMPT_ID,
        emptyImage: {
          sha256: EMPTY_SHA,
          dimensions: { width: 1600, height: 1200 },
        },
      });
      return {
        ok: true,
        localization: { fragments: [fragment] },
      } as never;
    },
  };
}

function projected(
  pointsWorldXZ: readonly Readonly<{ x: number; z: number }>[]
): ProjectedVisibleFloorBlocker {
  return Object.freeze({
    sourceFragmentId: "live-fragment",
    sourceGeometryVersion:
      "p2-s2d-visible-floor-contact-localizer/v1",
    sourcePolicyVersion:
      "p2-s2e-visible-floor-termination-collision-policy/v1",
    projectionVersion:
      P2_S2F_VISIBLE_FLOOR_BLOCKER_WORLD_PROJECTION_VERSION,
    coordinateSpace: P2_S2F_WORLD_COORDINATE_SPACE,
    geometryKind: P2_S2F_WORLD_GEOMETRY_KIND,
    pointsWorldXZ,
    startEndpoint: Object.freeze({ state: "uncertain_support_limit" }),
    endEndpoint: Object.freeze({ state: "uncertain_support_limit" }),
  });
}

test("valid retained attempt and matching freeze return only S2G-safe blockers deterministically", async () => {
  retainAfcSr1LiveAttemptEmptyEvidence({
    attemptId: ATTEMPT_ID,
    resultId: RESULT_ID,
    labLoadGeneration: 7,
    originalBasis,
    empty: { basis: emptyBasis, bytes: EMPTY_BYTES, generated: true },
  });
  retainAfcSr1LiveAttemptTiledEvidence(
    ATTEMPT_ID,
    RESULT_ID,
    Uint8Array.of(5, 6, 7),
    tiledBasis
  );
  const freezeReceipt = await receipt();
  const dependencies = {
    ...localizedDependencies(
      getAfcSr1LiveAttemptEvidence(ATTEMPT_ID) ?? undefined
    ),
    getEvidence: getAfcSr1LiveAttemptEvidence,
  };

  const first = await produceP2S2HLiveCollisionBlockers(
    request(freezeReceipt),
    dependencies
  );
  const second = await produceP2S2HLiveCollisionBlockers(
    request(freezeReceipt),
    dependencies
  );

  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(
    first.contractVersion,
    P2_S2H_LIVE_COLLISION_BLOCKERS_CONTRACT_VERSION
  );
  assert.equal(
    first.freezeReceiptPayloadSha256,
    freezeReceipt.integrity.payloadSha256
  );
  assert.ok(first.blockerQualification.segments.length > 0);
  const keys = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      visit(child);
    }
  };
  visit(first);
  for (const forbidden of [
    "fragments",
    "policies",
    "blockers",
    "pointsWorldXZ",
    "emptyBytes",
    "calibratedCamera",
    "authority",
    "pose",
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
});

test("default live adapter runs certified S2D through S2G from retained EMPTY bytes", async () => {
  const roomC = await loadP2S2DFloorContactReviewImage("room-c");
  if (!roomC.ok) assert.fail(roomC.code);
  const roomCOriginalSha =
    "32edb8294a3e5c68d0e54bd5c387eb408b0bc1e15dad781cef0206090df4df1e";
  const roomCEmptySha =
    "b7283bb606d09bc7803543bfcbca14aa5f2041cfb91c5eb590d69d167355243f";
  assert.equal(roomC.sha256, roomCEmptySha);
  const roomCOriginalBasis = {
    ...originalBasis,
    sha256: roomCOriginalSha,
    decodedWidth: 7360,
    decodedHeight: 4912,
  };
  const roomCEmptyBasis = {
    ...emptyBasis,
    sha256: roomCEmptySha,
    byteCount: roomC.bytes.byteLength,
    decodedWidth: 1264,
    decodedHeight: 848,
  };
  const retained: AfcSr1LiveAttemptEvidence = {
    binding: {
      attemptId: ATTEMPT_ID,
      resultId: RESULT_ID,
      labLoadGeneration: 7,
      originalBasis: roomCOriginalBasis,
      emptyBasis: roomCEmptyBasis,
    },
    floorRead: {
      emptyBytes: roomC.bytes,
      emptyBasis: roomCEmptyBasis,
    },
    tiledPerspective: {
      tiledBytes: Uint8Array.of(5, 6, 7),
      tiledBasis,
      resultId: RESULT_ID,
    },
  };
  const freezeReceipt = await receipt({
    originalSha: roomCOriginalSha,
    emptySha: roomCEmptySha,
    originalWidth: 7360,
    originalHeight: 4912,
    emptyWidth: 1264,
    emptyHeight: 848,
    compatibilityTier: "aspect_compatible_rescaled",
  });

  const result = await produceP2S2HLiveCollisionBlockers(
    request(freezeReceipt),
    { getEvidence: () => retained }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.blockerQualification.segments.length > 0);
});

test("attempt, result, and lifecycle generations reject stale or cross-room receipts", async () => {
  const cases = [
    {
      freezeReceipt: await receipt({ attemptId: "other-attempt" }),
      expected: "attempt_identity_mismatch",
    },
    {
      freezeReceipt: await receipt({ resultId: "other-result" }),
      expected: "result_identity_mismatch",
    },
  ] as const;
  for (const value of cases) {
    const result = await produceP2S2HLiveCollisionBlockers(
      request(value.freezeReceipt),
      localizedDependencies()
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, value.expected);
  }

  const generation = await produceP2S2HLiveCollisionBlockers(
    request(await receipt()),
    localizedDependencies(evidence({ labLoadGeneration: 8 }))
  );
  assert.deepEqual(generation.ok ? null : generation.reason, "lab_load_generation_mismatch");
});

test("Original SHA, dimensions, and orientation are exact-bound", async () => {
  const malformed = [
    { ...originalBasis, sha256: "a".repeat(64) },
    { ...originalBasis, decodedWidth: 1599 },
    { ...originalBasis, orientation: 6 },
  ];
  for (const basis of malformed) {
    const result = await produceP2S2HLiveCollisionBlockers(
      request(await receipt()),
      localizedDependencies(evidence({ originalBasis: basis as never }))
    );
    assert.deepEqual(result.ok ? null : result.reason, "original_identity_mismatch");
  }
});

test("EMPTY SHA, dimensions, and orientation are exact-bound", async () => {
  const malformed = [
    { ...emptyBasis, sha256: "b".repeat(64) },
    { ...emptyBasis, decodedHeight: 1199 },
    { ...emptyBasis, orientation: 6 },
  ];
  for (const basis of malformed) {
    const result = await produceP2S2HLiveCollisionBlockers(
      request(await receipt()),
      localizedDependencies(evidence({
        emptyBasis: basis as never,
        floorEmptyBasis: basis as never,
      }))
    );
    assert.deepEqual(result.ok ? null : result.reason, "empty_identity_mismatch");
  }
});

test("malformed, tampered, and frame-mismatched freeze receipts authorize no blockers", async () => {
  const valid = await receipt();
  const checksumTamper = structuredClone(valid) as {
    integrity: { payloadSha256: string };
  };
  checksumTamper.integrity.payloadSha256 = "f".repeat(64);
  const frameTamper = structuredClone(valid) as {
    payload: {
      authority: { frameSize: { width: number } };
    };
  };
  frameTamper.payload.authority.frameSize.width = 1700;

  for (const freezeReceipt of [{}, checksumTamper, frameTamper]) {
    const result = await produceP2S2HLiveCollisionBlockers(
      request(freezeReceipt),
      localizedDependencies()
    );
    assert.deepEqual(result.ok ? null : result.reason, "freeze_receipt_invalid");
  }
});

test("missing, unbound, evicted, and cross-result evidence authorize no blockers", async () => {
  const freezeReceipt = await receipt();
  const missing = await produceP2S2HLiveCollisionBlockers(
    request(freezeReceipt),
    { getEvidence: () => null }
  );
  assert.deepEqual(missing.ok ? null : missing.reason, "attempt_evidence_unavailable");

  const unbound = await produceP2S2HLiveCollisionBlockers(
    request(freezeReceipt),
    { getEvidence: () => ({ floorRead: evidence().floorRead }) }
  );
  assert.deepEqual(unbound.ok ? null : unbound.reason, "attempt_binding_unavailable");

  const crossResult = await produceP2S2HLiveCollisionBlockers(
    request(freezeReceipt),
    localizedDependencies(evidence({ tiledResultId: "other-result" }))
  );
  assert.deepEqual(crossResult.ok ? null : crossResult.reason, "tiled_identity_mismatch");

  for (let index = 0; index < 9; index += 1) {
    retainAfcSr1LiveAttemptEmptyEvidence({
      attemptId: `eviction-${index}`,
      resultId: `eviction-result-${index}`,
      labLoadGeneration: index,
      originalBasis,
      empty: { basis: emptyBasis, bytes: EMPTY_BYTES, generated: true },
    });
  }
  assert.equal(getAfcSr1LiveAttemptEvidence("eviction-0"), null);
});

test("valid zero-blocker projection is a successful empty qualification", async () => {
  const result = await produceP2S2HLiveCollisionBlockers(
    request(await receipt()),
    {
      ...localizedDependencies(),
      projectBlockers: () => ({
        ok: true,
        blockers: [],
        failures: [],
      }),
    }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.blockerQualification.segments, []);
  assert.deepEqual(result.blockerQualification.rejections, []);
});

test("partial S2F loss and S2G rejection preserve only certified surviving edges", async () => {
  const source = projected([
    Object.freeze({ x: 0, z: 0 }),
    Object.freeze({ x: 0, z: 0 }),
    Object.freeze({ x: 1, z: 0 }),
  ]);
  const result = await produceP2S2HLiveCollisionBlockers(
    request(await receipt()),
    {
      ...localizedDependencies(),
      projectBlockers: () => ({
        ok: true,
        blockers: [source],
        failures: [{
          sourceFragmentId: "dropped-fragment",
          reason: "ray_plane_parallel",
          failedPointIndex: 0,
        }],
      }) as never,
    }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.blockerQualification.segments.length, 1);
  assert.equal(result.blockerQualification.rejections.length, 1);
  assert.equal(
    result.blockerQualification.rejections[0].reason,
    "degenerate_source_edge"
  );
  assert.doesNotMatch(JSON.stringify(result), /dropped-fragment|ray_plane_parallel/);
});

test("live contract is S2G-only and production sources contain no file authority", async () => {
  const root = new URL(".", import.meta.url);
  const [contract, server, route] = await Promise.all([
    readFile(new URL("p2-s2h-live-collision-blockers-contract.ts", root), "utf8"),
    readFile(new URL("p2-s2h-live-collision-blockers-server.ts", root), "utf8"),
    readFile(
      new URL(
        "../../api/admin/3d-room-lab/afc-sr1/live-collision-blockers/route.ts",
        root
      ),
      "utf8"
    ),
  ]);
  assert.match(contract, /p2-s2g-collision-safe-blocker-contract/);
  assert.doesNotMatch(
    contract,
    /ProjectedVisibleFloorBlocker|VisibleFloorTerminationFragment|PerspectiveCamera|calibrated-camera|research\/|compositor/
  );
  assert.doesNotMatch(
    `${server}\n${route}`,
    /P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT|AFC_UI1_FIXED_INPUTS_ROOT|fixtures\/p2-s1|readFile|readdir|room-[ace]\.json|compositor/
  );
});
