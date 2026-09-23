import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import roomAValue from "./fixtures/p2-s1-empty-physical-boundary/room-a.json";
import roomCValue from "./fixtures/p2-s1-empty-physical-boundary/room-c.json";
import roomEValue from "./fixtures/p2-s1-empty-physical-boundary/room-e.json";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  EMPTY_SOURCE_PIXEL_COORDINATE_SPACE,
  EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
  type EmptyVisibleFloorRegionReadResult,
  readCertifiedEmptyVisibleFloorRegion,
} from "./empty-visible-floor-region";

const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );

type SuccessfulRegionRead = Extract<
  EmptyVisibleFloorRegionReadResult,
  { ok: true }
>;

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

async function readRoom(
  value: unknown
): Promise<Readonly<{
  fixture: EmptyPhysicalBoundaryFixture;
  bytes: Uint8Array;
  read: SuccessfulRegionRead;
}>> {
  const fixture = parsed(value);
  const bytes = await loadCertifiedEmpty(fixture);
  const read = await readCertifiedEmptyVisibleFloorRegion(bytes, fixture);
  if (!read.ok) assert.fail(read.reason);
  return Object.freeze({ fixture, bytes, read });
}

let corpusPromise: Promise<readonly Awaited<ReturnType<typeof readRoom>>[]> |
  undefined;

function corpus(): Promise<readonly Awaited<ReturnType<typeof readRoom>>[]> {
  corpusPromise ??= Promise.all([
    readRoom(roomAValue),
    readRoom(roomCValue),
    readRoom(roomEValue),
  ]);
  return corpusPromise;
}

test("P2-S2A region proposal binds exact certified A/C/E EMPTY identities", async () => {
  for (const room of await corpus()) {
    assert.equal(
      createHash("sha256").update(room.bytes).digest("hex"),
      room.fixture.emptyImage.sha256
    );
    assert.deepEqual(room.read.observedIdentity, {
      sha256: room.fixture.emptyImage.sha256,
      dimensions: { width: 1264, height: 848 },
    });
    assert.equal(room.read.region.version, EMPTY_VISIBLE_FLOOR_REGION_VERSION);
    assert.equal(
      room.read.region.coordinateSpace,
      EMPTY_SOURCE_PIXEL_COORDINATE_SPACE
    );
    assert.equal(
      room.read.region.emptyImageSha256,
      room.fixture.emptyImage.sha256
    );
  }
});

test("P2-S2A region proposal refuses stale bytes and fixture dimensions", async () => {
  const fixture = parsed(roomAValue);
  const bytes = await loadCertifiedEmpty(fixture);
  const stale = Uint8Array.from(bytes);
  stale[stale.length - 1] ^= 1;
  assert.deepEqual(
    await readCertifiedEmptyVisibleFloorRegion(stale, fixture),
    { ok: false, reason: "fixture_identity_mismatch" }
  );
  const wrongDimensions = {
    ...fixture,
    emptyImage: {
      ...fixture.emptyImage,
      dimensions: {
        width: fixture.emptyImage.dimensions.width + 1,
        height: fixture.emptyImage.dimensions.height,
      },
    },
  };
  assert.deepEqual(
    await readCertifiedEmptyVisibleFloorRegion(bytes, wrongDimensions),
    { ok: false, reason: "fixture_identity_mismatch" }
  );
});

test("P2-S2A lower-center seed components produce diagnostic regions and perimeters", async () => {
  for (const room of await corpus()) {
    const { region } = room.read;
    assert.deepEqual(region.parameters, P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS);
    assert.ok(region.componentPixelCount > 0);
    assert.ok(region.componentFraction > 0 && region.componentFraction < 0.5);
    assert.equal(
      region.componentMask.length,
      region.dimensions.width * region.dimensions.height
    );
    assert.equal(
      region.componentMask[
        region.seed.pointSourcePx.y * region.dimensions.width +
        region.seed.pointSourcePx.x
      ],
      1
    );
    assert.ok(region.boundaryPixelCount > 0);
    assert.ok(region.upperPerimeterSpans.length > 0);
    assert.ok(region.frameContactSpans.length > 0);
    assert.ok(region.upperPerimeterSpans.every(span =>
      span.kind === "upper_component_perimeter" &&
      span.pointsSourcePx.length > 0
    ));
    assert.ok(region.frameContactSpans.every(span =>
      span.kind === "image_frame_contact" &&
      span.touchesImageFrame
    ));
  }
});

test("P2-S2A region proposal is byte-for-byte deterministic on frozen A/C/E", async () => {
  for (const room of await corpus()) {
    const repeated = await readCertifiedEmptyVisibleFloorRegion(
      room.bytes,
      room.fixture
    );
    assert.equal(repeated.ok, true, repeated.ok ? undefined : repeated.reason);
    if (!repeated.ok) continue;
    assert.deepEqual(repeated.observedIdentity, room.read.observedIdentity);
    assert.deepEqual(repeated.region.seed, room.read.region.seed);
    assert.deepEqual(
      repeated.region.componentMask,
      room.read.region.componentMask
    );
    assert.deepEqual(
      repeated.region.diagnosticPerimeterSpans,
      room.read.region.diagnosticPerimeterSpans
    );
  }
});

test("P2-S2A region output remains diagnostic evidence without wall authority", async () => {
  for (const room of await corpus()) {
    const region = room.read.region as unknown as Record<string, unknown>;
    assert.equal("boundaryState" in region, false);
    assert.equal("collisionEligible" in region, false);
    assert.equal("roomPolygon" in region, false);
    assert.equal("worldXZ" in region, false);
  }
});
