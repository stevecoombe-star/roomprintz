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
  type EmptyRegionBoundaryFragment,
  readCertifiedEmptyRegionBoundaryFragments,
} from "./empty-region-boundary-fragments";
import {
  type EmptyPhysicalBoundaryAnnotation,
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  type VisibleFloorContactDiagnostics,
  type VisibleFloorTerminationFragment,
  readCertifiedVisibleFloorTerminationFragments,
} from "./empty-visible-floor-contact-localizer";
import {
  type P2S2BFrozenPredictionReceipt,
  createP2S2BEphemeralIdentityAdapter,
} from "./p2-s2b-holdout-prediction";
import {
  loadP2S2BFrozenReviewReceipt,
} from "./p2-s2b-frozen-prediction-review-server";

type RoomId = "room-a" | "room-b" | "room-c" | "room-d" | "room-e";
type PixelPoint = Readonly<{ x: number; y: number }>;
type PixelPolyline = readonly PixelPoint[];

type RegressionRoom = Readonly<{
  roomId: RoomId;
  fixture: EmptyPhysicalBoundaryFixture;
  bytes: Uint8Array;
  oldFragments: readonly EmptyRegionBoundaryFragment[];
  newFragments: readonly VisibleFloorTerminationFragment[];
  diagnostics: VisibleFloorContactDiagnostics;
  frozenReceipt: P2S2BFrozenPredictionReceipt | null;
}>;

const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );

function parsedFixture(value: unknown): EmptyPhysicalBoundaryFixture {
  const parsed = parseEmptyPhysicalBoundaryFixture(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.fixture;
}

const REVIEWED_FIXTURES = Object.freeze({
  "room-a": parsedFixture(roomAValue),
  "room-c": parsedFixture(roomCValue),
  "room-e": parsedFixture(roomEValue),
});

async function loadCertifiedEmpty(
  roomId: RoomId,
  fixture: EmptyPhysicalBoundaryFixture
): Promise<Uint8Array> {
  const root = await resolveAfcUi2aFixedInputsRoot(FIXED_INPUTS_ROOT);
  if (!root.ok) assert.fail(root.code);
  const manifest = JSON.parse(await readFile(
    path.join(root.root, roomId, fixture.emptyImage.manifestFileName),
    "utf8"
  )) as Readonly<{
    emptyRoomAssist: Readonly<{ filePath: string; sha256: string }>;
  }>;
  assert.equal(manifest.emptyRoomAssist.sha256, fixture.emptyImage.sha256);
  return readFile(path.join(
    root.root,
    roomId,
    path.basename(manifest.emptyRoomAssist.filePath)
  ));
}

async function regressionRoom(roomId: RoomId): Promise<RegressionRoom> {
  if (roomId === "room-b" || roomId === "room-d") {
    const verified = await loadP2S2BFrozenReviewReceipt(roomId);
    if (!verified.ok) assert.fail(`${roomId}: ${verified.code}`);
    if (verified.receipt.outcome.status !== "ok") {
      assert.fail(`${roomId}: frozen outcome unavailable`);
    }
    const fixture = createP2S2BEphemeralIdentityAdapter(
      verified.receipt.input,
      "a"
    );
    const bytes = await loadCertifiedEmpty(roomId, fixture);
    const localized = await readCertifiedVisibleFloorTerminationFragments(
      bytes,
      fixture
    );
    if (!localized.ok) assert.fail(`${roomId}: ${localized.reason}`);
    return Object.freeze({
      roomId,
      fixture,
      bytes,
      oldFragments: verified.receipt.outcome.fragments,
      newFragments: localized.localization.fragments,
      diagnostics: localized.localization.diagnostics,
      frozenReceipt: verified.receipt,
    });
  }
  const fixture = REVIEWED_FIXTURES[roomId];
  const bytes = await loadCertifiedEmpty(roomId, fixture);
  const [oldRead, localized] = await Promise.all([
    readCertifiedEmptyRegionBoundaryFragments(bytes, fixture),
    readCertifiedVisibleFloorTerminationFragments(bytes, fixture),
  ]);
  if (!oldRead.ok) assert.fail(`${roomId}: old ${oldRead.reason}`);
  if (!localized.ok) assert.fail(`${roomId}: new ${localized.reason}`);
  return Object.freeze({
    roomId,
    fixture,
    bytes,
    oldFragments: oldRead.fragments,
    newFragments: localized.localization.fragments,
    diagnostics: localized.localization.diagnostics,
    frozenReceipt: null,
  });
}

let corpusPromise: Promise<readonly RegressionRoom[]> | undefined;

function corpus(): Promise<readonly RegressionRoom[]> {
  corpusPromise ??= Promise.all(
    (["room-a", "room-b", "room-c", "room-d", "room-e"] as const)
      .map(regressionRoom)
  );
  return corpusPromise;
}

function pixelPolyline(
  points: readonly PixelPoint[],
  dimensions: Readonly<{ width: number; height: number }>
): PixelPolyline {
  return points.map(point => ({
    x: point.x * dimensions.width,
    y: point.y * dimensions.height,
  }));
}

function samplePolyline(
  polyline: PixelPolyline,
  spacingPx = 1
): readonly PixelPoint[] {
  const samples: PixelPoint[] = [];
  for (let index = 1; index < polyline.length; index += 1) {
    const start = polyline[index - 1];
    const end = polyline[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(length / spacingPx));
    for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
      const ratio = step / steps;
      samples.push({
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      });
    }
  }
  return samples;
}

