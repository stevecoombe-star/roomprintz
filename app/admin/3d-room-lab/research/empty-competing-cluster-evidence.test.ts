import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import roomAValue from "./fixtures/p2-s1-empty-physical-boundary/room-a.json";
import roomCValue from "./fixtures/p2-s1-empty-physical-boundary/room-c.json";
import roomEValue from "./fixtures/p2-s1-empty-physical-boundary/room-e.json";
import {
  EMPTY_COMPETING_CLUSTER_EVIDENCE_VERSION,
  type CompetingClusterEvidence,
  type EmptyCompetingClusterEvidenceReadResult,
  computeSamePatchAppearanceStatistics,
  describeCompetingClusterContext,
  readCertifiedEmptyCompetingClusterEvidence,
} from "./empty-competing-cluster-evidence";
import {
  EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION,
  type ColumnTransitionCandidate,
  type EmptyMultiResponseColumnFieldReadResult,
  type MultiResponseColumn,
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
const EXPECTED_CANDIDATE_COUNTS = Object.freeze({
  "room-a": 3130,
  "room-c": 7054,
  "room-e": 3287,
});

type SuccessfulField = Extract<EmptyMultiResponseColumnFieldReadResult, { ok: true }>;
type SuccessfulEvidence = Extract<EmptyCompetingClusterEvidenceReadResult, { ok: true }>;
type PixelPoint = Readonly<{ x: number; y: number }>;
type Benchmark = Readonly<{
  fixture: EmptyPhysicalBoundaryFixture;
  bytes: Uint8Array;
  field: SuccessfulField;
  evidence: SuccessfulEvidence;
}>;

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
  const evidence = await readCertifiedEmptyCompetingClusterEvidence(
    bytes,
    identityOnly(fixture)
  );
  if (!field.ok) assert.fail(field.reason);
  if (!evidence.ok) assert.fail(evidence.reason);
  return Object.freeze({ fixture, bytes, field, evidence });
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

function candidateCount(field: SuccessfulField): number {
  return field.columns.reduce(
    (sum, column) => sum + column.candidates.length,
    0
  );
}

function syntheticCandidate(input: Readonly<{
  x: number;
  y: number;
  rank: number;
  cluster: number;
  yMin?: number;
  yMax?: number;
  score?: number;
  margin?: number;
}>): ColumnTransitionCandidate {
  const clusterYMin = input.yMin ?? input.y;
  const clusterYMax = input.yMax ?? input.y;
  const score = input.score ?? 50 - input.rank;
  return Object.freeze({
    x: input.x,
    y: input.y,
    lumaDrop: score - 5,
    rgbDistance: 20,
    score,
    rankInColumn: input.rank,
    clusterIndexInColumn: input.cluster,
    clusterYMin,
    clusterYMax,
    clusterWidthPx: clusterYMax - clusterYMin + 1,
    equalsCertifiedWinner: input.rank === 1,
    scoreMarginToRank1: input.margin ?? input.rank - 1,
  });
}

function syntheticColumn(
  x: number,
  candidates: readonly ColumnTransitionCandidate[]
): MultiResponseColumn {
  return Object.freeze({
    x,
    certifiedWinner: null,
    candidates: Object.freeze(candidates),
  });
}

function pointToSegmentDistance(
  point: PixelPoint,
  start: PixelPoint,
  end: PixelPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
  );
  return Math.hypot(
    point.x - (start.x + t * dx),
    point.y - (start.y + t * dy)
  );
}

function annotationPixels(
  annotation: EmptyPhysicalBoundaryAnnotation,
  fixture: EmptyPhysicalBoundaryFixture
): readonly PixelPoint[] {
  return annotation.pointsSourceNormalized.map(point => Object.freeze({
    x: point.x * fixture.emptyImage.dimensions.width,
    y: point.y * fixture.emptyImage.dimensions.height,
  }));
}

function distanceToAnnotation(
  record: Pick<CompetingClusterEvidence, "x" | "y">,
  annotation: EmptyPhysicalBoundaryAnnotation,
  fixture: EmptyPhysicalBoundaryFixture
): number {
  const points = annotationPixels(annotation, fixture);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    distance = Math.min(
      distance,
      pointToSegmentDistance(record, points[index - 1], points[index])
    );
  }
  return distance;
}

function annotationById(
  fixture: EmptyPhysicalBoundaryFixture,
  id: string
): EmptyPhysicalBoundaryAnnotation {
  const annotation = fixture.annotations.find(item => item.id === id);
  assert.ok(annotation);
  return annotation;
}

