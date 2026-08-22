import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import roomAValue from "./fixtures/p2-s1-empty-physical-boundary/room-a.json";
import roomCValue from "./fixtures/p2-s1-empty-physical-boundary/room-c.json";
import roomEValue from "./fixtures/p2-s1-empty-physical-boundary/room-e.json";
import {
  BACK_WALL_SEAM_PROPOSAL_FAMILY,
  BACK_WALL_SEAM_PROPOSAL_VERSION,
  P2_S1B_FROZEN_PARAMETERS,
  type BackWallSeamProposal,
  type ColumnTransitionResponse,
  type LinkedTransitionRun,
  classifyBackWallSeamProposals,
  evaluateBackWallSeamCandidates,
  linkColumnTransitionResponses,
  readCertifiedEmptyBackWallSeamCandidates,
  splitLinkedTransitionRunsAtLocalHeadingTransitions,
} from "./empty-back-wall-seam-candidate";
import {
  EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";

const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(os.homedir(), "Documents", "Vibode", "AFC", "vibode-afc-r3c-fixed-inputs");

function parsed(value: unknown): EmptyPhysicalBoundaryFixture {
  const result = parseEmptyPhysicalBoundaryFixture(value);
  if (!result.ok) throw new Error(result.reason);
  return result.fixture;
}

async function loadCertifiedEmpty(
  fixture: EmptyPhysicalBoundaryFixture
): Promise<Uint8Array> {
  const root = await resolveAfcUi2aFixedInputsRoot(FIXED_INPUTS_ROOT);
  assert.equal(root.ok, true, root.ok ? undefined : root.code);
  const manifest = JSON.parse(await readFile(
    path.join(root.root, fixture.roomId, fixture.emptyImage.manifestFileName),
    "utf8"
  )) as { emptyRoomAssist: { filePath: string } };
  return readFile(path.join(root.root, fixture.roomId, path.basename(manifest.emptyRoomAssist.filePath)));
}

function response(x: number, y: number, score = 40): ColumnTransitionResponse {
  return Object.freeze({ x, y, lumaDrop: score * 0.6, rgbDistance: score, score });
}

function syntheticRun(
  points: readonly Readonly<{ x: number; y: number }>[]
): LinkedTransitionRun {
  return Object.freeze({
    points: Object.freeze(points.map(point => response(point.x, point.y))),
  });
}

function linePoints(
  xStart: number,
  xEnd: number,
  yAtStart: number,
  angleDeg: number
): readonly Readonly<{ x: number; y: number }>[] {
  const slope = Math.tan(angleDeg * Math.PI / 180);
  return Object.freeze(Array.from({ length: xEnd - xStart + 1 }, (_, index) => Object.freeze({
    x: xStart + index,
    y: Math.round(yAtStart + slope * index),
  })));
}

function syntheticProposal(input: Readonly<{
  id: string;
  pointsPx: readonly Readonly<{ x: number; y: number }>[];
  dimensions?: Readonly<{ width: number; height: number }>;
  score?: number;
  lumaDrop?: number;
  rgbDistance?: number;
  status?: BackWallSeamProposal["status"];
  rejectionReasons?: BackWallSeamProposal["rejectionReasons"];
  roomId?: string;
}>): BackWallSeamProposal {
  const dimensions = input.dimensions ?? { width: 100, height: 100 };
  const first = input.pointsPx[0];
  const last = input.pointsPx.at(-1) ?? first;
  let length = 0;
  for (let index = 1; index < input.pointsPx.length; index += 1) {
    length += Math.hypot(
      input.pointsPx[index].x - input.pointsPx[index - 1].x,
      input.pointsPx[index].y - input.pointsPx[index - 1].y
    );
  }
  const xSpanPx = last.x - first.x;
  return Object.freeze({
    id: input.id,
    roomId: input.roomId ?? "room-synthetic",
    emptyImageSha256: "a".repeat(64),
    coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
    proposalFamily: BACK_WALL_SEAM_PROPOSAL_FAMILY,
    proposalVersion: BACK_WALL_SEAM_PROPOSAL_VERSION,
    status: input.status ?? "proposed",
    rejectionReasons: input.rejectionReasons ?? Object.freeze([]),
    pointsSourceNormalized: Object.freeze(input.pointsPx.map(point => Object.freeze({
      x: point.x / dimensions.width,
      y: point.y / dimensions.height,
    }))),
    sourcePixelLength: length,
    imageSpaceAngleDeg: Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI,
    evidence: Object.freeze({
      supportColumnCount: Math.max(2, Math.round(xSpanPx) + 1),
      xSpanPx,
      supportColumnFraction: 1,
      meanLumaDrop: input.lumaDrop ?? 24,
      minimumLumaDrop: input.lumaDrop ?? 24,
      meanRgbDistance: input.rgbDistance ?? 36,
      minimumRgbDistance: input.rgbDistance ?? 36,
      meanTransitionScore: input.score ?? 40,
    }),
  });
}

function syntheticFixture(input: Readonly<{
  roomId?: string;
  rear: readonly (readonly Readonly<{ x: number; y: number }>[])[];
  side?: readonly Readonly<{ x: number; y: number }>[];
}>): EmptyPhysicalBoundaryFixture {
  const annotation = (
    points: readonly Readonly<{ x: number; y: number }>[],
    id: string,
    interpretation: "rear_floor_wall_seam" | "side_wall_floor_seam"
  ) => ({
    id,
    pointsSourceNormalized: points.map(point => ({ x: point.x / 100, y: point.y / 100 })),
    interpretation,
    evidenceKind: "direct_visible" as const,
    boundaryState: "physical_wall" as const,
    collisionEligible: true,
    startEndpoint: { status: "visible" as const, frameContact: "no_frame_contact" as const },
    endEndpoint: { status: "visible" as const, frameContact: "no_frame_contact" as const },
    notes: "synthetic scorer oracle",
  });
  return {
    version: "p2-s1-empty-physical-boundary/v1",
    roomId: input.roomId ?? "room-synthetic",
    coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
    emptyImage: {
      sha256: "a".repeat(64),
      dimensions: { width: 100, height: 100 },
      generatorId: "synthetic",
      generatedFromOriginalSha256: "b".repeat(64),
      manifestFileName: "afc-r3c-room-synthetic.image-manifest.v1.json",
    },
    evaluationCorridorSourcePx: 6,
    annotations: [
      ...input.rear.map((points, index) => annotation(points, `rear-${index}`, "rear_floor_wall_seam")),
      ...(input.side ? [annotation(input.side, "side-0", "side_wall_floor_seam")] : []),
    ],
  };
}

const BASE_SCORER_FIXTURE = syntheticFixture({
  rear: [[{ x: 20, y: 50 }, { x: 80, y: 50 }]],
  side: [{ x: 20, y: 50 }, { x: 20, y: 90 }],
});

function acceptedSynthetic(
  id: string,
  pointsPx: readonly Readonly<{ x: number; y: number }>[],
  roomId = "room-synthetic"
): BackWallSeamProposal {
  return syntheticProposal({ id, pointsPx, status: "accepted_research", roomId });
}

test("P2-S1B contract binds exact certified EMPTY SHA, dimensions, and non-semantic identity", async () => {
  const fixture = parsed(roomAValue);
  const imageBytes = await loadCertifiedEmpty(fixture);
  const result = await readCertifiedEmptyBackWallSeamCandidates(imageBytes, fixture);
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  if (!result.ok) return;
  assert.equal(createHash("sha256").update(imageBytes).digest("hex"), fixture.emptyImage.sha256);
  assert.deepEqual(result.observedIdentity, {
    sha256: "d5f9b40ffbe2789d4756d72162b1d4a38d505da67b36e5deb9b2a9e0ec5bb686",
    dimensions: { width: 1264, height: 848 },
  });
  for (const proposal of result.proposals) {
    assert.equal(proposal.roomId, fixture.roomId);
    assert.equal(proposal.emptyImageSha256, fixture.emptyImage.sha256);
    assert.equal(proposal.coordinateSpace, "empty-source-normalized/v1");
    assert.equal(proposal.proposalFamily, "local-wall-floor-transition-scan");
    assert.equal(proposal.proposalVersion, "p2-s1b/v1");
    assert.ok(proposal.pointsSourceNormalized.every(point =>
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
    ));
    assert.equal("boundaryState" in proposal, false);
    assert.equal("collisionEligible" in proposal, false);
  }
});

test("P2-S1B refuses stale EMPTY bytes and dimensions through P2-S1A identity authority", async () => {
  const fixture = parsed(roomAValue);
  const imageBytes = await loadCertifiedEmpty(fixture);
  const stale = Uint8Array.from(imageBytes);
  stale[stale.length - 1] ^= 1;
  const staleResult = await readCertifiedEmptyBackWallSeamCandidates(stale, fixture);
  assert.deepEqual(staleResult, { ok: false, reason: "fixture_identity_mismatch" });

  const wrongDimensions = {
    ...fixture,
    emptyImage: {
      ...fixture.emptyImage,
      dimensions: { width: fixture.emptyImage.dimensions.width + 1, height: fixture.emptyImage.dimensions.height },
    },
  };
  const dimensionsResult = await readCertifiedEmptyBackWallSeamCandidates(imageBytes, wrongDimensions);
  assert.deepEqual(dimensionsResult, { ok: false, reason: "fixture_identity_mismatch" });
});

test("P2-S1B automatic module has no semantic promotion or live importer", async () => {
  const researchDirectory = path.dirname(new URL(import.meta.url).pathname);
  const modulePath = path.join(researchDirectory, "empty-back-wall-seam-candidate.ts");
  const moduleSource = await readFile(modulePath, "utf8");
  assert.equal(moduleSource.includes("boundaryState:"), false);
  assert.equal(moduleSource.includes("collisionEligible:"), false);
  assert.equal(moduleSource.includes("createPhysicalRoomEnvelope"), false);

  const appRoot = path.resolve(researchDirectory, "../../..");
  const importers: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && entryPath !== modulePath && entryPath !== new URL(import.meta.url).pathname) {
        const source = await readFile(entryPath, "utf8");
        if (/from\s+["']\.\/empty-back-wall-seam-candidate["']/.test(source)) {
          importers.push(entryPath);
        }
      }
    }
  }
  await visit(appRoot);
  assert.deepEqual(
    importers.map(importer => path.relative(researchDirectory, importer)),
    [
      "visible-floor-wall-seam-fragment.test.ts",
      "visible-floor-wall-seam-fragment.ts",
    ]
  );
});

