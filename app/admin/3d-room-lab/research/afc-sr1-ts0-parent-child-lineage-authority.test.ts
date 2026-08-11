/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";

import {
  isAfcSr1ValidatedTs0ParentChildLineageAuthority,
  validateAfcSr1GeneratedTs0ParentChildLineage,
  validateAfcSr1Ts0ParentChildLineageEvidence,
} from "./afc-sr1-ts0-parent-child-lineage-authority";
import {
  makeSyntheticGeneratedTs0Lineage,
} from "./afc-sr1-ts0-parent-child-lineage-authority.test-helpers";

test("generated TS0 result and exact bytes issue transient lineage authority", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage();
  assert.ok(isAfcSr1ValidatedTs0ParentChildLineageAuthority(
    fixture.authority
  ));
  assert.ok(Object.isFrozen(fixture.authority));
  assert.ok(Object.isFrozen(fixture.authority.evidence));
  assert.equal(
    fixture.authority.lineageEvidenceDigest,
    fixture.authority.evidence.evidenceDigest.value
  );
  assert.doesNotMatch(
    fixture.authority.evidence.evidenceCanonicalJson,
    /base64|capability/
  );
  validateAfcSr1Ts0ParentChildLineageEvidence(
    structuredClone(fixture.authority.evidence)
  );
  assert.equal(
    isAfcSr1ValidatedTs0ParentChildLineageAuthority(
      structuredClone(fixture.authority)
    ),
    false
  );
});

test("lineage validation binds exact bytes, base64, literals, and compatibility", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage();
  for (const mutate of [
    (value: any) => { value.status = "failure"; },
    (value: any) => { value.input.orientation = 2; },
    (value: any) => { value.tiled.identity.orientation = 2; },
    (value: any) => { value.provenance.generatorId = "other"; },
    (value: any) => { value.provenance.profileId = "other"; },
    (value: any) => { value.provenance.researchPreset = "other"; },
    (value: any) => { value.provenance.requestedModelId = "other"; },
    (value: any) => { value.compatibility.tier = "incompatible"; },
    (value: any) => { value.tiled.base64 = Buffer.from("fake").toString("base64"); },
  ]) {
    const result = structuredClone(fixture.result) as any;
    mutate(result);
    await assert.rejects(() =>
      validateAfcSr1GeneratedTs0ParentChildLineage(
        result,
        fixture.parentBytes,
        fixture.childBytes
      )
    );
  }
  await assert.rejects(() =>
    validateAfcSr1GeneratedTs0ParentChildLineage(
      fixture.result,
      new Uint8Array([1, 2, 3]),
      fixture.childBytes
    )
  );
  await assert.rejects(() =>
    validateAfcSr1GeneratedTs0ParentChildLineage(
      fixture.result,
      fixture.parentBytes,
      new Uint8Array([1, 2, 3])
    )
  );
});

test("serialized lineage evidence is replay integrity, not live authority", async () => {
  const fixture = await makeSyntheticGeneratedTs0Lineage();
  for (const mutate of [
    (value: any) => { value.parent.sha256 = "0".repeat(64); },
    (value: any) => { value.child.byteCount += 1; },
    (value: any) => { value.provenance.runId = "tampered"; },
    (value: any) => { value.compatibility.relativeAspectError = 0.1; },
    (value: any) => { value.evidenceCanonicalJson += " "; },
    (value: any) => { value.evidenceDigest.value = "0".repeat(64); },
  ]) {
    const evidence = structuredClone(fixture.authority.evidence) as any;
    mutate(evidence);
    assert.throws(() =>
      validateAfcSr1Ts0ParentChildLineageEvidence(evidence)
    );
  }
});
