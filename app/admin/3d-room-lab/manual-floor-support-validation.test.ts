import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createEmptyManualFloorSupportAnnotation,
  DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX,
  type ManualFloorSupportAnnotation,
  type ManualPhysicalSeam,
} from "./manual-floor-support-types";
import { validateManualFloorSupportAnnotation } from "./manual-floor-support-validation";

// --- Helpers ----------------------------------------------------------------

function seam(overrides: Partial<ManualPhysicalSeam> = {}): ManualPhysicalSeam {
  return {
    id: "seam-1",
    kind: "physical_floor_wall_seam",
    points: [
      { x: 0.2, y: 0.6 },
      { x: 0.8, y: 0.6 },
    ],
    usableSpan: { startVertexIndex: 0, endVertexIndex: 1 },
    corridor: { halfWidthSourcePx: 6 },
    ...overrides,
  };
}

function annotationWithSeam(overrides: Partial<ManualFloorSupportAnnotation> = {}): ManualFloorSupportAnnotation {
  return {
    ...createEmptyManualFloorSupportAnnotation(),
    seams: [seam()],
    ...overrides,
  };
}

// --- Tests ------------------------------------------------------------------

test("1. valid two-point seam passes", () => {
  const result = validateManualFloorSupportAnnotation(annotationWithSeam());
  assert.equal(result.ok, true, result.errors.join(" | "));
  assert.deepEqual(result.errors, []);
});

test("2a. NaN point fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      seams: [seam({ points: [{ x: Number.NaN, y: 0.6 }, { x: 0.8, y: 0.6 }] })],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /finite x and y/i.test(error)));
});

test("2b. out-of-bounds point fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      seams: [seam({ points: [{ x: 1.5, y: 0.6 }, { x: 0.8, y: 0.6 }] })],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /source-normalized bounds/i.test(error)));
});

test("3. zero-length segment fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      seams: [seam({ points: [{ x: 0.4, y: 0.6 }, { x: 0.4, y: 0.6 }] })],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /zero-length segment/i.test(error)));
});

test("4. invalid usable span fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      seams: [seam({ usableSpan: { startVertexIndex: 1, endVertexIndex: 0 } })],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /startVertexIndex must be < endVertexIndex/i.test(error)));
});

test("4b. out-of-range usable span fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      seams: [seam({ usableSpan: { startVertexIndex: 0, endVertexIndex: 9 } })],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /out of range/i.test(error)));
});

test("5. non-positive corridor fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      seams: [seam({ corridor: { halfWidthSourcePx: 0 } })],
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /halfWidthSourcePx must be a positive/i.test(error)));
});

test("6. direct mode with authority fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      mode: "direct",
      adjustmentAuthority: {
        kind: "single_corner",
        corner: "FL",
        seamId: "seam-1",
        allowedSpan: { startT: 0, endT: 1 },
      },
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /Mode "direct" must use authority kind "none"/i.test(error)));
});

test("7. abstain mode with authority fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      mode: "abstain",
      adjustmentAuthority: {
        kind: "coupled_far_edge",
        corners: ["FL", "FR"],
        seamId: "seam-1",
        flAllowedSpan: { startT: 0, endT: 1 },
        frAllowedSpan: { startT: 0, endT: 1 },
        coupling: {
          preserveOrder: true,
          preserveEdgeDirection: true,
          maxRelativeAlongSeamDeltaSourcePx: DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX,
        },
      },
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /Mode "abstain" must use authority kind "none"/i.test(error)));
});

test("8. valid single-corner authority passes", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      mode: "single_corner_constrained",
      adjustmentAuthority: {
        kind: "single_corner",
        corner: "FR",
        seamId: "seam-1",
        allowedSpan: { startT: 0, endT: 1 },
      },
    })
  );
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("9. invalid single-corner seam reference fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      mode: "single_corner_constrained",
      adjustmentAuthority: {
        kind: "single_corner",
        corner: "FR",
        seamId: "does-not-exist",
        allowedSpan: { startT: 0, endT: 1 },
      },
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /does not reference an existing seam/i.test(error)));
});