test("P2-S1B linking joins only locally coherent supported columns", () => {
  const responses: (ColumnTransitionResponse | null)[] = [
    response(0, 20), response(1, 21), null, response(3, 22), response(4, 22),
  ];
  const runs = linkColumnTransitionResponses(responses, 2, 1);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].points.map(point => point.x), [0, 1, 3, 4]);
});

test("P2-S1B linking splits excessive y jumps and unsupported gaps", () => {
  const jump = linkColumnTransitionResponses([
    response(0, 20), response(1, 21), response(2, 25), response(3, 25),
  ], 2, 1);
  assert.deepEqual(jump.map(run => run.points.map(point => point.x)), [[0, 1], [2, 3]]);

  const gap = linkColumnTransitionResponses([
    response(0, 20), response(1, 20), null, null, response(4, 20), response(5, 20),
  ], 2, 1);
  assert.deepEqual(gap.map(run => run.points.map(point => point.x)), [[0, 1], [4, 5]]);
});

test("P2-S1B local heading leaves a pure rear-wall-family run intact", () => {
  const run = syntheticRun(linePoints(10, 90, 50, 8));
  const result = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    [run],
    P2_S1B_FROZEN_PARAMETERS.localHeadingSupportPx,
    P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg
  );
  assert.equal(result.splits.length, 0);
  assert.equal(result.runs.length, 1);
  const classified = classifyBackWallSeamProposals([
    syntheticProposal({
      id: "pure-rear",
      pointsPx: result.runs[0].points,
      dimensions: { width: 120, height: 120 },
    }),
  ], { width: 120, height: 120 }, P2_S1B_FROZEN_PARAMETERS);
  assert.equal(classified[0].status, "accepted_research");
});

