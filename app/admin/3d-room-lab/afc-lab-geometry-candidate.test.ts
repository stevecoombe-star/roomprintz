import assert from "node:assert/strict";
import test from "node:test";
import controlFixture from "./research/fixtures/afc-sr1-room-c-lab-apply-control.v1.json";
import {
  AFC_LAB_GEOMETRY_SEMANTIC_ORDER,
  buildAfcLabGeometryCandidate,
  ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE,
} from "./afc-lab-geometry-candidate";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("Room C Lab control parses as RAW-direct geometry with a diagnostic-only C-P04 sidecar", () => {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) return;
  const candidate = ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
  assert.deepEqual(candidate.semanticOrder, AFC_LAB_GEOMETRY_SEMANTIC_ORDER);
  assert.equal(candidate.source, "raw-direct-path-a");
  assert.equal(candidate.seamT, 0.7037731582393056);
  assert.equal(candidate.baselineSeamT, 0.7037731582393056);
  assert.equal(candidate.referenceDepthM, 4);
  assert.equal(candidate.acceptanceBasis.decodedWidth, 7360);
  assert.equal(candidate.acceptanceBasis.decodedHeight, 4912);
  assert.equal(candidate.acceptanceBasis.transferKind, "paired_cross_role_aspect_rescaled");
  assert.equal(candidate.geometryProvenance.emptyDecodedWidth, 1264);
  assert.equal(candidate.geometryProvenance.emptyDecodedHeight, 848);
  assert.deepEqual(candidate.diagnostics, {
    caseId: "C-P04",
    placementStatus: "rejected",
    placementReason: "validation_residual_exceeds_limit",
    validationP90Px: 10.215452234217725,
    geometryAuthority: "none",
    provenance: candidate.diagnostics.provenance,
  });
});

test("Room C seam adjustment moves only NR along the frozen near-to-far seam", () => {
  assert.equal(ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok, true);
  if (!ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.ok) return;
  const { rawSourceNormalizedPolygon: raw, sourceNormalizedPolygon: adjusted, seamT } =
    ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE.candidate;
  assert.deepEqual(adjusted[0], raw[0]);
  assert.deepEqual(adjusted[2], raw[2]);
  assert.deepEqual(adjusted[3], raw[3]);
  assert.deepEqual(adjusted[1], {
    x: raw[1].x + seamT * (raw[2].x - raw[1].x),
    y: raw[1].y + seamT * (raw[2].y - raw[1].y),
  });
});

test("invalid seam is rejected", () => {
  const fixture = clone(controlFixture);
  fixture.geometryControl.seam.seamT = -0.1;
  assert.deepEqual(buildAfcLabGeometryCandidate(fixture), {
    ok: false,
    reason: "seam_invalid",
  });
});

test("Room C original acceptance requires the established Empty-to-Original pair identity", () => {
  const fixture = clone(controlFixture);
  fixture.geometryControl.emptyBasisBoundPolygon.generatedFromOriginalSha256 = "wrong";
  assert.deepEqual(buildAfcLabGeometryCandidate(fixture), {
    ok: false,
    reason: "acceptance_basis_invalid",
  });
});

test("Room C original acceptance rejects a different Original fingerprint even when dimensions and pair linkage match", () => {
  const fixture = clone(controlFixture);
  fixture.acceptanceImage.basisFingerprint = "other-original";
  fixture.geometryControl.emptyBasisBoundPolygon.generatedFromOriginalSha256 = "other-original";
  assert.deepEqual(buildAfcLabGeometryCandidate(fixture), {
    ok: false,
    reason: "acceptance_basis_invalid",
  });
});

test("Room C original acceptance rejects an aspect-incompatible Empty basis", () => {
  const fixture = clone(controlFixture);
  fixture.geometryControl.emptyBasisBoundPolygon.decodedWidth = 1000;
  assert.deepEqual(buildAfcLabGeometryCandidate(fixture), {
    ok: false,
    reason: "acceptance_basis_invalid",
  });
});

test("Room C original acceptance rejects a malformed original/empty role relationship", () => {
  const fixture = clone(controlFixture);
  fixture.acceptanceImage.role = "empty";
  assert.deepEqual(buildAfcLabGeometryCandidate(fixture), {
    ok: false,
    reason: "acceptance_basis_invalid",
  });
});

test("C-P04 P90 is sidecar-only and cannot alter Room C geometry", () => {
  const changedDiagnostics = clone(controlFixture);
  changedDiagnostics.diagnosticControls["C-P04"].validationP90Px = 0.01;
  const baseline = buildAfcLabGeometryCandidate(controlFixture);
  const changed = buildAfcLabGeometryCandidate(changedDiagnostics);
  assert.equal(baseline.ok, true);
  assert.equal(changed.ok, true);
  if (!baseline.ok || !changed.ok) return;
  assert.deepEqual(changed.candidate.sourceNormalizedPolygon, baseline.candidate.sourceNormalizedPolygon);
  assert.equal(changed.candidate.seamT, baseline.candidate.seamT);
  assert.equal(changed.candidate.diagnostics.validationP90Px, 0.01);
  assert.equal(changed.candidate.diagnostics.geometryAuthority, "none");
});
