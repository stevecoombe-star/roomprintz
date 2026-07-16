// --- Phase B1: Type B qualification + facts unit tests ----------------------
// Pure unit tests (node:test) for the READ-ONLY Type B evidence schema, the
// geometry-fact helper, and the deterministic qualification classifier. No
// solver / FOV / calibration / UI / persistence is exercised.

import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveTypeBGeometryFacts,
  TYPE_B_SHARED_JUNCTION_TOLERANCE_RATIO,
} from "./type-b-evidence-facts";
import type {
  TypeBDeclaredLineEvidence,
  TypeBQualificationInput,
  TypeBSourceFrame,
} from "./type-b-evidence-types";
import { qualifyTypeBEvidence } from "./type-b-qualification";

// Square 1000x1000 frame => source-pixel arc length = 1000 * source-norm
// distance, so spans below are exact and predictable.
const FRAME: TypeBSourceFrame = { width: 1000, height: 1000 };

function line(
  overrides: Partial<TypeBDeclaredLineEvidence>
): TypeBDeclaredLineEvidence {
  return {
    role: "rear_floor_wall_seam",
    startNorm: { x: 0, y: 0 },
    endNorm: { x: 0, y: 0 },
    startEndpointStatus: "visible",
    endEndpointStatus: "visible",
    startFrameContact: "no_frame_contact",
    endFrameContact: "no_frame_contact",
    occlusionStatus: "none_observed",
    operatorDeclared: true,
    ...overrides,
  };
}

// Healthy rear floor/wall seam (~400 px horizontal), interior endpoints.
function rearHealthy(): TypeBDeclaredLineEvidence {
  return line({
    role: "rear_floor_wall_seam",
    startNorm: { x: 0.2, y: 0.8 },
    endNorm: { x: 0.6, y: 0.8 },
  });
}

// Healthy strong side seam (~400 px vertical) sharing a junction with the rear
// seam at (0.2, 0.8).
function sideHealthy(): TypeBDeclaredLineEvidence {
  return line({
    role: "side_floor_boundary",
    startNorm: { x: 0.2, y: 0.8 },
    endNorm: { x: 0.2, y: 0.4 },
  });
}

function baseInput(
  overrides: Partial<TypeBQualificationInput> = {}
): TypeBQualificationInput {
  const merged: TypeBQualificationInput = {
    family: "rear_seam_plus_strong_side_seam",
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
    latentNearCornerCondition: "not_needed_visible",
    typeAContext: "type_a_exhausted_handoff_candidate",
    geometryFacts: null,
    ...overrides,
  };
  // Derive facts from the (possibly overridden) frame/seams unless the caller
  // explicitly supplied geometryFacts.
  if (!Object.prototype.hasOwnProperty.call(overrides, "geometryFacts")) {
    merged.geometryFacts = deriveTypeBGeometryFacts({
      sourceFrame: merged.sourceFrame,
      rearSeam: merged.rearSeam,
      strongSideSeam: merged.strongSideSeam,
    });
  }
  return merged;
}

// --- 1. Missing source frame -------------------------------------------------

test("1: missing source frame => not_assessed", () => {
  const out = qualifyTypeBEvidence(baseInput({ sourceFrame: null }));
  assert.equal(out.status, "not_assessed");
  assert.ok(out.reasons.includes("missing_source_frame"));
  assert.ok(out.blockingReasons.includes("missing_source_frame"));
});

// --- 2. Invalid source frame -------------------------------------------------

test("2: invalid source frame => type_b_evidence_insufficient (no throw)", () => {
  const out = qualifyTypeBEvidence(baseInput({ sourceFrame: { width: 0, height: 0 } }));
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("invalid_source_frame"));
});

// --- 3. Missing rear seam ----------------------------------------------------

test("3: missing rear seam => not_assessed", () => {
  const out = qualifyTypeBEvidence(baseInput({ rearSeam: null }));
  assert.equal(out.status, "not_assessed");
  assert.ok(out.reasons.includes("missing_rear_seam"));
});

// --- 4. Missing strong side seam ---------------------------------------------

test("4: missing strong side seam => not_assessed", () => {
  const out = qualifyTypeBEvidence(baseInput({ strongSideSeam: null }));
  assert.equal(out.status, "not_assessed");
  assert.ok(out.reasons.includes("missing_strong_side_seam"));
});