test("P2-S1B local heading cannot promote a pure side-wall-family run", () => {
  const run = syntheticRun(linePoints(10, 90, 70, -22));
  const result = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    [run],
    P2_S1B_FROZEN_PARAMETERS.localHeadingSupportPx,
    P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg
  );
  assert.equal(result.splits.length, 0);
  const classified = classifyBackWallSeamProposals([
    syntheticProposal({
      id: "pure-side",
      pointsPx: result.runs[0].points,
      dimensions: { width: 120, height: 120 },
    }),
  ], { width: 120, height: 120 }, P2_S1B_FROZEN_PARAMETERS);
  assert.equal(classified[0].status, "rejected");
  assert.ok(classified[0].rejectionReasons.includes("angle_outside_back_wall_family"));
});

test("P2-S1B local heading splits a continuous side-to-rear wrap before classification", () => {
  const side = linePoints(10, 50, 80, -22);
  const cornerY = side.at(-1)?.y ?? 0;
  const rear = linePoints(51, 130, cornerY + Math.round(Math.tan(8 * Math.PI / 180)), 8);
  const wrapped = syntheticRun([...side, ...rear]);
  const first = wrapped.points[0];
  const last = wrapped.points.at(-1) ?? first;
  const aggregateAngle = Math.atan2(last.y - first.y, last.x - first.x) * 180 / Math.PI;
  assert.ok(Math.abs(aggregateAngle) < P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg);

  const result = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    [wrapped],
    P2_S1B_FROZEN_PARAMETERS.localHeadingSupportPx,
    P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg
  );
  assert.equal(result.splits.length, 1);
  assert.equal(result.runs.length, 2);
  assert.ok(result.runs.every(fragment => fragment.points.length < wrapped.points.length));

  const classified = classifyBackWallSeamProposals(result.runs.map((fragment, index) =>
    syntheticProposal({
      id: `wrapped-${index}`,
      pointsPx: fragment.points,
      dimensions: { width: 150, height: 120 },
    })
  ), { width: 150, height: 120 }, P2_S1B_FROZEN_PARAMETERS);
  const sideFragment = classified[0];
  assert.equal(sideFragment.status, "rejected");
  assert.ok(sideFragment.rejectionReasons.includes("angle_outside_back_wall_family"));
  assert.equal(classified[1].status, "accepted_research");
  assert.equal(classified.some(fragment =>
    fragment.status === "accepted_research" &&
    fragment.pointsSourceNormalized[0].x <= side[0].x / 150 &&
    (fragment.pointsSourceNormalized.at(-1)?.x ?? 0) >= rear.at(-1)!.x / 150
  ), false);
});