function diagnosticVector(record: CompetingClusterEvidence) {
  return {
    x: record.x,
    y: record.y,
    rank: record.rankInColumn,
    score: record.score,
    margin: record.scoreMarginToRank1,
    clusterWidthPx: record.clusterWidthPx,
    offsets: [
      record.offsetFromClusterTopPx,
      record.offsetFromClusterBottomPx,
    ],
    gaps: [
      record.gapToNearestClusterAbovePx,
      record.gapToNearestClusterBelowPx,
    ],
    neighborDx1: {
      exists: record.neighborDx1Exists,
      signedDy: record.neighborDx1SignedDy,
      scoreDelta: record.neighborDx1ScoreDelta,
      rankDelta: record.neighborDx1RankDelta,
      clusterWidthDelta: record.neighborDx1ClusterWidthDelta,
    },
    patches: {
      aboveMeanRgb: record.aboveMeanRgb,
      belowMeanRgb: record.belowMeanRgb,
      aboveLumaVariance: record.aboveLumaVariance,
      belowLumaVariance: record.belowLumaVariance,
    },
  };
}

test("P2-S1E is a one-record-per-candidate companion with no P2-S1D reorder", async () => {
  const roomDiagnostics = [];
  for (const room of await corpus()) {
    const sourceCandidates = room.field.columns.flatMap(column =>
      column.candidates.map(candidate => ({
        x: candidate.x,
        y: candidate.y,
        rank: candidate.rankInColumn,
        cluster: candidate.clusterIndexInColumn,
      }))
    );
    const evidenceCandidates = room.evidence.records.map(record => ({
      x: record.x,
      y: record.y,
      rank: record.rankInColumn,
      cluster: record.clusterIndexInColumn,
    }));
    const expectedCount =
      EXPECTED_CANDIDATE_COUNTS[
        room.fixture.roomId as keyof typeof EXPECTED_CANDIDATE_COUNTS
      ];

    assert.equal(room.field.version, EMPTY_MULTI_RESPONSE_COLUMN_FIELD_VERSION);
    assert.equal(
      room.evidence.version,
      EMPTY_COMPETING_CLUSTER_EVIDENCE_VERSION
    );
    assert.equal(room.evidence.sourceFieldVersion, room.field.version);
    assert.equal(room.field.winnerMismatchCount, 0);
    assert.equal(candidateCount(room.field), expectedCount);
    assert.equal(room.evidence.records.length, expectedCount);
    assert.deepEqual(evidenceCandidates, sourceCandidates);
    roomDiagnostics.push({
      roomId: room.fixture.roomId,
      p2s1dCandidateCount: expectedCount,
      p2s1eEvidenceRecordCount: room.evidence.records.length,
      countMismatch: room.evidence.records.length - expectedCount,
      winnerMismatch: room.field.winnerMismatchCount,
    });
  }
  console.log("P2-S1E ROOM COUNTS", JSON.stringify(roomDiagnostics));
});

test("P2-S1E evidence generation is deterministic on frozen A/C/E bytes", async () => {
  for (const room of await corpus()) {
    const repeated = await readCertifiedEmptyCompetingClusterEvidence(
      room.bytes,
      identityOnly(room.fixture)
    );
    assert.equal(repeated.ok, true, repeated.ok ? undefined : repeated.reason);
    if (repeated.ok) assert.deepEqual(repeated, room.evidence);
  }
});