test("4b: missing geometry facts => not_assessed", () => {
  const out = qualifyTypeBEvidence(baseInput({ geometryFacts: null }));
  assert.equal(out.status, "not_assessed");
});

// --- 5. Rear seam unresolved role -------------------------------------------

test("5: rear seam unresolved role => type_b_evidence_incompatible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ rearSeam: line({ role: "unresolved", startNorm: { x: 0.2, y: 0.8 }, endNorm: { x: 0.6, y: 0.8 } }) })
  );
  assert.equal(out.status, "type_b_evidence_incompatible");
  assert.ok(out.reasons.includes("rear_seam_role_unresolved"));
});

// --- 6. Strong side seam unresolved role ------------------------------------

test("6: side seam unresolved role => type_b_evidence_incompatible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ strongSideSeam: line({ role: "unresolved", startNorm: { x: 0.2, y: 0.8 }, endNorm: { x: 0.2, y: 0.4 } }) })
  );
  assert.equal(out.status, "type_b_evidence_incompatible");
  assert.ok(out.reasons.includes("side_seam_role_unresolved"));
});

// --- 7. Non-finite declared geometry ----------------------------------------

test("7: non-finite declared geometry => type_b_evidence_insufficient", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      rearSeam: line({
        role: "rear_floor_wall_seam",
        startNorm: { x: Number.NaN, y: 0.8 },
        endNorm: { x: 0.6, y: 0.8 },
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("rear_seam_geometry_invalid"));
});

// --- 8. Rear seam below support threshold -----------------------------------

test("8: rear seam below span threshold => insufficient", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      rearSeam: line({
        role: "rear_floor_wall_seam",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.25, y: 0.8 },
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("rear_seam_support_insufficient"));
});

// --- 9. Side seam below support threshold -----------------------------------

test("9: side seam below span threshold => insufficient", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.85 },
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("side_seam_support_insufficient"));
});

// --- 10. Material occlusion on rear seam ------------------------------------

test("10: material occlusion on rear seam => insufficient (blocking)", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      rearSeam: line({
        role: "rear_floor_wall_seam",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.6, y: 0.8 },
        occlusionStatus: "material_obstruction",
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("material_occlusion_on_required_support"));
  assert.ok(out.blockingReasons.includes("material_occlusion_on_required_support"));
});

// --- 11. Material occlusion on side seam ------------------------------------

test("11: material occlusion on side seam => insufficient (blocking)", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.4 },
        occlusionStatus: "material_obstruction",
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("material_occlusion_on_required_support"));
});

// --- 12. Frame-truncated side endpoint with adequate visible support --------

test("12: frame-truncated side endpoint stays usable when visible span is adequate", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.4 },
        endEndpointStatus: "frame_truncated",
        endFrameContact: "contacts_frame",
      }),
      latentNearCornerCondition: "frame_truncated",
    })
  );
  assert.equal(out.evidenceSummary.strongSideSeamUsable, true);
  assert.equal(out.status, "type_b_diagnostic_eligible");
});

// --- 13. Near-frame endpoint remains advisory and does not block ------------

test("13: near-frame endpoint is advisory only and does not block eligibility", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.4 },
        endEndpointStatus: "near_frame",
      }),
    })
  );
  assert.equal(out.status, "type_b_diagnostic_eligible");
  assert.equal(out.blockingReasons.length, 0);
});

// --- 14. Rear-side near-collinear / degenerate ------------------------------

test("14: near-collinear rear/side geometry => incompatible (degenerate)", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.6, y: 0.81 },
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_incompatible");
  assert.ok(out.reasons.includes("rear_side_geometry_degenerate"));
});

// --- 15. Shared junction absent (unresolved) --------------------------------

test("15: shared junction absent (uncertain endpoint) => candidate, never eligible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.8, y: 0.4 },
        endNorm: { x: 0.8, y: 0.1 },
        startEndpointStatus: "frame_truncated",
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_candidate");
  assert.ok(out.reasons.includes("rear_side_junction_unresolved"));
  assert.notEqual(out.status, "type_b_diagnostic_eligible");
});

