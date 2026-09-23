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
  type BackWallSeamReadResult,
  type ColumnTransitionResponse,
  pointToFinitePolylinesDistance,
  readCertifiedEmptyBackWallSeamCandidates,
} from "./empty-back-wall-seam-candidate";
import {
  EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION,
  EMPTY_SOURCE_PIXEL_COORDINATE_SPACE,
  type ColumnTransitionCandidate,
  type EmptyMultiResponseColumnFieldReadResult,
  type MultiResponseColumn,
  clusterQualifyingColumnResponses,
  readCertifiedEmptyMultiResponseColumnField,
} from "./empty-multi-response-column-field";
import {
  type EmptyPhysicalBoundaryAnnotation,
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";

const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(os.homedir(), "Documents", "Vibode", "AFC", "vibode-afc-r3c-fixed-inputs");

type SuccessfulField = Extract<EmptyMultiResponseColumnFieldReadResult, { ok: true }>;
type SuccessfulBackWall = Extract<BackWallSeamReadResult, { ok: true }>;
type Benchmark = Readonly<{
  fixture: EmptyPhysicalBoundaryFixture;
  bytes: Uint8Array;
  field: SuccessfulField;
  certifiedBackWall: SuccessfulBackWall;
}>;
type PixelPolyline = readonly Readonly<{ x: number; y: number }>[];

function parsed(value: unknown): EmptyPhysicalBoundaryFixture {
  const result = parseEmptyPhysicalBoundaryFixture(value);
  if (!result.ok) throw new Error(result.reason);
  return result.fixture;
}

function identityOnly(fixture: EmptyPhysicalBoundaryFixture) {
  return Object.freeze({
    roomId: fixture.roomId,
    sha256: fixture.emptyImage.sha256,
    dimensions: Object.freeze({ ...fixture.emptyImage.dimensions }),
  });
}

async function loadCertifiedEmpty(
  fixture: EmptyPhysicalBoundaryFixture
): Promise<Uint8Array> {
  const root = await resolveAfcUi2aFixedInputsRoot(FIXED_INPUTS_ROOT);
  if (!root.ok) assert.fail(root.code);
  const manifest = JSON.parse(await readFile(
    path.join(root.root, fixture.roomId, fixture.emptyImage.manifestFileName),
    "utf8"
  )) as { emptyRoomAssist: { filePath: string } };
  return readFile(path.join(
    root.root,
    fixture.roomId,
    path.basename(manifest.emptyRoomAssist.filePath)
  ));
}

async function benchmark(value: unknown): Promise<Benchmark> {
  const fixture = parsed(value);
  const bytes = await loadCertifiedEmpty(fixture);
  const field = await readCertifiedEmptyMultiResponseColumnField(
    bytes,
    identityOnly(fixture)
  );
  const certifiedBackWall = await readCertifiedEmptyBackWallSeamCandidates(
    bytes,
    fixture
  );
  if (!field.ok) assert.fail(field.reason);
  if (!certifiedBackWall.ok) assert.fail(certifiedBackWall.reason);
  return Object.freeze({ fixture, bytes, field, certifiedBackWall });
}

let corpusPromise: Promise<readonly Benchmark[]> | undefined;

function corpus(): Promise<readonly Benchmark[]> {
  corpusPromise ??= Promise.all([
    benchmark(roomAValue),
    benchmark(roomCValue),
    benchmark(roomEValue),
  ]);
  return corpusPromise;
}

function response(x: number, y: number, score: number): ColumnTransitionResponse {
  return Object.freeze({
    x,
    y,
    lumaDrop: score - 5,
    rgbDistance: 20,
    score,
  });
}

function pixelPolyline(
  annotation: EmptyPhysicalBoundaryAnnotation,
  fixture: EmptyPhysicalBoundaryFixture
): PixelPolyline {
  return annotation.pointsSourceNormalized.map(point => Object.freeze({
    x: point.x * fixture.emptyImage.dimensions.width,
    y: point.y * fixture.emptyImage.dimensions.height,
  }));
}

function trustedPolylines(
  fixture: EmptyPhysicalBoundaryFixture,
  annotationId?: string
): readonly PixelPolyline[] {
  return fixture.annotations
    .filter(annotation =>
      annotation.evidenceKind === "direct_visible" &&
      (!annotationId || annotation.id === annotationId)
    )
    .map(annotation => pixelPolyline(annotation, fixture));
}

function candidateDistance(
  candidate: Pick<ColumnTransitionCandidate, "x" | "y">,
  polylines: readonly PixelPolyline[]
): number {
  return pointToFinitePolylinesDistance(candidate, polylines);
}

function nearestCandidate(
  column: MultiResponseColumn,
  polylines: readonly PixelPolyline[]
): Readonly<{ candidate: ColumnTransitionCandidate; distance: number }> | null {
  const ranked = column.candidates
    .map(candidate => ({ candidate, distance: candidateDistance(candidate, polylines) }))
    .sort((left, right) =>
      left.distance - right.distance ||
      left.candidate.rankInColumn - right.candidate.rankInColumn
    );
  return ranked[0] ?? null;
}

function yOnPolylineAtX(polyline: PixelPolyline, x: number): number | null {
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    if (x < Math.min(start.x, end.x) || x > Math.max(start.x, end.x)) continue;
    if (start.x === end.x) return start.y;
    const t = (x - start.x) / (end.x - start.x);
    return start.y + t * (end.y - start.y);
  }
  return null;
}