test("P2-S1B local heading preserves gentle rear-wall curvature and quantization noise", () => {
  const points = Array.from({ length: 91 }, (_, index) => ({
    x: 10 + index,
    y: Math.round(50 + 0.1 * index + 0.45 * Math.sin(index * 0.3)),
  }));
  const result = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    [syntheticRun(points)],
    P2_S1B_FROZEN_PARAMETERS.localHeadingSupportPx,
    P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg
  );
  assert.equal(result.splits.length, 0);
  assert.equal(result.runs.length, 1);
});

test("P2-S1B local heading ignores a short noisy excursion in a rear-wall run", () => {
  const points = linePoints(10, 100, 50, 8).map(point => ({ ...point }));
  points[44].y += 2;
  points[45].y += 1;
  const shorterSupport = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    [syntheticRun(points)],
    P2_S1B_FROZEN_PARAMETERS.localHeadingSupportPx - 1,
    P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg
  );
  assert.ok(shorterSupport.splits.length > 0);
  const result = splitLinkedTransitionRunsAtLocalHeadingTransitions(
    [syntheticRun(points)],
    P2_S1B_FROZEN_PARAMETERS.localHeadingSupportPx,
    P2_S1B_FROZEN_PARAMETERS.maximumAbsAngleDeg
  );
  assert.equal(result.splits.length, 0);
  assert.equal(result.runs.length, 1);
});

