import {
  buildVerticalEvidenceObservationId,
  buildVerticalEvidenceSuggestionId,
  VERTICAL_EVIDENCE_MODEL_VERSION,
  VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION,
  type VerticalEvidenceObservation,
} from "./vertical-evidence";
import {
  applySyntheticPixelPerturbation,
  buildSyntheticIntrinsicsFromFov,
  createSyntheticCamera,
  intrinsicPixelsToSourceNormalized,
  projectSyntheticFloorRectangle,
  projectSyntheticVerticalSegment,
  type ProjectedVerticalSegment,
  type SyntheticCamera,
  type SyntheticIntrinsics,
  type SyntheticVec2,
  type SyntheticVerticalSegment,
} from "./v3-synthetic-camera";

export type SyntheticFixtureId =
  | "v3-synthetic-1-centered-zero-roll"
  | "v3-synthetic-2-off-axis-zero-roll"
  | "v3-synthetic-3-positive-roll"
  | "v3-synthetic-4-negative-roll"
  | "v3-synthetic-5-perturbed-floor-clean-verticals"
  | "v3-synthetic-5b-single-camera-floor-corner-perturbation"
  | "v3-synthetic-6-exact-floor-perturbed-verticals"
  | "v3-synthetic-7-bimodal-vertical-families"
  | "v3-synthetic-9a-duplicate-only-insufficient"
  | "v3-synthetic-9b-duplicate-plus-second-identity"
  | "v3-synthetic-10-missing-vertical-evidence"
  | "v3-synthetic-11-grazing-admission";

export type SyntheticFixtureManifest = Readonly<{
  id: SyntheticFixtureId;
  version: "calibrated-camera/v3-synthetic/v1";
  description: string;
  groundTruth: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    forward: Readonly<{ x: number; y: number; z: number }>;
    rollDeg: number;
    tiltDeg: number;
    intrinsics: Readonly<{ width: number; height: number; fx: number; fy: number; cx: number; cy: number; verticalFovDeg: number }>;
  }>;
  floorDimensions: Readonly<{ widthMeters: number; depthMeters: number }>;
  evidence: Readonly<{
    floor: "exact" | "perturbed";
    floorOrigin: "truth_camera" | "second_camera";
    floorPixelPerturbationsPx: readonly SyntheticVec2[] | null;
    verticals: "exact" | "perturbed" | "bimodal" | "duplicate" | "missing";
    physicalVerticalIds: readonly string[];
  }>;
  expectedV2: string;
  /** Research-only metadata; it neither selects nor invokes a future solver. */
  expectedFutureV3: "solve" | "no_op" | "insufficient_vertical_evidence" | "policy_undecided";
  gates: Readonly<{
    harnessAcceptance: boolean;
    futureCandidateAcceptance: boolean;
    futureApplyResearch: boolean;
  }>;
}>;

export type SyntheticVerticalEvidenceRecord = Readonly<{
  projected: ProjectedVerticalSegment;
  observation: VerticalEvidenceObservation;
}>;

export type SyntheticCameraFixture = Readonly<{
  manifest: SyntheticFixtureManifest;
  fingerprint: string;
  intrinsics: SyntheticIntrinsics;
  truthCamera: SyntheticCamera;
  floorDimensions: Readonly<{ widthMeters: number; depthMeters: number }>;
  exactFloorPixels: readonly SyntheticVec2[];
  floorEvidencePixels: readonly SyntheticVec2[];
  verticalEvidence: readonly SyntheticVerticalEvidenceRecord[];
  admission?: Readonly<{
    acceptedWall: Readonly<{ derivationOk: true; runtimeUsable: true }>;
    refusedWall: Readonly<{ derivationOk: false; runtimeUsable: false }>;
  }>;
}>;

const VERSION = "calibrated-camera/v3-synthetic/v1" as const;
const DIMENSIONS = { widthMeters: 4, depthMeters: 4 } as const;
const INTRINSICS = buildSyntheticIntrinsicsFromFov({ width: 1280, height: 800 }, 55);

const BASE_VERTICALS: readonly SyntheticVerticalSegment[] = [
  { id: "back-left", physicalVerticalId: "back_left", wallKind: "wall_back", lowerWorld: { x: -1.6, y: 0, z: -1.8 }, heightMeters: 2 },
  { id: "back-right", physicalVerticalId: "back_right", wallKind: "wall_back", lowerWorld: { x: 1.6, y: 0, z: -1.8 }, heightMeters: 2 },
  { id: "front-left", physicalVerticalId: "front_left", wallKind: "wall_left", lowerWorld: { x: -1.7, y: 0, z: 1.45 }, heightMeters: 2 },
  { id: "front-right", physicalVerticalId: "front_right", wallKind: "wall_right", lowerWorld: { x: 1.7, y: 0, z: 1.45 }, heightMeters: 2 },
];