function rankDistribution(
  columns: readonly MultiResponseColumn[],
  polylines: readonly PixelPolyline[],
  corridorPx: number
): Readonly<Record<string, number>> {
  const distribution: Record<string, number> = {};
  for (const column of columns) {
    const nearest = nearestCandidate(column, polylines);
    if (!nearest || nearest.distance > corridorPx) continue;
    const rank = String(nearest.candidate.rankInColumn);
    distribution[rank] = (distribution[rank] ?? 0) + 1;
  }
  return Object.freeze(distribution);
}

function fieldStatistics(room: Benchmark) {
  const responseColumns = room.field.columns.filter(column => column.certifiedWinner);
  const totalCandidates = responseColumns.reduce(
    (sum, column) => sum + column.candidates.length,
    0
  );
  return Object.freeze({
    roomId: room.fixture.roomId,
    responseColumns: responseColumns.length,
    totalCandidates,
    meanCandidatesPerResponseColumn:
      responseColumns.length === 0 ? 0 : totalCandidates / responseColumns.length,
    maxCandidatesInColumn: Math.max(
      0,
      ...responseColumns.map(column => column.candidates.length)
    ),
    winnerMismatchCount: room.field.winnerMismatchCount,
    oracleNearestRankDistribution: rankDistribution(
      responseColumns,
      trustedPolylines(room.fixture),
      room.fixture.evaluationCorridorSourcePx
    ),
  });
}

test("P2-S1D binds exact frozen EMPTY identities using identity-only input", async () => {
  for (const room of await corpus()) {
    assert.equal(
      createHash("sha256").update(room.bytes).digest("hex"),
      room.fixture.emptyImage.sha256
    );
    assert.deepEqual(room.field.dimensions, room.fixture.emptyImage.dimensions);
    assert.equal(room.field.emptyImageSha256, room.fixture.emptyImage.sha256);
    assert.equal(room.field.roomId, room.fixture.roomId);
    assert.equal(room.field.version, EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION);
    assert.equal(room.field.coordinateSpace, EMPTY_SOURCE_PIXEL_COORDINATE_SPACE);
    assert.deepEqual(
      Object.keys(identityOnly(room.fixture)).sort(),
      ["dimensions", "roomId", "sha256"]
    );
  }

  const [roomA] = await corpus();
  const stale = Uint8Array.from(roomA.bytes);
  stale[stale.length - 1] ^= 1;
  assert.deepEqual(
    await readCertifiedEmptyMultiResponseColumnField(
      stale,
      identityOnly(roomA.fixture)
    ),
    { ok: false, reason: "fixture_identity_mismatch" }
  );
  assert.deepEqual(
    await readCertifiedEmptyMultiResponseColumnField(roomA.bytes, {
      ...identityOnly(roomA.fixture),
      dimensions: {
        ...roomA.fixture.emptyImage.dimensions,
        width: roomA.fixture.emptyImage.dimensions.width + 1,
      },
    }),
    { ok: false, reason: "fixture_identity_mismatch" }
  );
});