test("P2-S1B ambiguity omits competing persistent parallel responses deterministically", () => {
  const dimensions = { width: 100, height: 100 };
  const competing = [
    syntheticProposal({ id: "upper", pointsPx: [{ x: 10, y: 50 }, { x: 80, y: 50 }], score: 40 }),
    syntheticProposal({ id: "lower", pointsPx: [{ x: 10, y: 65 }, { x: 80, y: 65 }], score: 38 }),
  ];
  const first = classifyBackWallSeamProposals(competing, dimensions, P2_S1B_FROZEN_PARAMETERS);
  const second = classifyBackWallSeamProposals(competing, dimensions, P2_S1B_FROZEN_PARAMETERS);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(item => item.status), ["rejected", "rejected"]);
  assert.ok(first.every(item => item.rejectionReasons.includes("ambiguous_competing_parallel_response")));
});

test("P2-S1B ambiguity permits only an explicit appearance-dominant response", () => {
  const classified = classifyBackWallSeamProposals([
    syntheticProposal({ id: "dominant", pointsPx: [{ x: 10, y: 50 }, { x: 80, y: 50 }], score: 60 }),
    syntheticProposal({ id: "weaker", pointsPx: [{ x: 10, y: 65 }, { x: 80, y: 65 }], score: 40 }),
  ], { width: 100, height: 100 }, P2_S1B_FROZEN_PARAMETERS);
  assert.equal(classified[0].status, "accepted_research");
  assert.equal(classified[1].status, "rejected");
  assert.ok(classified[1].rejectionReasons.includes("dominated_by_competing_parallel_response"));
});

test("P2-S1B finite-polyline scorer handles full, partial, endpoint-near, and soft-miss cases", () => {
  const full = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("full", [{ x: 20, y: 50 }, { x: 80, y: 50 }])],
    BASE_SCORER_FIXTURE
  );
  assert.equal(full.hardFail, false);
  assert.equal(full.offOracleFraction, 0);
  assert.equal(full.oracleCoverageFraction, 1);
  assert.equal(full.acceptedSupportedLengthFraction, 1);

  const partial = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("partial", [{ x: 20, y: 50 }, { x: 50, y: 50 }])],
    BASE_SCORER_FIXTURE
  );
  assert.equal(partial.hardFail, false);
  assert.ok(partial.oracleCoverageFraction > 0.4 && partial.oracleCoverageFraction < 0.7);

  const endpointNear = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("endpoint-near", [{ x: 78, y: 50 }, { x: 85, y: 50 }])],
    BASE_SCORER_FIXTURE
  );
  assert.equal(endpointNear.hardFail, false);
  assert.equal(endpointNear.acceptedSupportedLengthFraction, 1);

  const miss = evaluateBackWallSeamCandidates([], BASE_SCORER_FIXTURE);
  assert.equal(miss.hardFail, false);
  assert.equal(miss.oracleCoverageFraction, 0);
  assert.equal(miss.acceptedResearchCount, 0);
});

test("P2-S1B scorer hard-fails off-corridor, finite-line continuation, and side-wall confusion", () => {
  const offCorridor = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("off", [{ x: 20, y: 60 }, { x: 80, y: 60 }])],
    BASE_SCORER_FIXTURE
  );
  assert.equal(offCorridor.hardFail, true);
  assert.ok(offCorridor.offOracleFraction > 0);

  const infiniteOnly = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("infinite", [{ x: 85, y: 50 }, { x: 95, y: 50 }])],
    BASE_SCORER_FIXTURE
  );
  assert.equal(infiniteOnly.hardFail, true);
  assert.ok(infiniteOnly.maxCandidateToOracleDistance && infiniteOnly.maxCandidateToOracleDistance >= 15);

  const sideWall = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("side", [{ x: 20, y: 50 }, { x: 20, y: 90 }])],
    BASE_SCORER_FIXTURE
  );
  assert.equal(sideWall.hardFail, true);
});

test("P2-S1B scorer rejects a collinear Room C-style bridge through a finite GT gap", () => {
  const fixture = syntheticFixture({
    roomId: "room-c",
    rear: [
      [{ x: 10, y: 50 }, { x: 40, y: 50 }],
      [{ x: 60, y: 50 }, { x: 90, y: 50 }],
    ],
  });
  const bridge = evaluateBackWallSeamCandidates(
    [acceptedSynthetic("bridge", [{ x: 10, y: 50 }, { x: 90, y: 50 }], "room-c")],
    fixture
  );
  assert.equal(bridge.illegalBridge, true);
  assert.equal(bridge.hardFail, true);
  assert.ok(bridge.offOracleFraction > 0);
});