function pointToSegmentDistance(
  point: PixelPoint,
  start: PixelPoint,
  end: PixelPoint
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(
    1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator
  ));
  return Math.hypot(
    point.x - (start.x + dx * ratio),
    point.y - (start.y + dy * ratio)
  );
}

function pointToPolylinesDistance(
  point: PixelPoint,
  polylines: readonly PixelPolyline[]
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const polyline of polylines) {
    for (let index = 1; index < polyline.length; index += 1) {
      minimum = Math.min(
        minimum,
        pointToSegmentDistance(point, polyline[index - 1], polyline[index])
      );
    }
  }
  return minimum;
}

function fragmentSamples(
  fragment: VisibleFloorTerminationFragment,
  room: RegressionRoom
): readonly PixelPoint[] {
  return samplePolyline(pixelPolyline(
    fragment.pointsSourceNormalized,
    room.fixture.emptyImage.dimensions
  ));
}

function annotationPolyline(
  annotation: EmptyPhysicalBoundaryAnnotation,
  room: RegressionRoom
): PixelPolyline {
  return pixelPolyline(
    annotation.pointsSourceNormalized,
    room.fixture.emptyImage.dimensions
  );
}

function fragmentTouchesAnnotation(
  fragment: VisibleFloorTerminationFragment,
  annotation: EmptyPhysicalBoundaryAnnotation,
  room: RegressionRoom
): boolean {
  const oracle = annotationPolyline(annotation, room);
  return fragmentSamples(fragment, room).some(point =>
    pointToPolylinesDistance(point, [oracle]) <=
      room.fixture.evaluationCorridorSourcePx
  );
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

test("P2-S2D localizes deterministic finite open fragments on certified A-E EMPTY", async () => {
  for (const room of await corpus()) {
    console.log("P2-S2D ROOM", JSON.stringify({
      roomId: room.roomId,
      oldFragmentCount: room.oldFragments.length,
      oldPhysicalCount: room.oldFragments.filter(
        fragment => fragment.boundaryState === "physical_wall"
      ).length,
      newFragmentCount: room.newFragments.length,
      newLengthPx: rounded(room.newFragments.reduce(
        (sum, fragment) => sum + fragment.evidence.sourcePixelLength,
        0
      )),
      diagnostics: {
        ...room.diagnostics,
        supportComponents: room.diagnostics.supportComponents
          .filter(component => component.rawExcludedPixelCount >= 1_000),
      },
      newFragments: room.roomId === "room-c" || room.roomId === "room-e"
        ? room.newFragments.map(fragment => ({
        id: fragment.id,
        start: fragment.pointsSourceNormalized[0],
        end: fragment.pointsSourceNormalized.at(-1),
        lengthPx: rounded(fragment.evidence.sourcePixelLength),
        samples: fragment.evidence.contactSampleCount,
        }))
        : [],
    }));
    assert.ok(room.newFragments.length > 0, room.roomId);
    assert.equal(room.diagnostics.fragmentCount, room.newFragments.length);
    for (const fragment of room.newFragments) {
      assert.equal(fragment.roomId, room.roomId);
      assert.equal(fragment.emptyImageSha256, room.fixture.emptyImage.sha256);
      assert.equal(fragment.coordinateSpace, "empty-source-normalized/v1");
      assert.equal(
        fragment.geometryKind,
        "finite_open_visible_floor_termination"
      );
      assert.ok(fragment.pointsSourceNormalized.length >= 2);
      assert.notDeepEqual(
        fragment.pointsSourceNormalized[0],
        fragment.pointsSourceNormalized.at(-1)
      );
      assert.ok(fragment.evidence.minimumFrameDistancePx > 4);
    }
  }
});

test("P2-S2D keeps Room C radiator-hidden rear span disconnected", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-c");
  assert.ok(room);
  const left = room.fixture.annotations.find(
    annotation => annotation.id === "back-wall-left-visible-span"
  );
  const right = room.fixture.annotations.find(
    annotation => annotation.id === "back-wall-right-visible-span"
  );
  assert.ok(left);
  assert.ok(right);
  assert.ok(room.newFragments.every(fragment =>
    !(
      fragmentTouchesAnnotation(fragment, left, room) &&
      fragmentTouchesAnnotation(fragment, right, room)
    )
  ));
});