test("P2-S1E cluster offsets, singleton, y order, and boundary gaps are exact", () => {
  const rankedMiddle = syntheticCandidate({
    x: 10,
    y: 30,
    rank: 1,
    cluster: 2,
    yMin: 28,
    yMax: 31,
  });
  const rankedHighest = syntheticCandidate({
    x: 10,
    y: 10,
    rank: 2,
    cluster: 1,
    yMin: 9,
    yMax: 11,
  });
  const rankedLowest = syntheticCandidate({
    x: 10,
    y: 50,
    rank: 3,
    cluster: 3,
  });
  const singleton = syntheticCandidate({
    x: 11,
    y: 22,
    rank: 1,
    cluster: 1,
    yMin: 20,
    yMax: 24,
  });
  const records = describeCompetingClusterContext([
    syntheticColumn(10, [rankedMiddle, rankedHighest, rankedLowest]),
    syntheticColumn(11, [singleton]),
  ]);

  assert.deepEqual(records.slice(0, 3).map(record => ({
    rank: record.rankInColumn,
    offsets: [
      record.offsetFromClusterTopPx,
      record.offsetFromClusterBottomPx,
    ],
    competitors: record.competingClusterCount,
    order: record.yOrderInColumn,
    gaps: [
      record.gapToNearestClusterAbovePx,
      record.gapToNearestClusterBelowPx,
    ],
  })), [
    { rank: 1, offsets: [2, 1], competitors: 2, order: "middle", gaps: [17, 19] },
    { rank: 2, offsets: [1, 1], competitors: 2, order: "highest", gaps: [null, 17] },
    { rank: 3, offsets: [0, 0], competitors: 2, order: "lowest", gaps: [19, null] },
  ]);
  assert.deepEqual({
    offsets: [
      records[3].offsetFromClusterTopPx,
      records[3].offsetFromClusterBottomPx,
    ],
    competitors: records[3].competingClusterCount,
    order: records[3].yOrderInColumn,
    gaps: [
      records[3].gapToNearestClusterAbovePx,
      records[3].gapToNearestClusterBelowPx,
    ],
  }, {
    offsets: [2, 2],
    competitors: 0,
    order: "singleton",
    gaps: [null, null],
  });
});

test("P2-S1E x+1 diagnostics use nearest dy, deterministic ties, and no gate", () => {
  const columns = [
    syntheticColumn(20, [
      syntheticCandidate({ x: 20, y: 20, rank: 1, cluster: 1, score: 50 }),
    ]),
    syntheticColumn(21, [
      syntheticCandidate({ x: 21, y: 16, rank: 1, cluster: 1, score: 30 }),
      syntheticCandidate({ x: 21, y: 24, rank: 2, cluster: 2, score: 40 }),
    ]),
    syntheticColumn(30, [
      syntheticCandidate({ x: 30, y: 20, rank: 1, cluster: 1, score: 50 }),
    ]),
    syntheticColumn(31, [
      syntheticCandidate({ x: 31, y: 24, rank: 1, cluster: 2, score: 40 }),
      syntheticCandidate({ x: 31, y: 16, rank: 2, cluster: 1, score: 40 }),
    ]),
    syntheticColumn(40, [
      syntheticCandidate({ x: 40, y: 20, rank: 1, cluster: 1 }),
    ]),
    syntheticColumn(42, [
      syntheticCandidate({ x: 42, y: 21, rank: 1, cluster: 1 }),
    ]),
    syntheticColumn(50, [
      syntheticCandidate({ x: 50, y: 20, rank: 1, cluster: 1 }),
    ]),
    syntheticColumn(51, [
      syntheticCandidate({ x: 51, y: 18, rank: 1, cluster: 1 }),
      syntheticCandidate({ x: 51, y: 30, rank: 2, cluster: 2 }),
    ]),
    syntheticColumn(60, [
      syntheticCandidate({ x: 60, y: 1, rank: 1, cluster: 1 }),
    ]),
    syntheticColumn(61, [
      syntheticCandidate({ x: 61, y: 500, rank: 1, cluster: 1 }),
    ]),
  ];
  const records = describeCompetingClusterContext(columns);
  const at = (x: number) => {
    const record = records.find(item => item.x === x && item.rankInColumn === 1);
    assert.ok(record);
    return record;
  };

  assert.deepEqual(
    [at(20).neighborDx1SignedDy, at(20).neighborDx1RankDelta],
    [4, 1]
  );
  assert.deepEqual(
    [at(30).neighborDx1SignedDy, at(30).neighborDx1RankDelta],
    [-4, 1]
  );
  assert.deepEqual({
    exists: at(40).neighborDx1Exists,
    absDy: at(40).neighborDx1AbsDy,
    signedDy: at(40).neighborDx1SignedDy,
    scoreDelta: at(40).neighborDx1ScoreDelta,
  }, {
    exists: false,
    absDy: null,
    signedDy: null,
    scoreDelta: null,
  });
  assert.equal(at(50).neighborDx1SignedDy, -2);
  assert.equal(at(60).neighborDx1Exists, true);
  assert.equal(at(60).neighborDx1AbsDy, 499);
});