test("P2-S1D preserves exactly one certified P2-S1B winner per response column", async () => {
  for (const room of await corpus()) {
    assert.equal(room.field.winnerMismatchCount, 0);
    let responseColumnCount = 0;
    let candidateCount = 0;
    for (const column of room.field.columns) {
      candidateCount += column.candidates.length;
      const marked = column.candidates.filter(candidate => candidate.equalsCertifiedWinner);
      if (!column.certifiedWinner) {
        assert.equal(marked.length, 0);
        assert.equal(column.candidates.length, 0);
        continue;
      }
      responseColumnCount += 1;
      assert.equal(marked.length, 1);
      assert.deepEqual(
        {
          x: marked[0].x,
          y: marked[0].y,
          lumaDrop: marked[0].lumaDrop,
          rgbDistance: marked[0].rgbDistance,
          score: marked[0].score,
        },
        column.certifiedWinner
      );
      assert.equal(marked[0].rankInColumn, 1);
      assert.deepEqual(
        {
          x: column.candidates[0].x,
          y: column.candidates[0].y,
          lumaDrop: column.candidates[0].lumaDrop,
          rgbDistance: column.candidates[0].rgbDistance,
          score: column.candidates[0].score,
        },
        column.certifiedWinner
      );
    }
    assert.ok(candidateCount > responseColumnCount);
  }
});

test("P2-S1D leaves certified P2-S1B A/C/E outcomes scientifically unchanged", async () => {
  const [roomA, roomC, roomE] = await corpus();
  assert.deepEqual(roomA.certifiedBackWall.accepted.map(item => item.id), []);
  assert.deepEqual(roomC.certifiedBackWall.accepted.map(item => item.id), []);
  assert.deepEqual(
    roomE.certifiedBackWall.accepted.map(item => item.id),
    ["p2-s1b/v1:room-e:0046"]
  );
  const acceptedE = roomE.certifiedBackWall.accepted[0];
  const first = acceptedE.pointsSourceNormalized[0];
  const last = acceptedE.pointsSourceNormalized.at(-1);
  assert.ok(last);
  assert.deepEqual(
    [first.x * 1264, first.y * 848, last.x * 1264, last.y * 848],
    [674, 562, 908.9999999999999, 600]
  );
});

test("P2-S1D adjacent-y clustering, rank, tie, and margin rules are deterministic", () => {
  const qualifying = [
    response(7, 467, 20),
    response(7, 468, 30),
    response(7, 469, 30),
    response(7, 482, 50),
    response(7, 483, 50),
    response(7, 510, 40),
  ];
  const candidates = clusterQualifyingColumnResponses(
    qualifying,
    qualifying[3]
  );
  assert.deepEqual(candidates.map(candidate => ({
    y: candidate.y,
    rank: candidate.rankInColumn,
    cluster: candidate.clusterIndexInColumn,
    range: [candidate.clusterYMin, candidate.clusterYMax],
    width: candidate.clusterWidthPx,
    winner: candidate.equalsCertifiedWinner,
    margin: candidate.scoreMarginToRank1,
  })), [
    { y: 482, rank: 1, cluster: 2, range: [482, 483], width: 2, winner: true, margin: 0 },
    { y: 510, rank: 2, cluster: 3, range: [510, 510], width: 1, winner: false, margin: 10 },
    { y: 468, rank: 3, cluster: 1, range: [467, 469], width: 3, winner: false, margin: 20 },
  ]);
  assert.deepEqual(
    clusterQualifyingColumnResponses([...qualifying].reverse(), qualifying[3]),
    candidates
  );
});

test("P2-S1D preserves the separate non-winner Room E 0020 true-contact cluster", async () => {
  const [, , roomE] = await corpus();
  const leftOracle = trustedPolylines(roomE.fixture, "left-wall-visible-baseboard");
  const expected = [
    { x: 484, winnerY: 615, retainedY: 641 },
    { x: 504, winnerY: 608, retainedY: 632 },
    { x: 523, winnerY: 602, retainedY: 625 },
  ];
  const table = expected.map(item => {
    const column = roomE.field.columns[item.x];
    const winner = column.candidates.find(candidate => candidate.equalsCertifiedWinner);
    const nearest = nearestCandidate(column, leftOracle);
    assert.ok(winner);
    assert.ok(nearest);
    assert.equal(winner.y, item.winnerY);
    assert.ok(candidateDistance(winner, leftOracle) > roomE.fixture.evaluationCorridorSourcePx);
    assert.equal(nearest.candidate.y, item.retainedY);
    assert.equal(nearest.candidate.rankInColumn, 2);
    assert.equal(nearest.candidate.equalsCertifiedWinner, false);
    assert.ok(nearest.distance <= roomE.fixture.evaluationCorridorSourcePx);
    assert.ok(nearest.candidate.clusterYMin > winner.clusterYMax + 1);
    return {
      x: item.x,
      winner: {
        y: winner.y,
        score: winner.score,
        oracleDistancePx: candidateDistance(winner, leftOracle),
      },
      retained: {
        y: nearest.candidate.y,
        score: nearest.candidate.score,
        rank: nearest.candidate.rankInColumn,
        scoreMarginToRank1: nearest.candidate.scoreMarginToRank1,
        oracleDistancePx: nearest.distance,
      },
    };
  });
  console.log("P2-S1D ROOM E 0020 COLUMNS", JSON.stringify(table));
});