// --- 16. Shared junction incompatible / outside tolerance -------------------

test("16: shared junction outside tolerance with certain endpoints => incompatible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.8, y: 0.4 },
        endNorm: { x: 0.8, y: 0.1 },
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_incompatible");
  assert.ok(out.reasons.includes("rear_side_junction_incompatible"));
});

// --- 17. Latent near-corner condition unresolved ----------------------------

test("17: latent near-corner unresolved => insufficient (blocking)", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ latentNearCornerCondition: "unresolved" })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("latent_near_corner_unresolved"));
  assert.equal(out.evidenceSummary.latentNearCornerBounded, false);
});

// --- 18. Ambiguous required frame contact -----------------------------------

test("18: ambiguous frame contact on truncated required endpoint => insufficient", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.4 },
        endEndpointStatus: "frame_truncated",
        endFrameContact: "frame_contact_ambiguous",
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.ok(out.reasons.includes("crop_or_frame_contact_ambiguous"));
  assert.equal(out.evidenceSummary.cropInterpretationUsable, false);
});

// --- 19. Type A strong support always remains Type A investigation preferred --

test("19: type_a_strong_support => type_a_investigation_preferred", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ typeAContext: "type_a_strong_support" })
  );
  assert.equal(out.status, "type_a_investigation_preferred");
  assert.ok(out.reasons.includes("type_a_investigation_preferred"));
  assert.ok(out.reasons.includes("type_a_support_still_investigable"));
});

// --- 20. Type A weak support remains Type A investigation preferred ----------

test("20: type_a_weak_support => type_a_investigation_preferred", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ typeAContext: "type_a_weak_support" })
  );
  assert.equal(out.status, "type_a_investigation_preferred");
});

// --- 21. Type A investigation case remains Type A investigation preferred ----

test("21: type_a_investigation_case => type_a_investigation_preferred", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ typeAContext: "type_a_investigation_case" })
  );
  assert.equal(out.status, "type_a_investigation_preferred");
});

// --- 22. Type A exhausted but insufficient Type B support -------------------

test("22: type_a exhausted + insufficient support => insufficient, never eligible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      typeAContext: "type_a_exhausted_handoff_candidate",
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.85 },
      }),
    })
  );
  assert.equal(out.status, "type_b_evidence_insufficient");
  assert.notEqual(out.status, "type_b_diagnostic_eligible");
});

// --- 23. Type A exhausted + full valid evidence => diagnostic eligible -------

test("23: type_a exhausted + valid evidence + shared junction => diagnostic eligible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ typeAContext: "type_a_exhausted_handoff_candidate" })
  );
  assert.equal(out.status, "type_b_diagnostic_eligible");
  assert.ok(out.reasons.includes("type_b_evidence_family_eligible"));
  assert.equal(out.blockingReasons.length, 0);
  assert.equal(out.evidenceSummary.rearSeamUsable, true);
  assert.equal(out.evidenceSummary.strongSideSeamUsable, true);
  assert.equal(out.evidenceSummary.rearSideRelationshipUsable, true);
});

// --- 24. Type A unknown with otherwise valid evidence => candidate only ------

test("24: type_a not run/unknown + valid evidence => candidate, never eligible", () => {
  const out = qualifyTypeBEvidence(
    baseInput({ typeAContext: "type_a_not_run_or_unknown" })
  );
  assert.equal(out.status, "type_b_evidence_candidate");
  assert.ok(out.reasons.includes("type_a_exhaustion_not_established"));
  assert.notEqual(out.status, "type_b_diagnostic_eligible");
});

// --- 25. Determinism ---------------------------------------------------------

test("25: identical input gives deeply equal output", () => {
  const input = baseInput({ typeAContext: "type_a_exhausted_handoff_candidate" });
  const a = qualifyTypeBEvidence(input);
  const b = qualifyTypeBEvidence(input);
  assert.deepEqual(a, b);
});

// --- 26. No mutation ---------------------------------------------------------

test("26: input objects are not mutated by helper or classifier", () => {
  const input = baseInput({ typeAContext: "type_a_exhausted_handoff_candidate" });
  const snapshot = structuredClone(input);
  deriveTypeBGeometryFacts({
    sourceFrame: input.sourceFrame,
    rearSeam: input.rearSeam,
    strongSideSeam: input.strongSideSeam,
  });
  qualifyTypeBEvidence(input);
  assert.deepEqual(input, snapshot);
});