test("P2-S1E patch statistics use only frozen 3x3 above and below geometry", () => {
  const width = 7;
  const height = 15;
  const channels = 3;
  const pixels = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      pixels[offset] = 10 + x + 2 * y;
      pixels[offset + 1] = 20 + 2 * x + y;
      pixels[offset + 2] = 30 + 3 * x + 4 * y;
    }
  }
  const image = Object.freeze({
    roomId: "room-synthetic",
    sha256: "a".repeat(64),
    width,
    height,
    channels,
    pixels,
  });
  const statistics = computeSamePatchAppearanceStatistics(
    image,
    { x: 3, y: 7 }
  );

  function manual(yStart: number, yEnd: number) {
    const samples: [number, number, number][] = [];
    for (let y = yStart; y <= yEnd; y += 1) {
      for (let x = 2; x <= 4; x += 1) {
        const offset = (y * width + x) * channels;
        samples.push([
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
        ]);
      }
    }
    const meanRgb = [0, 1, 2].map(channel =>
      samples.reduce((sum, sample) => sum + sample[channel], 0) / samples.length
    );
    const lumas = samples.map(sample =>
      0.2126 * sample[0] + 0.7152 * sample[1] + 0.0722 * sample[2]
    );
    const lumaMean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
    const variance = lumas.reduce(
      (sum, value) => sum + (value - lumaMean) ** 2,
      0
    ) / lumas.length;
    return { meanRgb, lumaMean, variance };
  }

  const above = manual(2, 4);
  const below = manual(10, 12);
  assert.deepEqual(statistics.aboveMeanRgb, above.meanRgb);
  assert.deepEqual(statistics.belowMeanRgb, below.meanRgb);
  assert.ok(Math.abs(statistics.aboveLumaMean - above.lumaMean) < 1e-12);
  assert.ok(Math.abs(statistics.belowLumaMean - below.lumaMean) < 1e-12);
  assert.ok(Math.abs(statistics.aboveLumaVariance - above.variance) < 1e-12);
  assert.ok(Math.abs(statistics.belowLumaVariance - below.variance) < 1e-12);
});

test("P2-S1E frozen patch diagnostics reproduce P2-S1D appearance evidence", async () => {
  for (const room of await corpus()) {
    for (const record of room.evidence.records) {
      assert.ok(
        Math.abs(
          record.aboveLumaMean - record.belowLumaMean - record.lumaDrop
        ) < 1e-9
      );
      assert.ok(
        Math.abs(
          Math.hypot(
            record.aboveMeanRgb[0] - record.belowMeanRgb[0],
            record.aboveMeanRgb[1] - record.belowMeanRgb[1],
            record.aboveMeanRgb[2] - record.belowMeanRgb[2]
          ) - record.rgbDistance
        ) < 1e-9
      );
    }
  }
});

test("P2-S1E Room E 0020 describes both upper and lower families without selection", async () => {
  const [, , roomE] = await corpus();
  const leftContact = annotationById(
    roomE.fixture,
    "left-wall-visible-baseboard"
  );
  const expected = [
    { x: 484, upperY: 615, lowerY: 641, upperVarianceMin: 400 },
    { x: 504, upperY: 608, lowerY: 632, upperVarianceMin: 800 },
    { x: 523, upperY: 602, lowerY: 625, upperVarianceMin: 500 },
  ];
  const vectors = expected.map(item => {
    const columnRecords = roomE.evidence.records.filter(
      record => record.x === item.x
    );
    const upper = columnRecords.find(record => record.rankInColumn === 1);
    const lower = [...columnRecords].sort((left, right) =>
      distanceToAnnotation(left, leftContact, roomE.fixture) -
      distanceToAnnotation(right, leftContact, roomE.fixture)
    )[0];
    assert.ok(upper);
    assert.ok(lower);
    assert.equal(upper.y, item.upperY);
    assert.equal(lower.y, item.lowerY);
    assert.equal(lower.rankInColumn, 2);
    assert.ok(
      distanceToAnnotation(lower, leftContact, roomE.fixture) <=
      roomE.fixture.evaluationCorridorSourcePx
    );
    assert.ok(
      distanceToAnnotation(upper, leftContact, roomE.fixture) >
      roomE.fixture.evaluationCorridorSourcePx
    );
    assert.ok(upper.belowLumaVariance > item.upperVarianceMin);
    assert.ok(lower.belowLumaVariance < 10);
    return {
      x: item.x,
      rank1Upper: diagnosticVector(upper),
      oracleNearestLower: diagnosticVector(lower),
    };
  });
  console.log("P2-S1E ROOM E 0020", JSON.stringify(vectors));
});

