import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import roomAValue from "./fixtures/p2-s1-empty-physical-boundary/room-a.json";
import roomCValue from "./fixtures/p2-s1-empty-physical-boundary/room-c.json";
import roomEValue from "./fixtures/p2-s1-empty-physical-boundary/room-e.json";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS,
  type EmptyRegionBoundaryFragmentReadResult,
  evaluateEmptyRegionBoundaryFragments,
  interpretP2S2ARegionFirstExperiment,
  readCertifiedEmptyRegionBoundaryFragments,
} from "./empty-region-boundary-fragments";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import { P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS } from "./empty-visible-floor-region";

const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );

type SuccessfulFragmentRead = Extract<
  EmptyRegionBoundaryFragmentReadResult,
  { ok: true }
>;

type Benchmark = Readonly<{
  fixture: EmptyPhysicalBoundaryFixture;
  bytes: Uint8Array;
  read: SuccessfulFragmentRead;
  evaluation: ReturnType<typeof evaluateEmptyRegionBoundaryFragments>;
}>;

function parsed(value: unknown): EmptyPhysicalBoundaryFixture {
  const result = parseEmptyPhysicalBoundaryFixture(value);
  if (!result.ok) throw new Error(result.reason);
  return result.fixture;
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
  const read = await readCertifiedEmptyRegionBoundaryFragments(bytes, fixture);
  if (!read.ok) assert.fail(read.reason);
  return Object.freeze({
    fixture,
    bytes,
    read,
    evaluation: evaluateEmptyRegionBoundaryFragments(read, fixture),
  });
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

test("P2-S2A fragment reader preserves frozen global parameters and identity", async () => {
  for (const room of await corpus()) {
    assert.deepEqual(
      room.read.regionParameters,
      P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS
    );
    assert.deepEqual(
      room.read.fragmentParameters,
      P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS
    );
    assert.equal(
      room.read.region.emptyImageSha256,
      room.fixture.emptyImage.sha256
    );
    assert.ok(room.read.fragments.length > 0);
    assert.ok(room.read.fragments.every(fragment =>
      fragment.roomId === room.fixture.roomId &&
      fragment.emptyImageSha256 === room.fixture.emptyImage.sha256 &&
      fragment.coordinateSpace === "empty-source-normalized/v1" &&
      fragment.geometryKind === "finite_open_observed_perimeter_span"
    ));
  }
});

test("P2-S2A fragment classifications remain explicit and deterministic", async () => {
  const allowed = new Set(["physical_wall", "frame_truncated", "unknown"]);
  for (const room of await corpus()) {
    assert.ok(room.read.fragments.every(fragment =>
      allowed.has(fragment.boundaryState) &&
      fragment.classificationReasons.length > 0 &&
      fragment.pointsSourceNormalized.length >= 2
    ));
    const repeated = await readCertifiedEmptyRegionBoundaryFragments(
      room.bytes,
      room.fixture
    );
    assert.equal(repeated.ok, true, repeated.ok ? undefined : repeated.reason);
    if (repeated.ok) {
      assert.deepEqual(repeated.fragments, room.read.fragments);
    }
  }
});

test("P2-S2A proposal and classification do not consult oracle coordinates", async () => {
  const roomC = (await corpus()).find(room => room.fixture.roomId === "room-c");
  assert.ok(roomC);
  const displacedOracle: EmptyPhysicalBoundaryFixture = {
    ...roomC.fixture,
    annotations: roomC.fixture.annotations.map(annotation => ({
      ...annotation,
      pointsSourceNormalized: annotation.pointsSourceNormalized.map(point => ({
        x: 1 - point.x,
        y: Math.max(0, point.y - 0.25),
      })),
    })),
  };
  const repeated = await readCertifiedEmptyRegionBoundaryFragments(
    roomC.bytes,
    displacedOracle
  );
  assert.equal(repeated.ok, true, repeated.ok ? undefined : repeated.reason);
  if (!repeated.ok) return;
  assert.deepEqual(repeated.region.componentMask, roomC.read.region.componentMask);
  assert.deepEqual(repeated.fragments, roomC.read.fragments);
});

test("P2-S2A never promotes image-frame perimeter to physical wall", async () => {
  for (const room of await corpus()) {
    assert.equal(room.evaluation.hardFailures.imageBorderPhysicalWall, false);
    assert.equal(
      room.read.physicalWallFragments.some(fragment =>
        fragment.touchesImageFrame
      ),
      false
    );
    assert.ok(room.read.fragments
      .filter(fragment => fragment.touchesImageFrame)
      .every(fragment => fragment.boundaryState !== "physical_wall"));
  }
});

test("P2-S2A emits only finite open fragments and adds no closing segment", async () => {
  for (const room of await corpus()) {
    assert.equal(room.evaluation.hardFailures.forcedClosure, false);
    assert.equal(room.evaluation.hardFailures.hiddenContinuation, false);
    for (const fragment of room.read.fragments) {
      const first = fragment.pointsSourceNormalized[0];
      const last = fragment.pointsSourceNormalized.at(-1);
      assert.ok(first);
      assert.ok(last);
      assert.equal(
        fragment.pointsSourceNormalized.length > 2 &&
          first.x === last.x &&
          first.y === last.y,
        false
      );
    }
  }
});

test("P2-S2A physical fragments stay inside the unchanged P2-S1A corridor", async () => {
  for (const room of await corpus()) {
    assert.equal(room.fixture.evaluationCorridorSourcePx, 6);
    assert.equal(
      room.evaluation.physicalSamplesOutsideCorridor,
      0,
      JSON.stringify(room.evaluation)
    );
    assert.equal(
      room.evaluation.hardFailures.offOraclePhysicalGeometry,
      false
    );
    assert.ok(room.evaluation.acceptedFragmentSupport.every(support =>
      support.sampleCount > 0 &&
      support.insideCorridorSampleCount === support.sampleCount &&
      support.outsideCorridorSampleCount === 0
    ));
  }
});

test("P2-S2A Room C keeps the radiator-hidden span open and non-physical", async () => {
  const roomC = (await corpus()).find(room => room.fixture.roomId === "room-c");
  assert.ok(roomC);
  assert.equal(roomC.evaluation.roomCRadiatorGapRemainsOpen, true);
  assert.equal(roomC.evaluation.hardFailures.roomCIllegalBridge, false);
  assert.equal(
    roomC.evaluation.hardFailures.roomCOccluderContourPhysical,
    false
  );
});

test("P2-S2A Room E does not invent a side/rear chord", async () => {
  const roomE = (await corpus()).find(room => room.fixture.roomId === "room-e");
  assert.ok(roomE);
  assert.equal(
    roomE.evaluation.hardFailures.roomEInventedSideRearChord,
    false
  );
  const mixedAtSharedCorner = roomE.evaluation.acceptedFragmentSupport.filter(
    support =>
      support.supportedSideAnnotationIds.length > 0 &&
      support.supportedRearAnnotationIds.length > 0
  );
  assert.ok(mixedAtSharedCorner.length <= 2);
});

test("P2-S2A frozen A/C/E experiment reports the scientific decision", async () => {
  const rooms = await corpus();
  const evaluations = rooms.map(room => room.evaluation);
  const rounded = (value: number) => Number(value.toFixed(6));
  assert.deepEqual(evaluations.map(evaluation => ({
    roomId: evaluation.roomId,
    regionPixelCount: evaluation.regionPixelCount,
    upperPerimeterSpanCount: evaluation.upperPerimeterSpanCount,
    physicalWallFragmentCount: evaluation.physicalWallFragmentCount,
    unknownFragmentCount: evaluation.unknownFragmentCount,
    frameTruncatedFragmentCount: evaluation.frameTruncatedFragmentCount,
    physicalWallSourcePixelLength:
      Number(evaluation.physicalWallSourcePixelLength.toFixed(3)),
    physicalSamplesInsideCorridor:
      evaluation.physicalSamplesInsideCorridor,
    physicalSamplesOutsideCorridor:
      evaluation.physicalSamplesOutsideCorridor,
    usefulOnCorridorPhysicalFragmentCount:
      evaluation.usefulOnCorridorPhysicalFragmentCount,
    oracleCoverageFraction: rounded(evaluation.oracleCoverageFraction),
  })), [
    {
      roomId: "room-a",
      regionPixelCount: 303270,
      upperPerimeterSpanCount: 30,
      physicalWallFragmentCount: 1,
      unknownFragmentCount: 37,
      frameTruncatedFragmentCount: 4,
      physicalWallSourcePixelLength: 61.064,
      physicalSamplesInsideCorridor: 79,
      physicalSamplesOutsideCorridor: 0,
      usefulOnCorridorPhysicalFragmentCount: 1,
      oracleCoverageFraction: 0.048236,
    },
    {
      roomId: "room-c",
      regionPixelCount: 222135,
      upperPerimeterSpanCount: 43,
      physicalWallFragmentCount: 13,
      unknownFragmentCount: 28,
      frameTruncatedFragmentCount: 4,
      physicalWallSourcePixelLength: 711.232,
      physicalSamplesInsideCorridor: 882,
      physicalSamplesOutsideCorridor: 0,
      usefulOnCorridorPhysicalFragmentCount: 13,
      oracleCoverageFraction: 0.617894,
    },
    {
      roomId: "room-e",
      regionPixelCount: 232320,
      upperPerimeterSpanCount: 18,
      physicalWallFragmentCount: 23,
      unknownFragmentCount: 15,
      frameTruncatedFragmentCount: 4,
      physicalWallSourcePixelLength: 1221.833,
      physicalSamplesInsideCorridor: 1505,
      physicalSamplesOutsideCorridor: 0,
      usefulOnCorridorPhysicalFragmentCount: 23,
      oracleCoverageFraction: 0.953621,
    },
  ]);
  for (const room of rooms) {
    const classificationReasonCounts = room.read.fragments
      .flatMap(fragment => fragment.classificationReasons)
      .reduce<Record<string, number>>((counts, reason) => {
        counts[reason] = (counts[reason] ?? 0) + 1;
        return counts;
      }, {});
    console.log("P2-S2A REGION-FIRST", JSON.stringify({
      roomId: room.fixture.roomId,
      seed: {
        pointSourcePx: room.read.region.seed.pointSourcePx,
        patchMeanRgb: room.read.region.seed.patchMeanRgb,
        patchMeanLuma: room.read.region.seed.patchMeanLuma,
        patchMeanWarmChroma: room.read.region.seed.patchMeanWarmChroma,
        effectiveMinimumWarmChroma:
          room.read.region.seed.effectiveMinimumWarmChroma,
        effectiveMaximumLuma:
          room.read.region.seed.effectiveMaximumLuma,
        appearancePrototypeCount:
          room.read.region.seed.appearancePrototypes.length,
      },
      region: {
        pixelCount: room.evaluation.regionPixelCount,
        fraction: room.evaluation.regionFraction,
        upperPerimeterSpanCount: room.evaluation.upperPerimeterSpanCount,
      },
      physicalFragments: room.read.physicalWallFragments.map(fragment => ({
        id: fragment.id,
        sourceSpanId: fragment.sourcePerimeterSpanId,
        start: fragment.pointsSourceNormalized[0],
        end: fragment.pointsSourceNormalized.at(-1),
        sourcePixelLength: fragment.verification.sourcePixelLength,
      })),
      classificationReasonCounts,
      evaluation: {
        physicalWallFragmentCount:
          room.evaluation.physicalWallFragmentCount,
        unknownFragmentCount: room.evaluation.unknownFragmentCount,
        frameTruncatedFragmentCount:
          room.evaluation.frameTruncatedFragmentCount,
        physicalWallSourcePixelLength:
          room.evaluation.physicalWallSourcePixelLength,
        physicalSamplesInsideCorridor:
          room.evaluation.physicalSamplesInsideCorridor,
        physicalSamplesOutsideCorridor:
          room.evaluation.physicalSamplesOutsideCorridor,
        oracleCoverageFraction: room.evaluation.oracleCoverageFraction,
        usefulOnCorridorPhysicalFragmentCount:
          room.evaluation.usefulOnCorridorPhysicalFragmentCount,
        roomCRadiatorGapRemainsOpen:
          room.evaluation.roomCRadiatorGapRemainsOpen,
        hardFailures: room.evaluation.hardFailures,
      },
    }));
  }
  assert.equal(
    interpretP2S2ARegionFirstExperiment(evaluations),
    "P2-S2A REGION-FIRST EXPERIMENT VIABLE"
  );
});