// --- 27. Reason ordering / dedup --------------------------------------------

test("27: reasons are deduplicated and stably ordered", () => {
  const out = qualifyTypeBEvidence(
    baseInput({
      strongSideSeam: line({
        role: "side_floor_boundary",
        startNorm: { x: 0.2, y: 0.8 },
        endNorm: { x: 0.2, y: 0.85 },
      }),
    })
  );
  const unique = new Set(out.reasons);
  assert.equal(unique.size, out.reasons.length);
  // blocking/advisory are subsets of reasons.
  for (const r of out.blockingReasons) assert.ok(out.reasons.includes(r));
  for (const r of out.advisoryReasons) assert.ok(out.reasons.includes(r));
});

// --- Facts-helper focused tests ---------------------------------------------

test("facts: source-pixel span calculations", () => {
  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  assert.ok(Math.abs((facts.rearSpanSourcePx ?? 0) - 400) < 1e-6);
  assert.ok(Math.abs((facts.sideSpanSourcePx ?? 0) - 400) < 1e-6);
  assert.ok(Math.abs((facts.rearToSideSpanRatio ?? 0) - 1) < 1e-6);
});

test("facts: source-frame edge distance calculations", () => {
  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  // rear.start (0.2, 0.8) -> px (200, 800) -> min(200, 800, 800, 200) = 200.
  assert.ok(Math.abs((facts.rearStartDistanceToFramePx ?? 0) - 200) < 1e-6);
  // rear.end (0.6, 0.8) -> px (600, 800) -> min(600, 400, 800, 200) = 200.
  assert.ok(Math.abs((facts.rearEndDistanceToFramePx ?? 0) - 200) < 1e-6);
});

test("facts: angle calculation (perpendicular => 90deg)", () => {
  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  assert.ok(Math.abs((facts.rearSideAngleDeg ?? 0) - 90) < 1e-6);
  assert.equal(facts.rearAndSideNonDegenerate, true);
});

test("facts: shared junction detected only from endpoint proximity", () => {
  const touching = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  assert.equal(touching.sharedJunctionPresent, true);
  assert.ok(Math.abs((touching.sharedJunctionDistanceSourcePx ?? 1) - 0) < 1e-6);

  // Non-touching lines: distance is the closest DECLARED endpoint distance, and
  // NO junction is invented via line extension/intersection.
  const apart = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: line({
      role: "side_floor_boundary",
      startNorm: { x: 0.8, y: 0.4 },
      endNorm: { x: 0.8, y: 0.1 },
    }),
  });
  assert.equal(apart.sharedJunctionPresent, false);
  // rear.end (0.6,0.8) vs side.start (0.8,0.4) => sqrt(200^2 + 400^2) ~= 447.2.
  assert.ok(Math.abs((apart.sharedJunctionDistanceSourcePx ?? 0) - Math.hypot(200, 400)) < 1e-6);
});

test("facts: null-safe behavior for missing/invalid inputs", () => {
  const nullFrame = deriveTypeBGeometryFacts({
    sourceFrame: null,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  assert.equal(nullFrame.validSourceFrame, false);
  assert.equal(nullFrame.rearSpanSourcePx, null);
  assert.equal(nullFrame.finiteDeclaredGeometry, false);

  const nullSeam = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: null,
    strongSideSeam: sideHealthy(),
  });
  assert.equal(nullSeam.validSourceFrame, true);
  assert.equal(nullSeam.finiteDeclaredGeometry, false);
  assert.equal(nullSeam.rearSpanSourcePx, null);
  assert.ok((nullSeam.sideSpanSourcePx ?? 0) > 0);
  assert.equal(nullSeam.sharedJunctionDistanceSourcePx, null);
});

test("facts: shared-junction tolerance constant is conservative", () => {
  assert.ok(TYPE_B_SHARED_JUNCTION_TOLERANCE_RATIO > 0);
  assert.ok(TYPE_B_SHARED_JUNCTION_TOLERANCE_RATIO <= 0.05);
});