test("P2-S1D Room E 0020 region preserves oracle-near ambiguity without selection", async () => {
  const [, , roomE] = await corpus();
  const leftOracle = trustedPolylines(roomE.fixture, "left-wall-visible-baseboard");
  const columns = roomE.field.columns.slice(484, 524);
  const corridor = roomE.fixture.evaluationCorridorSourcePx;
  const winnerSupported = columns.filter(column =>
    column.certifiedWinner &&
    candidateDistance(column.certifiedWinner, leftOracle) <= corridor
  ).length;
  const anySupported = columns.filter(column =>
    column.candidates.some(candidate => candidateDistance(candidate, leftOracle) <= corridor)
  ).length;
  const ranks = rankDistribution(columns, leftOracle, corridor);
  assert.equal(columns.length, 40);
  assert.equal(winnerSupported, 0);
  assert.equal(anySupported, 40);
  assert.deepEqual(ranks, { "2": 40 });
  assert.ok(columns.every(column => column.candidates.length > 1));
  console.log("P2-S1D ROOM E 0020 REGION", JSON.stringify({
    columns: columns.length,
    winnerSupported,
    anyRetainedCandidateSupported: anySupported,
    oracleNearestRankDistribution: ranks,
    meanClusterMultiplicity:
      columns.reduce((sum, column) => sum + column.candidates.length, 0) / columns.length,
  }));
});

test("P2-S1D characterizes Room A ROI, same-cluster, and lower-ranked rear cases", async () => {
  const [roomA] = await corpus();
  const leftOracle = trustedPolylines(roomA.fixture, "left-wall-visible-baseboard");
  const rearOracle = trustedPolylines(roomA.fixture, "back-wall-visible-baseboard");
  const yMax = Math.floor(
    roomA.fixture.emptyImage.dimensions.height *
    roomA.field.parameters.roiYMaxNormalized
  );
  assert.equal(yMax, 695);

  const oracleY244 = yOnPolylineAtX(leftOracle[0], 244);
  assert.ok(oracleY244 && oracleY244 > yMax);
  const roiLimitedXs = Array.from({ length: 51 }, (_, index) => 244 + index)
    .filter(x => {
      const oracleY = yOnPolylineAtX(leftOracle[0], x);
      return oracleY !== null && oracleY > yMax;
    });
  assert.deepEqual(roiLimitedXs, Array.from({ length: 14 }, (_, index) => 244 + index));
  assert.ok(roomA.field.columns[244].candidates.every(candidate =>
    candidate.clusterYMax <= yMax &&
    candidateDistance(candidate, leftOracle) > roomA.fixture.evaluationCorridorSourcePx
  ));

  const oracleY260 = yOnPolylineAtX(leftOracle[0], 260);
  assert.ok(oracleY260);
  const thickRoiCluster = roomA.field.columns[260].candidates.find(candidate =>
    candidate.clusterYMin <= Math.floor(oracleY260) &&
    candidate.clusterYMax >= Math.floor(oracleY260)
  );
  assert.ok(thickRoiCluster);
  assert.equal(thickRoiCluster.clusterYMax, 692);
  assert.ok(thickRoiCluster.y < Math.floor(oracleY260));

  const oracleY386 = yOnPolylineAtX(leftOracle[0], 386);
  assert.ok(oracleY386);
  const sameCluster0013 = roomA.field.columns[386].candidates.find(candidate =>
    candidate.clusterYMin <= Math.floor(oracleY386) &&
    candidate.clusterYMax >= Math.floor(oracleY386)
  );
  assert.ok(sameCluster0013);
  assert.deepEqual(
    {
      representativeY: sameCluster0013.y,
      clusterYMin: sameCluster0013.clusterYMin,
      clusterYMax: sameCluster0013.clusterYMax,
    },
    { representativeY: 597, clusterYMin: 594, clusterYMax: 602 }
  );

  const rearColumns = roomA.field.columns.slice(456, 876);
  const rearRanks = rankDistribution(
    rearColumns,
    rearOracle,
    roomA.fixture.evaluationCorridorSourcePx
  );
  assert.ok(Number(rearRanks["3"] ?? 0) > 0);
  assert.ok(Object.entries(rearRanks).some(([rank, count]) =>
    Number(rank) >= 3 && count > 0
  ));
  assert.ok(roomA.field.columns.slice(330, 373).some(column =>
    column.candidates.some(candidate =>
      candidate.equalsCertifiedWinner &&
      candidateDistance(candidate, leftOracle) <= roomA.fixture.evaluationCorridorSourcePx
    )
  ));
  console.log("P2-S1D ROOM A", JSON.stringify({
    roiYMax: yMax,
    roiLimitedXs,
    x244OracleY: oracleY244,
    x244RecoveredInsideRoi: false,
    x260Cluster: thickRoiCluster,
    x386SameCluster: sameCluster0013,
    rearOracleNearestRankDistribution: rearRanks,
  }));
});