test("P2-S2D Room A moves the central contact off heater lid and jamb geometry", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-a");
  assert.ok(room);
  const back = room.fixture.annotations.find(
    annotation => annotation.id === "back-wall-visible-baseboard"
  );
  assert.ok(back);
  assert.ok(room.newFragments.some(fragment =>
    fragmentTouchesAnnotation(fragment, back, room)
  ));
  const thickExcluded = room.diagnostics.supportComponents.find(component =>
    component.maximumThicknessPx === 123 &&
    component.boundsSourcePx.minX <= 20 &&
    component.boundsSourcePx.maxX === 1_263
  );
  assert.ok(thickExcluded);
  assert.equal(thickExcluded.remainedExcluded, true);
  assert.equal(thickExcluded.thinComponentRestored, false);
  assert.ok(room.newFragments.every(fragment =>
    fragment.pointsSourceNormalized.every(point =>
      !(
        point.x >= 0.35 &&
        point.x <= 0.72 &&
        point.y >= 0.48 &&
        point.y <= 0.61
      )
    )
  ));
});

test("P2-S2D Room C rejects upper radiator paths and bottom-frame chords", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-c");
  assert.ok(room);
  assert.ok(room.newFragments.every(fragment =>
    fragment.evidence.minimumFrameDistancePx > 4 &&
    fragment.pointsSourceNormalized.every(point => point.y > 0.55)
  ));
});

test("P2-S2D Room E allows reviewed right-wall runs but no cross-family chord", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-e");
  assert.ok(room);
  const rightRearSliver = room.diagnostics.supportComponents.find(component =>
    component.boundsSourcePx.minX >= 1_100 &&
    component.maximumThicknessPx === 13
  );
  assert.ok(rightRearSliver);
  assert.equal(rightRearSliver.thinComponentRestored, true);
  assert.equal(rightRearSliver.remainedExcluded, false);

  // Human review provenance:
  // - 0007-class geometry is legitimate visible right-wall floor contact.
  // - 0006-class geometry has a small baseboard-face offset acceptable for v1.
  // These local finite runs are not synthetic side/rear chords and are not
  // blockers; future seam-placement refinement is outside this evaluation.
  const visibleSide = room.fixture.annotations.filter(annotation =>
    annotation.evidenceKind === "direct_visible" &&
    annotation.interpretation === "side_wall_floor_seam"
  );
  const visibleRear = room.fixture.annotations.filter(annotation =>
    annotation.evidenceKind === "direct_visible" &&
    annotation.interpretation === "rear_floor_wall_seam"
  );
  const sidePolylines = visibleSide.map(annotation =>
    annotationPolyline(annotation, room)
  );
  const rearPolylines = visibleRear.map(annotation =>
    annotationPolyline(annotation, room)
  );
  const sharedCorners = sidePolylines.flatMap(sidePolyline =>
    sidePolyline.flatMap(sidePoint =>
      rearPolylines.flatMap(rearPolyline =>
        rearPolyline.filter(rearPoint =>
          Math.hypot(
            sidePoint.x - rearPoint.x,
            sidePoint.y - rearPoint.y
          ) <= 1
        )
      )
    )
  );
  const awayFromSharedCorner = (point: PixelPoint) =>
    sharedCorners.length === 0 ||
    sharedCorners.every(corner =>
      Math.hypot(point.x - corner.x, point.y - corner.y) >
        room.fixture.evaluationCorridorSourcePx * 2
    );

  for (const fragment of room.newFragments) {
    const samples = fragmentSamples(fragment, room);
    const meaningfulSideSupport = samples.some(point =>
      awayFromSharedCorner(point) &&
      pointToPolylinesDistance(point, sidePolylines) <=
        room.fixture.evaluationCorridorSourcePx
    );
    const meaningfulRearSupport = samples.some(point =>
      awayFromSharedCorner(point) &&
      pointToPolylinesDistance(point, rearPolylines) <=
        room.fixture.evaluationCorridorSourcePx
    );
    assert.equal(
      meaningfulSideSupport && meaningfulRearSupport,
      false,
      `${fragment.id}: invented shortcut across separate visible families`
    );
    assert.ok(fragment.evidence.minimumFrameDistancePx > 4);
    assert.notDeepEqual(
      fragment.pointsSourceNormalized[0],
      fragment.pointsSourceNormalized.at(-1)
    );
  }
});

