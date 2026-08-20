import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import roomA from "./fixtures/p2-s1-empty-physical-boundary/room-a.json";
import roomC from "./fixtures/p2-s1-empty-physical-boundary/room-c.json";
import roomE from "./fixtures/p2-s1-empty-physical-boundary/room-e.json";
import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../calibrated-camera-readonly-projection";
import { classifyAfcR3cImagePairCompatibility } from "./afc-r3c-image-pair-compatibility";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  createTestOnlyPhysicalRoomEnvelopeFromAnnotation,
  parseEmptyPhysicalBoundaryFixture,
  projectEmptyPhysicalBoundaryAnnotation,
  sourcePixelCorridorToNormalized,
  verifyEmptyPhysicalBoundaryFixtureIdentity,
} from "./empty-physical-boundary-read";
import { physicalWallEdges } from "../physical-room-envelope";

type ManualPixelReferences = Readonly<
  Record<string, readonly Readonly<{ x: number; y: number }>[]>
>;

/**
 * Human-selected source-pixel anchors recorded only after inspecting the
 * certified EMPTY bytes. This is a review lock against gross fixture drift,
 * not an image detector and not projection-derived geometry.
 */
const MANUAL_SEAM_PIXEL_REFERENCES: Readonly<Record<string, ManualPixelReferences>> = Object.freeze({
  "room-a": Object.freeze({
    "back-wall-visible-baseboard": Object.freeze([
      { x: 456, y: 553 }, { x: 664, y: 553 }, { x: 875, y: 552 },
    ]),
    "left-wall-visible-baseboard": Object.freeze([
      { x: 44, y: 847 }, { x: 236, y: 710 }, { x: 456, y: 553 },
    ]),
    "right-wall-visible-baseboard": Object.freeze([
      { x: 875, y: 552 }, { x: 940, y: 584 }, { x: 1098, y: 685 }, { x: 1263, y: 791 },
    ]),
  }),
  "room-c": Object.freeze({
    "back-wall-left-visible-span": Object.freeze([
      { x: 99, y: 590 }, { x: 205, y: 573 }, { x: 315, y: 556 },
    ]),
    "back-wall-right-visible-span": Object.freeze([
      { x: 438, y: 537 }, { x: 481, y: 530 }, { x: 524, y: 523 },
    ]),
    "right-wall-visible-baseboard": Object.freeze([
      { x: 524, y: 523 }, { x: 800, y: 589 }, { x: 1050, y: 649 }, { x: 1263, y: 700 },
    ]),
  }),
  "room-e": Object.freeze({
    "left-wall-visible-baseboard": Object.freeze([
      { x: 0, y: 830 }, { x: 220, y: 742 }, { x: 440, y: 656 }, { x: 672, y: 562 },
    ]),
    "back-wall-visible-baseboard": Object.freeze([
      { x: 672, y: 562 }, { x: 920, y: 603 }, { x: 1166, y: 644 },
    ]),
  }),
});

function parsed(value: unknown) {
  const result = parseEmptyPhysicalBoundaryFixture(value);
  if (!result.ok) throw new Error(result.reason);
  return result.fixture;
}

function annotation(fixture: ReturnType<typeof parsed>, id: string) {
  const value = fixture.annotations.find(item => item.id === id);
  assert.ok(value, `missing annotation ${id}`);
  return value;
}

/**
 * Exact v3CandidatePose(ROOM_C_SNAPSHOT, ZERO) from the historical 4.8 m ×
 * 4.0 m Room C test snapshot. It is only a read-only projection-stack fixture:
 * the repository records the accepted 4.6 m × 4.0 m, 79° calibration but not
 * its complete applied pose. This fixture is therefore not that certified
 * live camera and must not certify absolute wall distance.
 */
function roomCHistoricalProjectionCamera() {
  const result = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: 79,
    frameSize: { width: 1118, height: 698 },
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
    pose: {
      position: { x: -2.2055247589696, y: 1.5239039479254053, z: 4.991732874351085 },
      lookAt: { x: -1.4828338909916, y: 1.5451582286594053, z: 4.300888344162085 },
      up: { x: -0.018145976802, y: 0.999765997462, z: 0.011775985908 },
    },
  });
  if (!result.ok) throw new Error(result.reason);
  return result.camera;
}

test("P2-S1A fixture contract accepts the manually authored A, C, and E corpus", () => {
  for (const value of [roomA, roomC, roomE]) {
    const fixture = parsed(value);
    assert.equal(fixture.coordinateSpace, "empty-source-normalized/v1");
    assert.equal(fixture.evaluationCorridorSourcePx, 6);
    assert.ok(fixture.annotations.every(item => item.pointsSourceNormalized.length >= 2));
  }
});