test("P2-S1D exposes Room C radiator-gap multiplicity without linking or acceptance", async () => {
  const [, roomC] = await corpus();
  const gap = roomC.field.columns.slice(316, 438);
  const counts = gap.map(column => column.candidates.length);
  const columnsWithCandidates = counts.filter(count => count > 0).length;
  const meanClusters = counts.reduce((sum, count) => sum + count, 0) / counts.length;
  const maximumClusters = Math.max(...counts);
  assert.equal(gap.length, 122);
  assert.equal(columnsWithCandidates, 122);
  assert.ok(meanClusters > 8);
  assert.ok(maximumClusters >= 12);
  assert.ok(gap.some(column => column.candidates.length > 1));
  assert.ok(gap.every(column =>
    !("status" in column) &&
    !("accepted" in column) &&
    !("points" in column)
  ));
  console.log("P2-S1D ROOM C RADIATOR GAP", JSON.stringify({
    columns: gap.length,
    columnsWithCandidates,
    meanClusterRepresentativesPerColumn: meanClusters,
    maximumClusterCount: maximumClusters,
    candidateMultiplicationSubstantial: meanClusters > 2,
  }));
});

test("P2-S1D output has no wall semantics, linking surface, or live/product importer", async () => {
  const researchDirectory = path.dirname(new URL(import.meta.url).pathname);
  const modulePath = path.join(
    researchDirectory,
    "empty-multi-response-column-field.ts"
  );
  const moduleSource = await readFile(modulePath, "utf8");
  for (const forbidden of [
    "physical_wall",
    "collisionEligible",
    "createPhysicalRoomEnvelope",
    "linkColumnTransitionResponses",
    "accepted_research",
    "wallFamily",
    "camera",
    "worldXZ",
  ]) assert.equal(moduleSource.includes(forbidden), false, forbidden);
  assert.equal(moduleSource.includes("evaluationCorridorSourcePx"), false);
  assert.equal(moduleSource.includes("pointsSourceNormalized"), false);
  assert.equal(moduleSource.includes("annotations"), false);

  const appRoot = path.resolve(researchDirectory, "../../..");
  const importers: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        entryPath !== modulePath
      ) {
        const source = await readFile(entryPath, "utf8");
        if (/from\s+["']\.\/empty-multi-response-column-field["']/.test(source)) {
          importers.push(entryPath);
        }
      }
    }
  }
  await visit(appRoot);
  assert.deepEqual(
    importers.map(importer => path.relative(researchDirectory, importer)),
    [
      "empty-competing-cluster-evidence.test.ts",
      "empty-competing-cluster-evidence.ts",
      "empty-multi-response-column-field.test.ts",
    ]
  );
});

test("P2-S1D is deterministic on repeated frozen A/C/E EMPTY reads", async () => {
  for (const room of await corpus()) {
    const repeated = await readCertifiedEmptyMultiResponseColumnField(
      room.bytes,
      identityOnly(room.fixture)
    );
    assert.equal(repeated.ok, true, repeated.ok ? undefined : repeated.reason);
    if (repeated.ok) assert.deepEqual(repeated, room.field);
  }
});

test("P2-S1D reports candidate-field statistics without claiming wall extraction", async () => {
  const statistics = (await corpus()).map(fieldStatistics);
  assert.deepEqual(
    statistics.map(item => item.responseColumns),
    [948, 1186, 906]
  );
  assert.deepEqual(
    statistics.map(item => item.maxCandidatesInColumn),
    [7, 14, 13]
  );
  assert.ok(statistics.every(item =>
    item.totalCandidates > item.responseColumns &&
    item.winnerMismatchCount === 0
  ));
  console.log("P2-S1D CANDIDATE FIELD STATISTICS", JSON.stringify(statistics));
});
