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
  evaluateEmptyRegionBoundaryFragments,
  readCertifiedEmptyRegionBoundaryFragments,
} from "./empty-region-boundary-fragments";
import {
  type EmptyPhysicalBoundaryFixture,
  parseEmptyPhysicalBoundaryFixture,
} from "./empty-physical-boundary-read";
import {
  type P2S2CCollisionPolicyRecord,
  classifyP2S2CCollisionPolicies,
} from "./empty-boundary-collision-policy";
import {
  P2_S2B_FROZEN_REVIEW_RECEIPT_HASHES,
  verifyP2S2BFrozenReviewReceipt,
} from "./p2-s2b-frozen-prediction-review-server";
import type {
  P2S2BFrozenReviewRoomId,
} from "./p2-s2b-frozen-prediction-review";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);
const RECEIPT_ROOT = path.join(
  RESEARCH_ROOT,
  "fixtures",
  "p2-s2b-holdout-predictions"
);
const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );

function shortId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

function parsedFixture(value: unknown): EmptyPhysicalBoundaryFixture {
  const parsed = parseEmptyPhysicalBoundaryFixture(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.fixture;
}

async function certifiedEmptyBytes(
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

async function verifiedFrozenFragments(roomId: P2S2BFrozenReviewRoomId) {
  const jsonPath = path.join(RECEIPT_ROOT, `${roomId}.json`);
  const sidecarPath = `${jsonPath}.sha256`;
  const [rawJson, rawSidecar] = await Promise.all([
    readFile(jsonPath, "utf8"),
    readFile(sidecarPath, "utf8"),
  ]);
  const verified = verifyP2S2BFrozenReviewReceipt(
    roomId,
    rawJson,
    rawSidecar
  );
  if (!verified.ok) assert.fail(verified.code);
  assert.equal(
    verified.receiptSha256,
    P2_S2B_FROZEN_REVIEW_RECEIPT_HASHES[roomId]
  );
  assert.equal(verified.receipt.outcome.status, "ok");
  if (verified.receipt.outcome.status !== "ok") assert.fail("missing outcome");
  return {
    fragments: verified.receipt.outcome.fragments,
    receiptSha256: verified.receiptSha256,
    rawJson,
    rawSidecar,
    jsonPath,
    sidecarPath,
  };
}

function byShortId(
  fragments: readonly EmptyRegionBoundaryFragment[],
  records: readonly P2S2CCollisionPolicyRecord[],
  suffix: string
) {
  const fragment = fragments.find(item => shortId(item.id) === suffix);
  const policy = records.find(item => shortId(item.fragmentId) === suffix);
  assert.ok(fragment, `missing fragment ${suffix}`);
  assert.ok(policy, `missing policy ${suffix}`);
  return { fragment, policy };
}

test("P2-S2C consumes exact sealed B/D receipts without rewriting them", async () => {
  for (const roomId of ["room-b", "room-d"] as const) {
    const frozen = await verifiedFrozenFragments(roomId);
    const sourceBefore = structuredClone(frozen.fragments);
    const records = classifyP2S2CCollisionPolicies(frozen.fragments);

    assert.deepEqual(frozen.fragments, sourceBefore);
    assert.deepEqual(
      records.map(record => record.fragmentId),
      frozen.fragments.map(fragment => fragment.id)
    );
    assert.ok(records.every(record =>
      Object.keys(record).sort().join(",") ===
        "collisionPolicy,evidenceClass,fragmentId,policyReasons"
    ));
    assert.equal(
      records.some(record =>
        "pointsSourceNormalized" in record || "boundaryState" in record
      ),
      false
    );
    assert.ok(frozen.fragments
      .filter(fragment =>
        fragment.boundaryState === "frame_truncated" ||
        fragment.touchesImageFrame
      )
      .every(fragment =>
        records.find(record => record.fragmentId === fragment.id)
          ?.collisionPolicy === "pass"
      ));
    assert.equal(await readFile(frozen.jsonPath, "utf8"), frozen.rawJson);
    assert.equal(await readFile(frozen.sidecarPath, "utf8"), frozen.rawSidecar);

    console.log("P2-S2C FROZEN OVERLAY", JSON.stringify({
      roomId,
      receiptSha256: frozen.receiptSha256,
      fragments: frozen.fragments.map(fragment => {
        const policy = records.find(record =>
          record.fragmentId === fragment.id
        );
        return {
          id: shortId(fragment.id),
          sourceBoundaryState: fragment.boundaryState,
          evidenceClass: policy?.evidenceClass,
          collisionPolicy: policy?.collisionPolicy,
          policyReasons: policy?.policyReasons,
        };
      }),
    }));
  }
});

test("P2-S2C Room D decouples finite termination from wall identity", async () => {
  const { fragments } = await verifiedFrozenFragments("room-d");
  const records = classifyP2S2CCollisionPolicies(fragments);

  for (const suffix of ["0001", "0006", "0007", "0008", "0009"]) {
    const { fragment, policy } = byShortId(fragments, records, suffix);
    assert.equal(fragment.boundaryState, "unknown");
    assert.equal(policy.evidenceClass, "observed_floor_termination");
    assert.equal(policy.collisionPolicy, "block");
    assert.deepEqual(policy.policyReasons, ["observed_floor_termination"]);
  }
  for (const fragment of fragments.filter(item =>
    item.boundaryState === "physical_wall"
  )) {
    const policy = records.find(record => record.fragmentId === fragment.id);
    assert.equal(policy?.evidenceClass, "verified_wall_contact");
    assert.equal(policy?.collisionPolicy, "block");
  }
  assert.ok(fragments
    .filter(fragment => fragment.boundaryState === "frame_truncated")
    .every(fragment =>
      records.find(record => record.fragmentId === fragment.id)
        ?.collisionPolicy === "pass"
    ));
});

test("P2-S2C Room B applies one predicate while preserving the opening gap", async () => {
  const { fragments } = await verifiedFrozenFragments("room-b");
  const records = classifyP2S2CCollisionPolicies(fragments);

  for (const suffix of ["0012", "0013", "0014"]) {
    const { fragment, policy } = byShortId(fragments, records, suffix);
    assert.equal(fragment.boundaryState, "unknown");
    assert.equal(policy.evidenceClass, "observed_floor_termination");
    assert.equal(policy.collisionPolicy, "block");
  }
  const fragment0015 = byShortId(fragments, records, "0015");
  assert.equal(fragment0015.fragment.boundaryState, "unknown");
  assert.equal(fragment0015.policy.evidenceClass, "unresolved");
  assert.equal(fragment0015.policy.collisionPolicy, "pass");
  assert.deepEqual(
    fragment0015.policy.policyReasons,
    ["insufficient_finite_support"]
  );

  const openingEdge = byShortId(fragments, records, "0024");
  assert.equal(openingEdge.fragment.boundaryState, "unknown");
  assert.equal(openingEdge.policy.evidenceClass, "unresolved");
  assert.equal(openingEdge.policy.collisionPolicy, "pass");
  assert.ok(
    openingEdge.policy.policyReasons.includes("insufficient_finite_support")
  );

  const qualifyingUnknowns = fragments.filter(fragment =>
    fragment.boundaryState === "unknown" &&
    !fragment.touchesImageFrame &&
    fragment.verification.sourcePixelLength >= 48 &&
    fragment.verification.insideRegionSupportFraction !== null &&
    fragment.verification.insideRegionSupportFraction >= 0.8 &&
    fragment.verification.outsideRegionExclusionFraction !== null &&
    fragment.verification.outsideRegionExclusionFraction >= 0.8 &&
    fragment.verification.outsideFloorLikeFraction !== null &&
    fragment.verification.outsideFloorLikeFraction <= 0.2
  );
  assert.ok(qualifyingUnknowns.length > 0);
  assert.ok(qualifyingUnknowns.every(fragment => {
    const policy = records.find(record => record.fragmentId === fragment.id);
    return policy?.evidenceClass === "observed_floor_termination" &&
      policy.collisionPolicy === "block";
  }));
  assert.equal(records.length, fragments.length);
  assert.ok(records.every(record =>
    fragments.some(fragment => fragment.id === record.fragmentId)
  ));
});

test("P2-S2C leaves certified A/C/E wall semantics bit-identical", async () => {
  const expectedWallCounts = {
    "room-a": 1,
    "room-c": 13,
    "room-e": 23,
  } as const;
  const fixtures = [
    parsedFixture(roomAValue),
    parsedFixture(roomCValue),
    parsedFixture(roomEValue),
  ];

  for (const fixture of fixtures) {
    const bytes = await certifiedEmptyBytes(fixture);
    const read = await readCertifiedEmptyRegionBoundaryFragments(bytes, fixture);
    if (!read.ok) assert.fail(read.reason);
    const sourceBefore = structuredClone(read.fragments);
    const wallsBefore = structuredClone(read.physicalWallFragments);
    const evaluationBefore = evaluateEmptyRegionBoundaryFragments(read, fixture);
    const records = classifyP2S2CCollisionPolicies(read.fragments);
    const evaluationAfter = evaluateEmptyRegionBoundaryFragments(read, fixture);

    assert.deepEqual(read.fragments, sourceBefore);
    assert.deepEqual(read.physicalWallFragments, wallsBefore);
    assert.equal(
      read.physicalWallFragments.length,
      expectedWallCounts[fixture.roomId as keyof typeof expectedWallCounts]
    );
    assert.deepEqual(evaluationAfter, evaluationBefore);
    assert.equal(evaluationAfter.hardFail, false);
    assert.equal(
      read.fragments.some(fragment =>
        fragment.boundaryState === "physical_wall" &&
        !wallsBefore.some(wall => wall.id === fragment.id)
      ),
      false
    );

    const diagnosticUnknownBlocks = read.fragments.flatMap(fragment => {
      const policy = records.find(record => record.fragmentId === fragment.id);
      return fragment.boundaryState === "unknown" &&
          policy?.collisionPolicy === "block"
        ? [{
            id: shortId(fragment.id),
            evidenceClass: policy.evidenceClass,
            collisionPolicy: policy.collisionPolicy,
          }]
        : [];
    });
    console.log("P2-S2C REGRESSION OVERLAY", JSON.stringify({
      roomId: fixture.roomId,
      sourcePhysicalWallCount: read.physicalWallFragments.length,
      hardFailures: evaluationAfter.hardFailures,
      diagnosticUnknownBlocks,
    }));

    if (fixture.roomId === "room-c") {
      const radiatorContour = read.fragments.filter(fragment =>
        fragment.pointsSourceNormalized.some(point => {
          const sourceX = point.x * fixture.emptyImage.dimensions.width;
          return sourceX > 315 && sourceX < 438;
        })
      );
      assert.ok(radiatorContour.length > 0);
      assert.ok(radiatorContour.every(fragment =>
        fragment.boundaryState !== "physical_wall"
      ));
      console.log("P2-S2C ROOM C RADIATOR REVIEW", JSON.stringify(
        radiatorContour.map(fragment => {
          const policy = records.find(record =>
            record.fragmentId === fragment.id
          );
          return {
            id: shortId(fragment.id),
            sourceBoundaryState: fragment.boundaryState,
            evidenceClass: policy?.evidenceClass,
            collisionPolicy: policy?.collisionPolicy,
          };
        })
      ));
    }
  }
});
