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
  type BackWallSeamProposal,
  evaluateBackWallSeamCandidates,
} from "./empty-back-wall-seam-candidate";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  OUTSIDE_BACK_WALL_FAMILY_REASON,
  type VisibleFloorWallSeamFragment,
  type VisibleFloorWallSeamRoomEvaluation,
  evaluateVisibleFloorWallSeamFragments,
  interpretP2S1CExperiment,
  readCertifiedEmptyVisibleFloorWallSeamFragments,
} from "./visible-floor-wall-seam-fragment";

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

type Benchmark = Readonly<{
  fixture: EmptyPhysicalBoundaryFixture;
  bytes: Uint8Array;
  read: Extract<
    Awaited<ReturnType<typeof readCertifiedEmptyVisibleFloorWallSeamFragments>>,
    { ok: true }
  >;
  evaluation: VisibleFloorWallSeamRoomEvaluation;
}>;

async function benchmark(value: unknown): Promise<Benchmark> {
  const fixture = parsed(value);
  const bytes = await loadCertifiedEmpty(fixture);
  const read = await readCertifiedEmptyVisibleFloorWallSeamFragments(bytes, fixture);
  if (!read.ok) assert.fail(read.reason);
  return Object.freeze({
    fixture,
    bytes,
    read,
    evaluation: evaluateVisibleFloorWallSeamFragments(read.proposals, fixture),
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

function sourceEndpoints(
  fragment: VisibleFloorWallSeamFragment,
  fixture: EmptyPhysicalBoundaryFixture
) {
  const first = fragment.pointsSourceNormalized[0];
  const last = fragment.pointsSourceNormalized.at(-1) ?? first;
  return {
    start: {
      x: first.x * fixture.emptyImage.dimensions.width,
      y: first.y * fixture.emptyImage.dimensions.height,
    },
    end: {
      x: last.x * fixture.emptyImage.dimensions.width,
      y: last.y * fixture.emptyImage.dimensions.height,
    },
  };
}

test("P2-S1C binds exact certified EMPTY identity and rejects stale bytes", async () => {
  const fixture = parsed(roomAValue);
  const bytes = await loadCertifiedEmpty(fixture);
  const exact = await readCertifiedEmptyVisibleFloorWallSeamFragments(bytes, fixture);
  assert.equal(exact.ok, true, exact.ok ? undefined : exact.reason);
  if (!exact.ok) return;
  assert.deepEqual(exact.observedIdentity, {
    sha256: fixture.emptyImage.sha256,
    dimensions: fixture.emptyImage.dimensions,
  });
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture.emptyImage.sha256);

  const stale = Uint8Array.from(bytes);
  stale[stale.length - 1] ^= 1;
  assert.deepEqual(
    await readCertifiedEmptyVisibleFloorWallSeamFragments(stale, fixture),
    { ok: false, reason: "fixture_identity_mismatch" }
  );
});

test("P2-S1C preserves the exact certified P2-S1B A/C/E accepted sets", async () => {
  const [roomA, roomC, roomE] = await corpus();
  assert.deepEqual(roomA.read.certifiedBackWall.accepted.map(proposal => proposal.id), []);
  assert.deepEqual(roomC.read.certifiedBackWall.accepted.map(proposal => proposal.id), []);
  assert.equal(
    evaluateBackWallSeamCandidates(
      roomC.read.certifiedBackWall.proposals,
      roomC.fixture
    ).illegalBridge,
    false
  );
  assert.deepEqual(
    roomE.read.certifiedBackWall.accepted.map(proposal => proposal.id),
    ["p2-s1b/v1:room-e:0046"]
  );
  const acceptedE = roomE.read.certifiedBackWall.accepted[0];
  const first = acceptedE.pointsSourceNormalized[0];
  const last = acceptedE.pointsSourceNormalized.at(-1);
  assert.ok(last);
  assert.deepEqual(
    [first.x * 1264, first.y * 848, last.x * 1264, last.y * 848],
    [674, 562, 908.9999999999999, 600]
  );
});

test("P2-S1C considers only P2-S1B out-of-back-family rejections", async () => {
  for (const room of await corpus()) {
    assert.ok(room.read.proposals.every(fragment =>
      fragment.lineage.sourceBackWallStatus === "rejected" &&
      fragment.lineage.sourceBackWallRejectionReasons.includes(
        OUTSIDE_BACK_WALL_FAMILY_REASON
      )
    ));
    assert.ok(room.read.proposals.every(fragment => {
      const source = room.read.certifiedBackWall.proposals.find(
        proposal => proposal.id === fragment.lineage.sourceProposalId
      );
      return source &&
        source.pointsSourceNormalized === fragment.pointsSourceNormalized &&
        source.evidence === fragment.evidence;
    }));
  }
});

test("P2-S1C preserves every non-family P2-S1B safety rejection", async () => {
  for (const room of await corpus()) {
    for (const fragment of room.read.proposals) {
      const expected = fragment.lineage.sourceBackWallRejectionReasons.filter(
        reason => reason !== OUTSIDE_BACK_WALL_FAMILY_REASON
      );
      assert.deepEqual(fragment.rejectionReasons, expected);
      assert.equal(
        fragment.status,
        expected.length === 0 ? "accepted_research" : "rejected"
      );
    }
  }
});

test("P2-S1C data supports at least one accepted Room A side-wall fragment", async () => {
  const [roomA] = await corpus();
  assert.ok(roomA.evaluation.acceptedSupportedBySideWallCount > 0);
  assert.ok(roomA.evaluation.acceptedOracleSupport.some(
    support => support.supportedSideWallAnnotationIds.length > 0
  ));
});

test("P2-S1C keeps the Room C radiator gap unbridged and accepts no in-gap fragment", async () => {
  const [, roomC] = await corpus();
  assert.equal(roomC.evaluation.hardFailures.roomCIllegalBridge, false);
  assert.equal(roomC.evaluation.hardFailures.roomCInGapFalseAcceptance, false);
  assert.equal(roomC.read.accepted.length, 0);
});

test("P2-S1C cannot reaccept Room C in-family ambiguity proposal 0035", async () => {
  const [, roomC] = await corpus();
  const radiatorCandidate = roomC.read.certifiedBackWall.proposals.find(
    proposal => proposal.id === "p2-s1b/v1:room-c:0035"
  );
  assert.ok(radiatorCandidate);
  assert.equal(
    radiatorCandidate.rejectionReasons.includes(OUTSIDE_BACK_WALL_FAMILY_REASON),
    false
  );
  assert.equal(
    roomC.read.proposals.some(
      fragment => fragment.lineage.sourceProposalId === radiatorCandidate.id
    ),
    false
  );
  assert.equal(roomC.evaluation.hardFailures.inFamilyCandidateAcceptance, false);
});

test("P2-S1C keeps Room E left and rear fragments split into finite support", async () => {
  const [, , roomE] = await corpus();
  assert.equal(roomE.evaluation.hardFailures.roomEMixedLeftRearChord, false);
  assert.ok(roomE.read.proposals.every(
    fragment => fragment.geometryKind === "ordered_finite_observed_support"
  ));
  assert.ok(roomE.read.accepted.every(fragment => {
    const support = roomE.evaluation.acceptedOracleSupport.find(
      item => item.fragmentId === fragment.id
    );
    return !support ||
      support.supportedSideWallAnnotationIds.length === 0 ||
      support.supportedRearWallAnnotationIds.length === 0;
  }));
});

test("P2-S1C preserves the Room E 0020 precision-tripwire hard failure", async () => {
  const [, , roomE] = await corpus();
  const trap = roomE.read.accepted.find(
    fragment => fragment.lineage.sourceProposalId === "p2-s1b/v1:room-e:0020"
  );
  assert.ok(trap);
  const support = roomE.evaluation.acceptedOracleSupport.find(
    item => item.sourceProposalId === trap.lineage.sourceProposalId
  );
  assert.ok(support);
  assert.equal(support.offOracle, true);
  assert.ok((support.maxDistancePx ?? 0) > roomE.fixture.evaluationCorridorSourcePx);
  assert.equal(roomE.evaluation.hardFailures.roomEOffOracle0020ClassAcceptance, true);
  assert.equal(roomE.evaluation.hardFail, true);
});

test("P2-S1C accepts no image-border-derived fragment", async () => {
  for (const room of await corpus()) {
    assert.equal(room.evaluation.hardFailures.imageBorderAcceptance, false);
    assert.ok(room.read.accepted.every(fragment =>
      !fragment.lineage.sourceBackWallRejectionReasons.includes(
        "touches_image_border_margin"
      )
    ));
  }
});

test("P2-S1C fragment output exposes research evidence only", async () => {
  for (const room of await corpus()) {
    for (const fragment of room.read.proposals) {
      const keys = new Set(Object.keys(fragment));
      assert.equal(keys.has("boundaryState"), false);
      assert.equal(keys.has("collisionEligible"), false);
      assert.equal(keys.has("envelope"), false);
      assert.equal(keys.has("closed"), false);
      assert.ok(["proposed", "rejected", "accepted_research"].includes(fragment.status));
    }
    assert.equal(room.evaluation.hardFailures.hiddenContinuation, false);
    assert.equal(room.evaluation.hardFailures.closure, false);
    assert.equal(room.evaluation.hardFailures.cameraManufacturedPositive, false);
  }
});

test("P2-S1C companion has no live/product importer", async () => {
  const researchDirectory = path.dirname(new URL(import.meta.url).pathname);
  const modulePath = path.join(researchDirectory, "visible-floor-wall-seam-fragment.ts");
  const moduleSource = await readFile(modulePath, "utf8");
  assert.equal(moduleSource.includes("createPhysicalRoomEnvelope"), false);
  assert.equal(moduleSource.includes("calibrated-camera"), false);
  assert.equal(moduleSource.includes("empty-to-world"), false);

  const appRoot = path.resolve(researchDirectory, "../../..");
  const importers: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        entryPath !== modulePath &&
        entryPath !== new URL(import.meta.url).pathname
      ) {
        const source = await readFile(entryPath, "utf8");
        if (/from\s+["']\.\/visible-floor-wall-seam-fragment["']/.test(source)) {
          importers.push(entryPath);
        }
      }
    }
  }
  await visit(appRoot);
  assert.deepEqual(importers, []);
});