async function benchmarkRoom(value: unknown) {
  const fixture = parsed(value);
  const imageBytes = await loadCertifiedEmpty(fixture);
  const read = await readCertifiedEmptyBackWallSeamCandidates(imageBytes, fixture, P2_S1B_FROZEN_PARAMETERS);
  assert.equal(read.ok, true, read.ok ? undefined : read.reason);
  return {
    fixture,
    read,
    evaluation: evaluateBackWallSeamCandidates(read.proposals, fixture),
  };
}

function proposalDiagnostic(
  proposal: BackWallSeamProposal,
  fixture: EmptyPhysicalBoundaryFixture
) {
  const { width, height } = fixture.emptyImage.dimensions;
  const first = proposal.pointsSourceNormalized[0];
  const last = proposal.pointsSourceNormalized.at(-1) ?? first;
  return {
    id: proposal.id,
    startSourcePx: { x: first.x * width, y: first.y * height },
    endSourcePx: { x: last.x * width, y: last.y * height },
    length: proposal.sourcePixelLength,
    globalAngleDeg: proposal.imageSpaceAngleDeg,
    status: proposal.status,
    rejectionReasons: proposal.rejectionReasons,
  };
}

test("P2-S1B Room A development freezes conservative detector hypotheses", async () => {
  const benchmark = await benchmarkRoom(roomAValue);
  console.log("P2-S1B ROOM A", JSON.stringify({
    localHeadingSupportPx: benchmark.read.ok ? benchmark.read.parameters.localHeadingSupportPx : null,
    splitCount: benchmark.read.ok ? benchmark.read.localHeadingSplits.length : null,
    accepted: benchmark.read.ok
      ? benchmark.read.accepted.map(proposal => proposalDiagnostic(proposal, benchmark.fixture))
      : [],
    evaluation: benchmark.evaluation,
  }));
  assert.equal(benchmark.evaluation.hardFail, false);
});

test("P2-S1B Room E validation uses the Room A-frozen parameters unchanged", async () => {
  const benchmark = await benchmarkRoom(roomEValue);
  assert.deepEqual(benchmark.read.parameters, P2_S1B_FROZEN_PARAMETERS);
  console.log("P2-S1B ROOM E SPLITS", JSON.stringify(benchmark.read.localHeadingSplits));
  console.log("P2-S1B ROOM E FRAGMENTS", JSON.stringify(benchmark.read.proposals
    .filter(proposal => {
      const points = proposal.pointsSourceNormalized;
      const startX = points[0].x * benchmark.fixture.emptyImage.dimensions.width;
      const endX = (points.at(-1)?.x ?? 0) * benchmark.fixture.emptyImage.dimensions.width;
      return startX <= 909 && endX >= 656;
    })
    .map(proposal => proposalDiagnostic(proposal, benchmark.fixture))));
  console.log("P2-S1B ROOM E ACCEPTED", JSON.stringify(
    benchmark.read.accepted.map(proposal => proposalDiagnostic(proposal, benchmark.fixture))
  ));
  console.log("P2-S1B ROOM E", JSON.stringify(benchmark.evaluation));
  assert.equal(benchmark.evaluation.hardFail, false);
});

test("P2-S1B Room C adversarial holdout does not tune or bridge the radiator gap", async () => {
  const benchmark = await benchmarkRoom(roomCValue);
  assert.deepEqual(benchmark.read.parameters, P2_S1B_FROZEN_PARAMETERS);
  console.log("P2-S1B ROOM C SPLITS", JSON.stringify(benchmark.read.localHeadingSplits));
  console.log("P2-S1B ROOM C ACCEPTED", JSON.stringify(
    benchmark.read.accepted.map(proposal => proposalDiagnostic(proposal, benchmark.fixture))
  ));
  console.log("P2-S1B ROOM C", JSON.stringify(benchmark.evaluation));
  assert.equal(benchmark.evaluation.illegalBridge, false);
  assert.equal(benchmark.evaluation.hardFail, false);
});