test("10. coupled mode with anything other than FL + FR fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      mode: "coupled_far_edge_constrained",
      adjustmentAuthority: {
        kind: "coupled_far_edge",
        // Intentionally invalid pair; bypass the structural type restriction.
        corners: ["NL", "NR"] as unknown as ["FL", "FR"],
        seamId: "seam-1",
        flAllowedSpan: { startT: 0, endT: 1 },
        frAllowedSpan: { startT: 0, endT: 1 },
        coupling: {
          preserveOrder: true,
          preserveEdgeDirection: true,
          maxRelativeAlongSeamDeltaSourcePx: DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX,
        },
      },
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /corners must be exactly \["FL", "FR"\]/i.test(error)));
});

test("11. valid coupled far-edge authority passes", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      mode: "coupled_far_edge_constrained",
      adjustmentAuthority: {
        kind: "coupled_far_edge",
        corners: ["FL", "FR"],
        seamId: "seam-1",
        flAllowedSpan: { startT: 0, endT: 1 },
        frAllowedSpan: { startT: 0, endT: 1 },
        coupling: {
          preserveOrder: true,
          preserveEdgeDirection: true,
          maxRelativeAlongSeamDeltaSourcePx: DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX,
        },
      },
    })
  );
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("12. determining edge with unknown seam fails", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      determiningEdge: {
        seamId: "unknown-seam",
        role: "rear_floor_wall_edge",
        intendedCanonicalSupport: ["FL", "FR"],
      },
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /determiningEdge\.seamId .* does not reference/i.test(error)));
});

test("12b. valid rear-edge determining edge passes", () => {
  const result = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      determiningEdge: {
        seamId: "seam-1",
        role: "rear_floor_wall_edge",
        intendedCanonicalSupport: ["FL", "FR"],
      },
    })
  );
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("13. corner support state + label + linked seam are validated", () => {
  const valid = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      cornerSupport: {
        FL: { state: "trustworthy", linkedSeamId: "seam-1" },
        NR: { state: "frame_truncated" },
      },
    })
  );
  assert.equal(valid.ok, true, valid.errors.join(" | "));

  const badState = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      cornerSupport: {
        FL: { state: "made_up" as unknown as "trustworthy" },
      },
    })
  );
  assert.equal(badState.ok, false);
  assert.ok(badState.errors.some((error) => /invalid state/i.test(error)));

  const badLink = validateManualFloorSupportAnnotation(
    annotationWithSeam({
      cornerSupport: {
        FL: { state: "occluded", linkedSeamId: "ghost" },
      },
    })
  );
  assert.equal(badLink.ok, false);
  assert.ok(badLink.errors.some((error) => /does not reference an existing seam/i.test(error)));
});

test("14. an empty annotation (no seams) is structurally valid", () => {
  const result = validateManualFloorSupportAnnotation(createEmptyManualFloorSupportAnnotation());
  assert.equal(result.ok, true, result.errors.join(" | "));
});

test("15. validation has no dependency on solver/candidate modules (import allow-list)", () => {
  const labDir = join(process.cwd(), "app", "admin", "3d-room-lab");
  const sources = ["manual-floor-support-validation.ts", "manual-floor-support-types.ts"].map((fileName) =>
    readFileSync(join(labDir, fileName), "utf8")
  );
  const allowedSpecifiers = new Set(["./manual-floor-support-types"]);
  for (const source of sources) {
    const importRegex = /import[\s\S]*?from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const specifier = match[1];
      assert.ok(specifier.startsWith("./"), `unexpected non-local import: ${specifier}`);
      assert.ok(!specifier.includes(".."), `import escapes the lab directory: ${specifier}`);
      assert.ok(allowedSpecifiers.has(specifier), `disallowed import specifier: ${specifier}`);
    }
    // Guard against accidental IMPORTS of solver/FOV/Apply/candidate modules.
    // (Scoped to import specifiers so legitimate prose in header comments that
    // names these forbidden dependencies does not trip the guard.)
    for (const forbidden of [
      "quad-solvability",
      "perspective-solve",
      "calibrated-camera-apply",
      "auto-floor-scoring",
      "auto-floor-detection",
    ]) {
      assert.ok(
        !new RegExp(`from\\s+["'][^"']*${forbidden}[^"']*["']`).test(source),
        `validation/types must not import ${forbidden}`
      );
    }
  }
});