test("P2-S2D A/C/E post-hoc report stays isolated from detector input", async () => {
  const rooms = await corpus();
  const failures: string[] = [];
  for (const roomId of ["room-a", "room-e", "room-c"] as const) {
    const room = rooms.find(item => item.roomId === roomId);
    assert.ok(room);
    const trusted = room.fixture.annotations.filter(annotation =>
      annotation.evidenceKind === "direct_visible"
    );
    const oraclePolylines = trusted.map(annotation =>
      annotationPolyline(annotation, room)
    );
    const samples = room.newFragments.flatMap(fragment =>
      fragmentSamples(fragment, room)
    );
    const supported = samples.filter(point =>
      pointToPolylinesDistance(point, oraclePolylines) <=
        room.fixture.evaluationCorridorSourcePx
    );
    console.log("P2-S2D POST-HOC", JSON.stringify({
      roomId: room.roomId,
      sampleCount: samples.length,
      supportedSampleCount: supported.length,
      supportedSampleFraction:
        samples.length === 0 ? 0 : rounded(supported.length / samples.length),
      annotationCoverage: trusted.map(annotation => ({
        id: annotation.id,
        represented: room.newFragments.some(fragment =>
          fragmentTouchesAnnotation(fragment, annotation, room)
        ),
      })),
    }));
    const supportedFraction = samples.length === 0
      ? 0
      : supported.length / samples.length;
    if (room.roomId === "room-a" && supportedFraction < 0.8) {
      failures.push(
        `${room.roomId}: ${supportedFraction.toFixed(6)} post-hoc supported`
      );
    }
  }
  assert.deepEqual(failures, []);
});

test("P2-S2D Room C preserves direct visible extras outside its limited oracle", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-c");
  assert.ok(room);
  assert.ok(room.newFragments.some(fragment =>
    fragment.pointsSourceNormalized.some(point =>
      point.x < 0.09 && point.y > 0.72 && point.y < 0.78
    )
  ));
  assert.ok(room.newFragments.some(fragment =>
    fragment.pointsSourceNormalized.some(point =>
      point.x > 0.29 && point.x < 0.33 &&
      point.y > 0.63 && point.y < 0.66
    )
  ));
});

test("P2-S2D B/D use certified bytes independently while old geometry stays frozen", async () => {
  for (const room of (await corpus()).filter(
    item => item.roomId === "room-b" || item.roomId === "room-d"
  )) {
    assert.ok(room.frozenReceipt);
    assert.equal(room.frozenReceipt.outcome.status, "ok");
    const oldPhysical = room.oldFragments.filter(
      fragment => fragment.boundaryState === "physical_wall"
    );
    const baseline = oldPhysical.map(fragment =>
      pixelPolyline(
        fragment.pointsSourceNormalized,
        room.fixture.emptyImage.dimensions
      )
    );
    const samples = room.newFragments.flatMap(fragment =>
      fragmentSamples(fragment, room)
    );
    const nearBaseline = samples.filter(point =>
      pointToPolylinesDistance(point, baseline) <= 8
    );
    console.log("P2-S2D B/D COMPARISON", JSON.stringify({
      roomId: room.roomId,
      frozenOldPhysicalCount: oldPhysical.length,
      newFragmentCount: room.newFragments.length,
      newSampleCount: samples.length,
      nearFrozenOldPhysicalCount: nearBaseline.length,
      nearFrozenOldPhysicalFraction:
        samples.length === 0 ? 0 : rounded(nearBaseline.length / samples.length),
      oldPhysical: oldPhysical.map(fragment => ({
        id: fragment.id,
        start: fragment.pointsSourceNormalized[0],
        end: fragment.pointsSourceNormalized.at(-1),
      })),
    }));
  }
});

test("P2-S2D Room B keeps the reviewed opening gap and Room D retains finite seam support", async () => {
  const rooms = await corpus();
  const roomB = rooms.find(room => room.roomId === "room-b");
  const roomD = rooms.find(room => room.roomId === "room-d");
  assert.ok(roomB);
  assert.ok(roomD);
  assert.ok(roomB.newFragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x);
    return !(Math.min(...xs) < 0.865 && Math.max(...xs) > 0.875);
  }));
  assert.ok(roomB.newFragments.some(fragment =>
    fragment.pointsSourceNormalized.some(point =>
      point.x > 0.57 && point.x < 0.85 && point.y > 0.59 && point.y < 0.68
    )
  ));
  assert.ok(
    roomD.newFragments.reduce(
      (sum, fragment) => sum + fragment.evidence.sourcePixelLength,
      0
    ) > 300
  );
});