test("P2-S1A annotations remain bound to manually reviewed source-pixel seam anchors", () => {
  for (const value of [roomA, roomC, roomE]) {
    const fixture = parsed(value);
    const references = MANUAL_SEAM_PIXEL_REFERENCES[fixture.roomId];
    assert.ok(references, `missing manual pixel review for ${fixture.roomId}`);
    assert.deepEqual(fixture.annotations.map(item => item.id).sort(), Object.keys(references).sort());

    for (const item of fixture.annotations) {
      const anchors = references[item.id];
      assert.ok(anchors, `missing manual pixel anchors for ${fixture.roomId}/${item.id}`);
      assert.equal(item.pointsSourceNormalized.length, anchors.length);
      item.pointsSourceNormalized.forEach((point, index) => {
        const sourcePixel = {
          x: point.x * fixture.emptyImage.dimensions.width,
          y: point.y * fixture.emptyImage.dimensions.height,
        };
        assert.ok(Math.abs(sourcePixel.x - anchors[index].x) <= 0.01);
        assert.ok(Math.abs(sourcePixel.y - anchors[index].y) <= 0.01);
      });
    }
  }
});

test("P2-S1A fixture parser fails closed for version, out-of-range geometry, and duplicate IDs", () => {
  const invalidVersion = structuredClone(roomA);
  invalidVersion.version = "p2-s1-empty-physical-boundary/v2";
  assert.equal(parseEmptyPhysicalBoundaryFixture(invalidVersion).ok, false);

  const invalidPoint = structuredClone(roomA);
  invalidPoint.annotations[0].pointsSourceNormalized[0].x = -0.0001;
  assert.equal(parseEmptyPhysicalBoundaryFixture(invalidPoint).ok, false);

  const duplicate = structuredClone(roomA);
  duplicate.annotations[1].id = duplicate.annotations[0].id;
  assert.equal(parseEmptyPhysicalBoundaryFixture(duplicate).ok, false);

  const invalidState = structuredClone(roomA);
  invalidState.annotations[0].boundaryState = "invented_wall";
  assert.equal(parseEmptyPhysicalBoundaryFixture(invalidState).ok, false);
});

test("P2-S1A exact EMPTY identity binding refuses a stale digest or dimensions", () => {
  const fixture = parsed(roomC);
  const exact = {
    sha256: fixture.emptyImage.sha256,
    dimensions: fixture.emptyImage.dimensions,
  };
  assert.equal(verifyEmptyPhysicalBoundaryFixtureIdentity(fixture, exact), true);
  assert.equal(verifyEmptyPhysicalBoundaryFixtureIdentity(fixture, { ...exact, sha256: "0".repeat(64) }), false);
  assert.equal(verifyEmptyPhysicalBoundaryFixtureIdentity(fixture, {
    ...exact,
    dimensions: { ...exact.dimensions, width: exact.dimensions.width + 1 },
  }), false);
});

test("P2-S1A fixture identities match their confined certified fixed-input manifests", async () => {
  const configuredRoot = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
    path.join(os.homedir(), "Documents", "Vibode", "AFC", "vibode-afc-r3c-fixed-inputs");
  const root = await resolveAfcUi2aFixedInputsRoot(configuredRoot);
  assert.equal(root.ok, true, root.ok ? undefined : root.code);
  if (!root.ok) return;

  for (const raw of [roomA, roomC, roomE]) {
    const fixture = parsed(raw);
    const manifest = JSON.parse(await readFile(
      path.join(root.root, fixture.roomId, fixture.emptyImage.manifestFileName),
      "utf8"
    )) as {
      roomId: string;
      emptyRoomAssist: {
        sha256: string;
        decodedWidth: number;
        decodedHeight: number;
        generatorId: string;
        generatedFromOriginalSha256: string;
        filePath: string;
      };
    };
    assert.equal(manifest.roomId, fixture.roomId);
    assert.equal(verifyEmptyPhysicalBoundaryFixtureIdentity(fixture, {
      sha256: manifest.emptyRoomAssist.sha256,
      dimensions: { width: manifest.emptyRoomAssist.decodedWidth, height: manifest.emptyRoomAssist.decodedHeight },
    }), true);
    assert.equal(manifest.emptyRoomAssist.generatorId, fixture.emptyImage.generatorId);
    assert.equal(manifest.emptyRoomAssist.generatedFromOriginalSha256, fixture.emptyImage.generatedFromOriginalSha256);
    const imageBytes: Buffer = await readFile(path.join(
      root.root,
      fixture.roomId,
      path.basename(manifest.emptyRoomAssist.filePath)
    ));
    assert.equal(createHash("sha256").update(imageBytes).digest("hex"), fixture.emptyImage.sha256);
  }
});