test("P2-S1C is deterministic on repeated reads of frozen bytes", async () => {
  for (const room of await corpus()) {
    const repeated = await readCertifiedEmptyVisibleFloorWallSeamFragments(
      room.bytes,
      room.fixture
    );
    assert.equal(repeated.ok, true, repeated.ok ? undefined : repeated.reason);
    if (!repeated.ok) continue;
    assert.deepEqual(repeated.proposals, room.read.proposals);
    assert.deepEqual(
      evaluateVisibleFloorWallSeamFragments(repeated.proposals, room.fixture),
      room.evaluation
    );
  }
});

test("P2-S1C reports the frozen experiment without tuning away failure", async () => {
  const rooms = await corpus();
  const interpretation = interpretP2S1CExperiment(
    rooms.map(room => room.evaluation)
  );
  assert.equal(
    interpretation,
    "P2-S1C FAILS — MULTI-RESPONSE/LOWER-CONTACT PRIMITIVE NEEDED"
  );
  for (const room of rooms) {
    const accepted = room.read.accepted.map(fragment => ({
      sourceProposalId: fragment.lineage.sourceProposalId,
      ...sourceEndpoints(fragment, room.fixture),
      sourcePixelLength: fragment.sourcePixelMeasurements.polylineLengthPx,
      imageSpaceAngleDeg: fragment.imageSpaceAngleDeg,
      oracleSupport: room.evaluation.acceptedOracleSupport.find(
        support => support.fragmentId === fragment.id
      ),
    }));
    console.log("P2-S1C ROOM", JSON.stringify({
      roomId: room.fixture.roomId,
      certifiedBackWallAcceptedIds:
        room.read.certifiedBackWall.accepted.map((proposal: BackWallSeamProposal) => proposal.id),
      experimentalProposalCount: room.read.proposals.length,
      experimentalAccepted: accepted,
      evaluation: room.evaluation,
    }));
  }
  console.log("P2-S1C INTERPRETATION", interpretation);
});