function canonicalize(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(10) : String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${key}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function makeVerticalEvidenceRecord(
  fixtureId: SyntheticFixtureId,
  camera: SyntheticCamera,
  vertical: ProjectedVerticalSegment,
  physicalVerticalId = vertical.physicalVerticalId,
  wallKind = vertical.wallKind
): SyntheticVerticalEvidenceRecord {
  const endpoints = {
    lower: intrinsicPixelsToSourceNormalized(vertical.lowerPixel, camera.intrinsics),
    upper: intrinsicPixelsToSourceNormalized(vertical.upperPixel, camera.intrinsics),
  };
  const suggestionSourceId = buildVerticalEvidenceSuggestionId({
    imageBasisId: `${fixtureId}:basis`,
    imageBasisFingerprint: `${fixtureId}:fingerprint`,
    wallKind,
    wallPolygonKey: `${fixtureId}:${wallKind}`,
    physicalVerticalId,
    sourceNormalizedEndpoints: endpoints,
  });
  return {
    projected: {
      ...vertical,
      physicalVerticalId,
      wallKind,
      lowerSourceNormalized: endpoints.lower,
      upperSourceNormalized: endpoints.upper,
    },
    observation: {
      observationId: buildVerticalEvidenceObservationId(suggestionSourceId),
      evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION,
      imageBasisId: `${fixtureId}:basis`,
      imageBasisFingerprint: `${fixtureId}:fingerprint`,
      intrinsicWidth: camera.intrinsics.width,
      intrinsicHeight: camera.intrinsics.height,
      sourceNormalizedEndpoints: endpoints,
      physicalVerticalId,
      suggestionSourceId,
      wallKind,
      wallPolygonKey: `${fixtureId}:${wallKind}`,
      suggestionGeneratorVersion: VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION,
      floorProvenance: { floorPolygonKey: `${fixtureId}:floor`, worldWidth: DIMENSIONS.widthMeters, worldDepth: DIMENSIONS.depthMeters },
      frozenWorldAnchor: { x: vertical.lowerWorld.x, y: 0, z: vertical.lowerWorld.z },
      frozenAnchorDerivationId: `${VERSION}:${fixtureId}:anchor`,
      operatorDecision: "selected",
      decisionAtIso: "2026-07-20T00:00:00.000Z",
      historicalContext: { nonBinding: true, cameraVersion: null, cameraAppliedAtIso: null, frameWidth: null, frameHeight: null },
      supersession: null,
    },
  };
}

function manifest(
  id: SyntheticFixtureId,
  description: string,
  camera: SyntheticCamera,
  floor: "exact" | "perturbed",
  floorOrigin: SyntheticFixtureManifest["evidence"]["floorOrigin"],
  floorPixelPerturbationsPx: readonly SyntheticVec2[] | null,
  verticals: SyntheticFixtureManifest["evidence"]["verticals"],
  physicalVerticalIds: readonly string[],
  expectedV2: string,
  expectedFutureV3: SyntheticFixtureManifest["expectedFutureV3"],
  gates: SyntheticFixtureManifest["gates"]
): SyntheticFixtureManifest {
  return {
    id,
    version: VERSION,
    description,
    groundTruth: {
      position: camera.position,
      forward: camera.forwardWorld,
      rollDeg: camera.rollDeg,
      tiltDeg: camera.tiltDeg,
      intrinsics: camera.intrinsics,
    },
    floorDimensions: DIMENSIONS,
    evidence: { floor, floorOrigin, floorPixelPerturbationsPx, verticals, physicalVerticalIds },
    expectedV2,
    expectedFutureV3,
    gates,
  };
}

function fixture(input: Readonly<{
  id: SyntheticFixtureId;
  description: string;
  camera: SyntheticCamera;
  floorEvidenceCamera?: SyntheticCamera;
  floorPerturbations?: readonly Readonly<{ x: number; y: number }>[];
  verticals?: readonly SyntheticVerticalSegment[];
  verticalPerturbations?: Readonly<Record<string, Readonly<{ lower?: Readonly<{ x: number; y: number }>; upper?: Readonly<{ x: number; y: number }> }>>>;
  expectedV2: string;
  expectedFutureV3: SyntheticFixtureManifest["expectedFutureV3"];
  gates: SyntheticFixtureManifest["gates"];
  verticalEvidenceKind: SyntheticFixtureManifest["evidence"]["verticals"];
  admission?: SyntheticCameraFixture["admission"];
}>): SyntheticCameraFixture {
  const exactFloorPixels = projectSyntheticFloorRectangle(input.camera, DIMENSIONS);
  const floorEvidencePixels = (input.floorEvidenceCamera
    ? projectSyntheticFloorRectangle(input.floorEvidenceCamera, DIMENSIONS)
    : exactFloorPixels
  ).map((point, index) => applySyntheticPixelPerturbation(point, input.floorPerturbations?.[index] ?? { x: 0, y: 0 }));
  const verticalEvidence = (input.verticals ?? BASE_VERTICALS).map((segment) => {
    const projected = projectSyntheticVerticalSegment(input.camera, segment);
    const perturbation = input.verticalPerturbations?.[segment.id];
    const adjusted = perturbation
      ? {
          ...projected,
          lowerPixel: applySyntheticPixelPerturbation(projected.lowerPixel, perturbation.lower ?? { x: 0, y: 0 }),
          upperPixel: applySyntheticPixelPerturbation(projected.upperPixel, perturbation.upper ?? { x: 0, y: 0 }),
        }
      : projected;
    return makeVerticalEvidenceRecord(input.id, input.camera, adjusted);
  });
  const m = manifest(
    input.id,
    input.description,
    input.camera,
    input.floorEvidenceCamera || input.floorPerturbations ? "perturbed" : "exact",
    input.floorEvidenceCamera ? "second_camera" : "truth_camera",
    input.floorPerturbations ? input.floorPerturbations.map((vector) => ({ ...vector })) : null,
    input.verticalEvidenceKind,
    verticalEvidence.map((entry) => entry.observation.physicalVerticalId),
    input.expectedV2,
    input.expectedFutureV3,
    input.gates
  );
  return {
    manifest: m,
    fingerprint: canonicalize({ manifest: m, floorEvidencePixels, verticalEvidence: verticalEvidence.map((entry) => entry.observation) }),
    intrinsics: input.camera.intrinsics,
    truthCamera: input.camera,
    floorDimensions: DIMENSIONS,
    exactFloorPixels,
    floorEvidencePixels,
    verticalEvidence,
    ...(input.admission ? { admission: input.admission } : {}),
  };
}

function camera(position: { x: number; y: number; z: number }, lookAt: { x: number; y: number; z: number }, rollDeg = 0): SyntheticCamera {
  return createSyntheticCamera({ intrinsics: INTRINSICS, position, lookAt, rollDeg });
}

export function buildSyntheticCameraFixtures(): readonly SyntheticCameraFixture[] {
  const centered = camera({ x: 0, y: 1.8, z: 5.5 }, { x: 0, y: 0, z: 0 });
  const offAxis = camera({ x: 1.35, y: 1.65, z: 5.2 }, { x: -0.3, y: 0, z: -0.2 });
  return [
    fixture({
      id: "v3-synthetic-1-centered-zero-roll", description: "Centered zero-roll exact Manhattan room control.", camera: centered,
      expectedV2: "near-ground-truth pose and numerical-precision Floor reprojection", expectedFutureV3: "no_op",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "exact",
    }),
    fixture({
      id: "v3-synthetic-2-off-axis-zero-roll", description: "Strongly off-axis and laterally displaced exact room.", camera: offAxis,
      expectedV2: "near-ground-truth pose despite asymmetry; no vertical-coherence defect", expectedFutureV3: "no_op",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "exact",
    }),
    fixture({
      id: "v3-synthetic-3-positive-roll", description: "Exact Floor with genuine clockwise y-down image roll.", camera: camera({ x: 0.35, y: 1.8, z: 5.5 }, { x: 0, y: 0, z: 0 }, 7),
      expectedV2: "preserves intentional positive roll and coherent verticals", expectedFutureV3: "no_op",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "exact",
    }),
    fixture({
      id: "v3-synthetic-4-negative-roll", description: "Exact Floor with genuine counter-clockwise y-down image roll.", camera: camera({ x: -0.35, y: 1.8, z: 5.5 }, { x: 0, y: 0, z: 0 }, -7),
      expectedV2: "preserves intentional negative roll and coherent verticals", expectedFutureV3: "no_op",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "exact",
    }),
    fixture({
      id: "v3-synthetic-5-perturbed-floor-clean-verticals",
      description: "Abstract incompatible camera-evidence fixture: second-camera Floor evidence with clean truth verticals.",
      camera: offAxis,
      floorEvidenceCamera: camera({ x: 1.72, y: 1.8, z: 5.45 }, { x: -0.3, y: 0, z: -0.2 }, 4.5),
      expectedV2: "fits second-camera Floor evidence at numerical precision while recovered world-up disagrees with clean truth verticals",
      expectedFutureV3: "solve",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "exact",
    }),
    fixture({
      id: "v3-synthetic-5b-single-camera-floor-corner-perturbation",
      description: "Single-camera direct Floor-corner perturbation characterization with clean truth verticals; models annotation or semantic corner error.",
      camera: offAxis,
      // Fixed source-pixel deltas, ordered near-left, near-right, far-right, far-left.
      // They are a small clockwise rotational perturbation around the principal point,
      // applied after projection; no second camera supplies this Floor evidence.
      floorPerturbations: [
        { x: -1.951680549, y: -10.5419781795 },
        { x: -4.9944424914, y: 9.6667570181 },
        { x: 0.7550897425, y: 7.9683990747 },
        { x: 1.5981790623, y: -2.740700165 },
      ],
      expectedV2: "fits direct perturbed Floor corners at numerical precision while clean truth verticals expose nonzero gravity disagreement",
      expectedFutureV3: "solve",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "exact",
    }),
    fixture({
      id: "v3-synthetic-6-exact-floor-perturbed-verticals", description: "Exact Floor with deterministic noise in selected vertical observations.", camera: offAxis,
      verticalPerturbations: {
        "back-left": { upper: { x: 18, y: 0 } },
        "front-right": { upper: { x: -14, y: 4 } },
      },
      expectedV2: "Floor-only pose is unchanged; diagnostics isolate vertical noise", expectedFutureV3: "policy_undecided",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "perturbed",
    }),
    fixture({
      id: "v3-synthetic-7-bimodal-vertical-families", description: "Exact Floor with deterministic incompatible vertical family.", camera: offAxis,
      verticalPerturbations: {
        "back-left": { upper: { x: 30, y: 0 } },
        "front-left": { upper: { x: 30, y: 0 } },
      },
      expectedV2: "Floor-only pose remains accurate while vertical residuals form incompatible families", expectedFutureV3: "policy_undecided",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "bimodal",
    }),
    fixture({
      id: "v3-synthetic-9a-duplicate-only-insufficient", description: "Duplicate-only topology: separate records of one shared physical vertical.", camera: centered,
      verticals: [BASE_VERTICALS[0], { ...BASE_VERTICALS[0], id: "back-left-duplicate", wallKind: "wall_left" }],
      expectedV2: "pose is independent of duplicate vertical records; topology contains one physical identity", expectedFutureV3: "insufficient_vertical_evidence",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "duplicate",
    }),
    fixture({
      id: "v3-synthetic-9b-duplicate-plus-second-identity", description: "Duplicate shared-corner records plus a second physical vertical identity.", camera: centered,
      verticals: [BASE_VERTICALS[0], { ...BASE_VERTICALS[0], id: "back-left-duplicate", wallKind: "wall_left" }, BASE_VERTICALS[1]],
      expectedV2: "pose is independent of duplicate vertical records; deterministic topology reaches two physical identities", expectedFutureV3: "policy_undecided",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "duplicate",
    }),
    fixture({
      id: "v3-synthetic-10-missing-vertical-evidence", description: "Valid exact Floor with zero selected structural verticals.", camera: centered, verticals: [],
      expectedV2: "v2 solves normally with no vertical authority", expectedFutureV3: "insufficient_vertical_evidence",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: true, futureApplyResearch: false }, verticalEvidenceKind: "missing",
    }),
    fixture({
      id: "v3-synthetic-11-grazing-admission", description: "Runtime-usable wall admission contrasted with a refused near-grazing wall.", camera: centered,
      verticals: [BASE_VERTICALS[0]],
      expectedV2: "no solver behavior; usable source creates a suggestion and refused source creates none", expectedFutureV3: "no_op",
      gates: { harnessAcceptance: true, futureCandidateAcceptance: false, futureApplyResearch: false }, verticalEvidenceKind: "exact",
      admission: { acceptedWall: { derivationOk: true, runtimeUsable: true }, refusedWall: { derivationOk: false, runtimeUsable: false } },
    }),
  ];
}

export function syntheticFixtureById(id: SyntheticFixtureId): SyntheticCameraFixture {
  const result = buildSyntheticCameraFixtures().find((candidate) => candidate.manifest.id === id);
  if (!result) throw new Error(`Unknown synthetic fixture: ${id}`);
  return result;
}
