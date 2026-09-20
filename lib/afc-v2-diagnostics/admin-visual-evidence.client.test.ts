import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS,
  AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY,
  afcDiagnosticVisualArtifactLabel,
  afcDiagnosticVisualEvidenceErrorMessage,
  afcDiagnosticVisualEvidenceTupleKey,
  afcDiagnosticVisualImageAlt,
  buildAfcDiagnosticVisualArtifactUrl,
  createAfcDiagnosticVisualEvidenceCoordinator,
  defaultAfcDiagnosticVisualArtifactKind,
  isAfcDiagnosticVisualAbortError,
  isAfcDiagnosticVisualArtifactKind,
  isSameAfcDiagnosticVisualEvidenceTuple,
  parseAfcDiagnosticVisualArtifactKind,
  resolveAfcDiagnosticVisualArtifactKind,
  revokeAfcDiagnosticVisualObjectUrl,
} from "./admin-visual-evidence.client";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";

test("kind enum and URL builder stay generation+case scoped", () => {
  assert.deepEqual([...AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS], [
    "original",
    "empty",
    "tiled",
  ]);
  assert.equal(isAfcDiagnosticVisualArtifactKind("empty"), true);
  assert.equal(parseAfcDiagnosticVisualArtifactKind("overlay"), null);
  assert.equal(
    buildAfcDiagnosticVisualArtifactUrl({
      caseId: CASE_1,
      generationId: GEN_1,
      kind: "empty",
    }),
    `/api/admin/afc-diagnostics/cases/${CASE_1}/generations/${GEN_1}/artifacts/empty`,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceTupleKey({
      caseId: CASE_1,
      generationId: GEN_1,
      kind: "tiled",
    }),
    `${CASE_1}:${GEN_1}:tiled`,
  );
  assert.equal(
    isSameAfcDiagnosticVisualEvidenceTuple(
      { caseId: CASE_1, generationId: GEN_1, kind: "empty" },
      { caseId: CASE_1, generationId: GEN_1, kind: "empty" },
    ),
    true,
  );
  assert.equal(
    isSameAfcDiagnosticVisualEvidenceTuple(
      { caseId: CASE_1, generationId: GEN_1, kind: "empty" },
      { caseId: CASE_1, generationId: GEN_2, kind: "empty" },
    ),
    false,
  );
});

test("default tab prefers Empty then Tiled then Original", () => {
  assert.equal(
    defaultAfcDiagnosticVisualArtifactKind({
      emptyPresent: true,
      tiledPresent: true,
    }),
    "empty",
  );
  assert.equal(
    defaultAfcDiagnosticVisualArtifactKind({
      emptyPresent: false,
      tiledPresent: true,
    }),
    "tiled",
  );
  assert.equal(
    defaultAfcDiagnosticVisualArtifactKind({
      emptyPresent: false,
      tiledPresent: false,
    }),
    "original",
  );
});

test("attempt changes preserve the current tab even when it is absent", () => {
  assert.equal(
    resolveAfcDiagnosticVisualArtifactKind({
      caseChanged: false,
      currentKind: "tiled",
      emptyPresent: true,
      tiledPresent: false,
    }),
    "tiled",
  );
  assert.equal(
    resolveAfcDiagnosticVisualArtifactKind({
      caseChanged: true,
      currentKind: "tiled",
      emptyPresent: true,
      tiledPresent: false,
    }),
    "empty",
  );
  assert.equal(
    resolveAfcDiagnosticVisualArtifactKind({
      caseChanged: false,
      currentKind: null,
      emptyPresent: false,
      tiledPresent: false,
    }),
    "original",
  );
});

test("error mapping covers 404/409/auth/network without leaking storage", () => {
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 404,
      kind: "original",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.originalUnavailable,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 404,
      kind: "empty",
      metadataPresent: false,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.notPresentMessage,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 404,
      kind: "tiled",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.bytesUnavailable,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 409,
      kind: "empty",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.integrity,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 401,
      kind: "empty",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.error401,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 403,
      kind: "empty",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.error403,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: "network",
      kind: "empty",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic,
  );
  assert.equal(
    afcDiagnosticVisualEvidenceErrorMessage({
      status: 500,
      kind: "empty",
      metadataPresent: true,
    }),
    AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY.generic,
  );
  assert.equal(afcDiagnosticVisualArtifactLabel("empty"), "Empty");
  assert.equal(
    afcDiagnosticVisualImageAlt({ kind: "empty", attemptOrdinal: 2 }),
    "Empty evidence for Attempt #2",
  );
  assert.doesNotMatch(
    JSON.stringify(AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY),
    /storage_path|signedUrl|production_authority/,
  );
});

test("coordinator aborts stale tuples and retry stays on the bound artifact", () => {
  const coordinator = createAfcDiagnosticVisualEvidenceCoordinator();
  const first = coordinator.begin({
    caseId: CASE_1,
    generationId: GEN_1,
    kind: "empty",
  });
  const second = coordinator.begin({
    caseId: CASE_1,
    generationId: GEN_2,
    kind: "empty",
  });
  assert.equal(coordinator.isCurrent(first.seq, first.tuple), false);
  assert.equal(coordinator.isCurrent(second.seq, second.tuple), true);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);

  const retry = coordinator.retry();
  assert.equal(retry.started, true);
  if (!retry.started) throw new Error("retry should start");
  assert.equal(retry.tuple.generationId, GEN_2);
  assert.equal(retry.tuple.kind, "empty");
  assert.equal(second.signal.aborted, true);
  assert.equal(coordinator.isCurrent(second.seq, second.tuple), false);
  assert.equal(coordinator.isCurrent(retry.seq, retry.tuple), true);
});

test("AbortError is recognized and object URLs are revoked", () => {
  assert.equal(
    isAfcDiagnosticVisualAbortError({ name: "AbortError" }),
    true,
  );
  assert.equal(isAfcDiagnosticVisualAbortError(new Error("nope")), false);

  const revoked: string[] = [];
  const original = globalThis.URL.revokeObjectURL;
  globalThis.URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  try {
    revokeAfcDiagnosticVisualObjectUrl("blob:http://localhost/abc");
    revokeAfcDiagnosticVisualObjectUrl("https://example.com/nope");
    revokeAfcDiagnosticVisualObjectUrl(null);
  } finally {
    globalThis.URL.revokeObjectURL = original;
  }
  assert.deepEqual(revoked, ["blob:http://localhost/abc"]);
});