test("P2-S1E Room A rear retains lower-ranked competing structural bands", async () => {
  const [roomA] = await corpus();
  const rearContact = annotationById(
    roomA.fixture,
    "back-wall-visible-baseboard"
  );
  const rearRecords = roomA.evidence.records.filter(
    record => record.x >= 456 && record.x <= 875
  );
  const oracleNear = rearRecords.filter(record =>
    distanceToAnnotation(record, rearContact, roomA.fixture) <=
    roomA.fixture.evaluationCorridorSourcePx
  );
  assert.ok(oracleNear.some(record => record.rankInColumn === 3));
  assert.ok(oracleNear.some(record => record.rankInColumn >= 4));

  const at600 = rearRecords.filter(record => record.x === 600);
  const nearestAt600 = [...at600].sort((left, right) =>
    distanceToAnnotation(left, rearContact, roomA.fixture) -
    distanceToAnnotation(right, rearContact, roomA.fixture)
  )[0];
  assert.ok(nearestAt600);
  assert.ok(nearestAt600.rankInColumn >= 3);
  assert.ok(
    distanceToAnnotation(nearestAt600, rearContact, roomA.fixture) <=
    roomA.fixture.evaluationCorridorSourcePx
  );
  console.log("P2-S1E ROOM A REAR X600", JSON.stringify({
    candidates: at600.map(diagnosticVector),
    oracleNearest: diagnosticVector(nearestAt600),
  }));
});

test("P2-S1E Room C radiator emits dense false-structure diagnostics unchanged", async () => {
  const [, roomC] = await corpus();
  const sourceColumns = roomC.field.columns.slice(316, 438);
  const sourceCount = sourceColumns.reduce(
    (sum, column) => sum + column.candidates.length,
    0
  );
  const records = roomC.evidence.records.filter(
    record => record.x >= 316 && record.x <= 437
  );
  const representedXs = new Set(records.map(record => record.x));
  const samples = [316, 376, 437].map(x => {
    const rank1 = records.find(
      record => record.x === x && record.rankInColumn === 1
    );
    assert.ok(rank1);
    return diagnosticVector(rank1);
  });

  assert.equal(records.length, sourceCount);
  assert.equal(representedXs.size, 122);
  assert.ok(sourceCount / representedXs.size > 8);
  assert.ok(records.every(record =>
    Number.isFinite(record.aboveLumaVariance) &&
    Number.isFinite(record.belowLumaVariance)
  ));
  assert.ok(samples.every(sample => sample.neighborDx1.exists));
  console.log("P2-S1E ROOM C RADIATOR", JSON.stringify({
    columns: representedXs.size,
    candidateCount: sourceCount,
    meanMultiplicity: sourceCount / representedXs.size,
    rank1Samples: samples,
  }));
});

test("P2-S1E has no oracle, authority, selector, linking, or live integration surface", async () => {
  const researchDirectory = path.dirname(new URL(import.meta.url).pathname);
  const modulePath = path.join(
    researchDirectory,
    "empty-competing-cluster-evidence.ts"
  );
  const moduleSource = await readFile(modulePath, "utf8");
  for (const forbidden of [
    "evaluationCorridorSourcePx",
    "annotations",
    "physical_wall",
    "accepted_research",
    "collision",
    "envelope",
    "closure",
    "wallFamily",
    "selectedCandidate",
    "bestPhysicalCandidate",
    "preferredCluster",
    "branchId",
    "polyline",
    "accumulatedHeading",
    "camera",
    "worldXZ",
  ]) assert.equal(moduleSource.includes(forbidden), false, forbidden);
  assert.equal(moduleSource.includes("empty-physical-boundary-read"), false);

  const forbiddenKeys = [
    "branchId",
    "polyline",
    "chain",
    "linkAcceptance",
    "accumulatedHeading",
    "selectedCandidate",
    "status",
  ];
  for (const room of await corpus()) {
    assert.ok(room.evidence.records.every(record =>
      forbiddenKeys.every(key => !(key in record))
    ));
  }

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
        if (
          /from\s+["']\.\/empty-competing-cluster-evidence["']/.test(source)
        ) importers.push(entryPath);
      }
    }
  }
  await visit(appRoot);
  assert.deepEqual(
    importers.map(importer => path.relative(researchDirectory, importer)),
    ["empty-competing-cluster-evidence.test.ts"]
  );
});
