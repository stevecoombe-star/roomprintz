import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAfcSr1BasisBoundSourcePolygon,
  validateAfcSr1BasisBoundSourcePolygon,
} from "./afc-sr1-basis-bound-source-polygon";
import type { AfcSr1SourcePolygon } from "./afc-sr1-semantic-prior";

const fingerprint = "a".repeat(64);
const polygon: AfcSr1SourcePolygon = Object.freeze([
  Object.freeze({ x: 0.1, y: 0.8 }),
  Object.freeze({ x: 0.9, y: 0.9 }),
  Object.freeze({ x: 0.7, y: 0.4 }),
  Object.freeze({ x: 0.3, y: 0.4 }),
]) as AfcSr1SourcePolygon;

function bound() {
  return buildAfcSr1BasisBoundSourcePolygon({
    polygon,
    basis: { fingerprint, decodedWidth: 1000, decodedHeight: 500, orientation: 1 },
    provenance: { kind: "explicit_development_capture", evidenceReference: "synthetic/A" },
  });
}

test("basis-bound source polygon binds exact polygon and basis deterministically", () => {
  const first = bound();
  const second = bound();
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, "afc-sr1-basis-bound-source-polygon/v1");
  assert.equal(first.coordinateSpace, "source-normalized/v1");
  validateAfcSr1BasisBoundSourcePolygon(first);
});

test("basis-bound source polygon evidence fails closed after individual tampering", () => {
  for (const mutate of [
    (value: any) => { value.polygon[0].x = 0.11; },
    (value: any) => { value.polygonFingerprint = "b".repeat(64); },
    (value: any) => { value.basis.fingerprint = "b".repeat(64); },
    (value: any) => { value.provenance.kind = "lab_floor_capture"; },
    (value: any) => { value.evidenceCanonicalJson += " "; },
    (value: any) => { value.evidenceDigest.value = "0".repeat(64); },
  ]) {
    const value = structuredClone(bound()) as any;
    mutate(value);
    assert.throws(() => validateAfcSr1BasisBoundSourcePolygon(value));
  }
});
