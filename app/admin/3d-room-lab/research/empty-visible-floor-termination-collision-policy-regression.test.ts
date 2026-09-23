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
  classifyP2S2ETerminationCollisionPolicies,
} from "./empty-visible-floor-termination-collision-policy";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  type VisibleFloorTerminationFragment,
  readCertifiedVisibleFloorTerminationFragments,
} from "./empty-visible-floor-contact-localizer";
import {
  createP2S2BEphemeralIdentityAdapter,
} from "./p2-s2b-holdout-prediction";
import {
  loadP2S2BFrozenReviewReceipt,
} from "./p2-s2b-frozen-prediction-review-server";

type RoomId = "room-a" | "room-b" | "room-c" | "room-d" | "room-e";

type RegressionRoom = Readonly<{
  roomId: RoomId;
  fragments: readonly VisibleFloorTerminationFragment[];
  policies: ReturnType<typeof classifyP2S2ETerminationCollisionPolicies>;
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

async function fixtureForRoom(
  roomId: RoomId
): Promise<EmptyPhysicalBoundaryFixture> {
  if (roomId === "room-b" || roomId === "room-d") {
    const verified = await loadP2S2BFrozenReviewReceipt(roomId);
    if (!verified.ok) assert.fail(`${roomId}: ${verified.code}`);
    return createP2S2BEphemeralIdentityAdapter(verified.receipt.input, "a");
  }
  return REVIEWED_FIXTURES[roomId];
}

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
  const fixture = await fixtureForRoom(roomId);
  const bytes = await loadCertifiedEmpty(roomId, fixture);
  const localized = await readCertifiedVisibleFloorTerminationFragments(
    bytes,
    fixture
  );
  if (!localized.ok) assert.fail(`${roomId}: ${localized.reason}`);
  const fragments = localized.localization.fragments;
  const before = structuredClone(fragments);
  const policies = classifyP2S2ETerminationCollisionPolicies(fragments);
  assert.deepEqual(fragments, before);
  return Object.freeze({ roomId, fragments, policies });
}

let corpusPromise: Promise<readonly RegressionRoom[]> | undefined;

function corpus(): Promise<readonly RegressionRoom[]> {
  corpusPromise ??= Promise.all(
    (["room-a", "room-b", "room-c", "room-d", "room-e"] as const)
      .map(regressionRoom)
  );
  return corpusPromise;
}

test("P2-S2E maps the certified A-E P2-S2D corpus one-to-one to block", async () => {
  for (const room of await corpus()) {
    console.log("P2-S2E ROOM", JSON.stringify({
      roomId: room.roomId,
      fragmentCount: room.fragments.length,
      policyCount: room.policies.length,
    }));
    assert.ok(room.fragments.length > 0);
    assert.equal(room.policies.length, room.fragments.length);
    assert.deepEqual(
      room.policies.map(policy => policy.fragmentId),
      room.fragments.map(fragment => fragment.id)
    );
    assert.ok(room.policies.every(policy =>
      policy.evidenceClass === "observed_floor_termination" &&
      policy.collisionPolicy === "block" &&
      policy.policyReasons.length === 1 &&
      policy.policyReasons[0] === "observed_floor_termination"
    ));
    assert.ok(room.policies.every(policy =>
      Object.keys(policy).sort().join(",") ===
        "collisionPolicy,evidenceClass,fragmentId,policyReasons"
    ));
  }
});

test("P2-S2E Room B leaves the reviewed opening as literal absence", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-b");
  assert.ok(room);
  assert.ok(room.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x);
    return !(Math.min(...xs) < 0.865 && Math.max(...xs) > 0.875);
  }));
  assert.equal(room.policies.length, room.fragments.length);
  assert.deepEqual(
    new Set(room.policies.map(policy => policy.fragmentId)),
    new Set(room.fragments.map(fragment => fragment.id))
  );
});

test("P2-S2E Room C cannot bridge the hidden radiator span", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-c");
  assert.ok(room);
  assert.ok(room.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x);
    return !(Math.min(...xs) < 0.55 && Math.max(...xs) > 0.64);
  }));
  assert.ok(room.fragments.every(fragment =>
    fragment.pointsSourceNormalized.every(point => point.y > 0.55)
  ));
  assert.equal(room.policies.length, room.fragments.length);
  assert.ok(room.policies.every(policy => !("pointsSourceNormalized" in policy)));
});

test("P2-S2E Room D blocks occupied-structure terminations without identity fields", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-d");
  assert.ok(room);
  assert.ok(
    room.fragments.reduce(
      (sum, fragment) => sum + fragment.evidence.sourcePixelLength,
      0
    ) > 300
  );
  const occupiedTerminations = room.fragments.filter(fragment =>
    fragment.pointsSourceNormalized.some(point =>
      point.x > 0.69 && point.x < 0.73 &&
      point.y > 0.72 && point.y < 0.76
    )
  );
  assert.ok(occupiedTerminations.length > 0);
  assert.ok(occupiedTerminations.every(fragment =>
    room.policies.find(policy => policy.fragmentId === fragment.id)
      ?.collisionPolicy === "block"
  ));
  assert.ok(room.policies.every(policy => policy.collisionPolicy === "block"));
  assert.ok(room.policies.every(policy =>
    !("boundaryState" in policy) &&
    !("physicalWall" in policy) &&
    !("wallIdentity" in policy)
  ));
});

test("P2-S2E Room E preserves and blocks 0006/0007 without creating a cross-family chord", async () => {
  const room = (await corpus()).find(item => item.roomId === "room-e");
  assert.ok(room);
  const wholeRoomBefore = structuredClone(room.fragments);
  const accepted = ["0006", "0007"].map(suffix => {
    const fragment = room.fragments.find(item => item.id.endsWith(`:${suffix}`));
    assert.ok(fragment, suffix);
    return fragment;
  });
  const before = structuredClone(accepted);
  const policies = classifyP2S2ETerminationCollisionPolicies(accepted);
  assert.deepEqual(accepted, before);
  assert.deepEqual(
    policies.map(policy => policy.fragmentId),
    accepted.map(fragment => fragment.id)
  );
  assert.ok(policies.every(policy => policy.collisionPolicy === "block"));
  assert.ok(policies.every(policy => !("pointsSourceNormalized" in policy)));
  const wholeRoomPolicies =
    classifyP2S2ETerminationCollisionPolicies(room.fragments);
  assert.deepEqual(room.fragments, wholeRoomBefore);
  assert.deepEqual(
    wholeRoomPolicies.map(policy => policy.fragmentId),
    room.fragments.map(fragment => fragment.id)
  );
  assert.ok(wholeRoomPolicies.every(policy =>
    !("pointsSourceNormalized" in policy)
  ));
});
