import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDurableSourceFloorAuthorityKey,
  planContainerFloorPolygon,
  planSourceNormalizedFloorPolygon,
  type FloorPoint,
} from "./floor-source-authority";

const QUAD: readonly FloorPoint[] = [
  { x: 0.1, y: 0.2 },
  { x: 0.9, y: 0.2 },
  { x: 0.8, y: 0.85 },
  { x: 0.2, y: 0.85 },
];

function assertPlanOk(
  plan: ReturnType<typeof planSourceNormalizedFloorPolygon>
): asserts plan is Extract<ReturnType<typeof planSourceNormalizedFloorPolygon>, { ok: true }> {
  assert.equal(plan.ok, true);
}

test("source-first planning accepts ordered in-frame and bounded off-frame source authority", () => {
  const inFrame = planSourceNormalizedFloorPolygon({ points: QUAD });
  assertPlanOk(inFrame);
  assert.deepEqual(inFrame.sourcePolygon, QUAD, "NL, NR, FR, FL positional order is preserved");
  assert.equal(inFrame.containerPolygon, null);

  const offFrame: readonly FloorPoint[] = [
    { x: -0.05, y: 1.1 },
    { x: 1.25, y: 1.25 },
    { x: 1.1, y: 0.6 },
    { x: -0.25, y: 0.6 },
  ];
  const plan = planSourceNormalizedFloorPolygon({ points: offFrame });
  assertPlanOk(plan);
  assert.deepEqual(plan.sourcePolygon, offFrame, "meaningful off-frame geometry must never clamp");
});

test("source-first planning rejects malformed, non-finite, and out-of-extent authority", () => {
  const wrongCount = planSourceNormalizedFloorPolygon({ points: QUAD.slice(0, 3) });
  assert.deepEqual(wrongCount, { ok: false, reason: "source_corner_count", rejectedCornerIndex: null });

  const nonFinite = planSourceNormalizedFloorPolygon({
    points: [{ x: Number.NaN, y: 0.2 }, ...QUAD.slice(1)],
  });
  assert.deepEqual(nonFinite, { ok: false, reason: "source_x_not_finite", rejectedCornerIndex: 0 });

  const tooWide = planSourceNormalizedFloorPolygon({
    points: [{ x: 1.250001, y: 0.2 }, ...QUAD.slice(1)],
  });
  assert.deepEqual(tooWide, { ok: false, reason: "source_x_above_max", rejectedCornerIndex: 0 });
});

test("source-first planning canonicalizes only unit-boundary machine noise", () => {
  const plan = planSourceNormalizedFloorPolygon({
    points: [
      { x: -7.1e-17, y: 1.0000000000000002 },
      { x: 1.1, y: -0.05 },
      { x: 1.25, y: 0.55 },
      { x: -0.25, y: 0.55 },
    ],
  });
  assertPlanOk(plan);
  assert.deepEqual(plan.sourcePolygon, [
    { x: 0, y: 1 },
    { x: 1.1, y: -0.05 },
    { x: 1.25, y: 0.55 },
    { x: -0.25, y: 0.55 },
  ]);
});

test("source-first planning permits deferred and validates available container projection", () => {
  const deferred = planSourceNormalizedFloorPolygon({ points: QUAD, projectToContainer: () => null });
  assertPlanOk(deferred);
  assert.equal(deferred.containerPolygon, null);

  const projected = planSourceNormalizedFloorPolygon({
    points: QUAD,
    projectToContainer: (source) => source.map((point) => ({ x: point.x * 2, y: point.y * 2 })),
  });
  assertPlanOk(projected);
  assert.deepEqual(projected.containerPolygon, [
    { x: 0.2, y: 0.4 },
    { x: 1.8, y: 0.4 },
    { x: 1.6, y: 1.7 },
    { x: 0.4, y: 1.7 },
  ]);
});

test("container-first and source-first planning converge on source authority and durable identity", () => {
  const source = planSourceNormalizedFloorPolygon({
    points: QUAD,
    projectToContainer: (polygon) => polygon.map((point) => ({ ...point })),
  });
  assertPlanOk(source);
  const container = planContainerFloorPolygon({
    containerPolygon: QUAD,
    projectToSource: (polygon) => polygon.map((point) => ({ ...point })),
  });
  assertPlanOk(container);
  assert.deepEqual(container.sourcePolygon, source.sourcePolygon);
  assert.equal(container.authorityKey, source.authorityKey);

  const failed = planContainerFloorPolygon({
    containerPolygon: QUAD,
    projectToSource: () => null,
  });
  assert.deepEqual(failed, {
    ok: false,
    reason: "source_projection_unavailable",
    rejectedCornerIndex: null,
  });
});

test("durable source identity is full precision, semantic order, and negative-zero safe", () => {
  const same = buildDurableSourceFloorAuthorityKey(QUAD);
  assert.equal(same, buildDurableSourceFloorAuthorityKey(QUAD.map((point) => ({ ...point }))));
  assert.notEqual(
    same,
    buildDurableSourceFloorAuthorityKey([{ x: 0.1000000001, y: 0.2 }, ...QUAD.slice(1)])
  );
  assert.notEqual(
    same,
    buildDurableSourceFloorAuthorityKey([QUAD[1], QUAD[0], QUAD[2], QUAD[3]])
  );
  assert.equal(
    buildDurableSourceFloorAuthorityKey([{ x: -0, y: 0 }, ...QUAD.slice(1)]),
    buildDurableSourceFloorAuthorityKey([{ x: 0, y: -0 }, ...QUAD.slice(1)])
  );
  assert.throws(
    () => buildDurableSourceFloorAuthorityKey([{ x: Number.POSITIVE_INFINITY, y: 0 }, ...QUAD.slice(1)]),
    /finite/
  );
});

test("source-authority module remains dependency-neutral", () => {
  const filename = path.join(path.dirname(fileURLToPath(import.meta.url)), "floor-source-authority.ts");
  const source = readFileSync(filename, "utf8");
  const imports = source.match(/^import .*$/gm) ?? [];
  assert.equal(imports.length, 1);
  for (const forbidden of ["react", "afc", "provider", "gemini", "compositor", "proposal", "receipt", "prepared", "persistence"]) {
    assert.equal(imports.join("\n").toLowerCase().includes(forbidden), false, `must not import ${forbidden}`);
  }
});