test("P2-S1A collision semantics retain only direct visible physical walls", () => {
  const fixture = parsed(roomA);
  const physical = annotation(fixture, "back-wall-visible-baseboard");
  assert.equal(physical.collisionEligible, true);
  assert.equal(physical.boundaryState, "physical_wall");
  assert.equal(physical.evidenceKind, "direct_visible");

  const open = { ...physical, id: "open-doorway", boundaryState: "open" as const, collisionEligible: false };
  const openFixture = { ...fixture, annotations: [open] };
  const parsedOpen = parsed(openFixture);
  assert.equal(parsedOpen.annotations[0].collisionEligible, false);
  assert.equal(parsedOpen.annotations[0].boundaryState, "open");

  const invalidOpen = { ...open, collisionEligible: true };
  assert.equal(parseEmptyPhysicalBoundaryFixture({ ...fixture, annotations: [invalidOpen] }).ok, false);

  const truncated = annotation(fixture, "left-wall-visible-baseboard");
  assert.equal(truncated.startEndpoint.status, "frame_truncated");
  assert.equal(truncated.startEndpoint.frameContact, "contacts_frame");
  assert.equal(Math.round(truncated.pointsSourceNormalized[0].y * fixture.emptyImage.dimensions.height), 847);
});

test("P2-S1A derives the six-source-pixel corridor from certified dimensions", () => {
  const corridor = sourcePixelCorridorToNormalized(parsed(roomA).emptyImage.dimensions, 6);
  assert.deepEqual(corridor, { x: 6 / 1264, y: 6 / 848 });
});

test("P2-S1A executes corrected Room C evidence through P2-S0 with the untuned historical camera fixture", () => {
  const fixture = parsed(roomC);
  const seam = annotation(fixture, "right-wall-visible-baseboard");
  const original = { width: 7360, height: 4912 };
  const compatibility = classifyAfcR3cImagePairCompatibility(
    { fingerprint: fixture.emptyImage.generatedFromOriginalSha256, decodedWidth: original.width, decodedHeight: original.height, orientation: 1 },
    { fingerprint: fixture.emptyImage.sha256, decodedWidth: fixture.emptyImage.dimensions.width, decodedHeight: fixture.emptyImage.dimensions.height, orientation: 1 }
  );
  assert.equal(compatibility.tier, "aspect_compatible_rescaled");
  const projected = projectEmptyPhysicalBoundaryAnnotation(seam, {
    emptyIntrinsicSize: fixture.emptyImage.dimensions,
    originalIntrinsicSize: original,
    compatibility,
    containerSize: { width: 1118, height: 698 },
    calibratedCamera: roomCHistoricalProjectionCamera(),
  });
  assert.equal(projected.ok, true, projected.ok ? undefined : projected.reason);
  if (!projected.ok) return;
  assert.ok(projected.worldXZ.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)));
  const first = projected.worldXZ[0];
  const last = projected.worldXZ.at(-1);
  assert.ok(last);
  if (!last) return;
  const pathDirection = { x: last.x - first.x, z: last.z - first.z };
  assert.ok(Math.hypot(pathDirection.x, pathDirection.z) > 0);
  for (let index = 1; index < projected.worldXZ.length; index += 1) {
    const previous = projected.worldXZ[index - 1];
    const current = projected.worldXZ[index];
    const forwardProgress =
      (current.x - previous.x) * pathDirection.x +
      (current.z - previous.z) * pathDirection.z;
    assert.ok(forwardProgress > 0, `projected source ordering reversed at segment ${index - 1}`);
  }

  const envelope = createTestOnlyPhysicalRoomEnvelopeFromAnnotation(fixture, seam, projected.worldXZ);
  assert.ok(envelope);
  if (!envelope) return;
  assert.equal(envelope.edges.length, seam.pointsSourceNormalized.length - 1);
  assert.deepEqual(
    physicalWallEdges(envelope).map(edge => edge.id),
    seam.pointsSourceNormalized.slice(1).map((_, index) => `right-wall-visible-baseboard:${index}`)
  );
  const firstStart = envelope.edges[0].startXZ;
  assert.equal(
    envelope.edges.some(edge => edge.endXZ.x === firstStart.x && edge.endXZ.z === firstStart.z),
    false
  );
});

test("P2-S1A test-only handoff does not promote an open chain or add closure", () => {
  const fixture = parsed(roomA);
  const base = annotation(fixture, "back-wall-visible-baseboard");
  const open = { ...structuredClone(base), id: "open-span", boundaryState: "open" as const, collisionEligible: false };
  const envelope = createTestOnlyPhysicalRoomEnvelopeFromAnnotation(
    fixture,
    open,
    [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]
  );
  assert.ok(envelope);
  if (!envelope) return;
  assert.equal(envelope.edges.length, 2);
  assert.deepEqual(physicalWallEdges(envelope), []);
  assert.deepEqual(envelope.edges.map(edge => edge.state), ["open", "open"]);
});
