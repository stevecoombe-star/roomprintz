import {
  FLOOR_CORNER_LABELS,
  type FloorCornerLabel,
  type ManualAdjustmentAuthority,
  type ManualCornerSupportState,
  type ManualDeterminingEdge,
  type ManualFloorSupportAnnotation,
  type ManualPhysicalSeam,
  type ManualSearchMode,
} from "./manual-floor-support-types";

// --- Phase 2O-B1: Pure manual-annotation validation -------------------------
// Validates ONLY annotation integrity. It is deterministic and side-effect
// free, and imports ONLY the pure types module.
//
// HARD GUARANTEES (Phase 2O-B1 scope):
// - No React/DOM/fetch/image IO/server imports, no setters, no mutation.
// - Does NOT import solver modules, camera pose, homography, reprojection
//   residuals, FOV scan modules, Apply logic, evaluateQuadSolvability(...), or
//   candidate ranking/defaulting/scoring modules.
// - Never derives or claims physical seam truth from guide geometry, never
//   moves a corner, never enables a geometry search, never generates a trial.
//
// Errors BLOCK a valid annotation. Warnings are advisory evidence-quality notes
// that must NOT block an otherwise-valid annotation merely because a seam is
// short, near a frame edge, or visually distant from a current candidate corner.

export type ManualFloorSupportValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const VALID_CORNER_SUPPORT_STATES: ReadonlySet<ManualCornerSupportState> = new Set<ManualCornerSupportState>([
  "trustworthy",
  "frame_truncated",
  "occluded",
  "uncertain",
]);

const VALID_SEARCH_MODES: ReadonlySet<ManualSearchMode> = new Set<ManualSearchMode>([
  "direct",
  "single_corner_constrained",
  "coupled_far_edge_constrained",
  "abstain",
]);

const VALID_DETERMINING_EDGE_ROLES: ReadonlySet<ManualDeterminingEdge["role"]> = new Set<
  ManualDeterminingEdge["role"]
>(["rear_floor_wall_edge", "other_visible_floor_boundary"]);

const CORNER_LABEL_SET: ReadonlySet<string> = new Set<string>(FLOOR_CORNER_LABELS);

// Seams shorter than this many vertices are accepted but flagged as thin
// evidence. Advisory only; never blocks.
const SHORT_SEAM_VERTEX_WARN_THRESHOLD = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInUnitRange(value: number): boolean {
  return value >= 0 && value <= 1;
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isCornerLabel(value: unknown): value is FloorCornerLabel {
  return typeof value === "string" && CORNER_LABEL_SET.has(value);
}

function pointsAreEqual(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function validateSpanT(
  span: { startT: number; endT: number } | null | undefined,
  label: string,
  errors: string[]
): void {
  if (!span || typeof span !== "object") {
    errors.push(`${label} is missing or not an object.`);
    return;
  }
  if (!isFiniteNumber(span.startT) || !isFiniteNumber(span.endT)) {
    errors.push(`${label} startT/endT must be finite numbers.`);
    return;
  }
  if (!isInUnitRange(span.startT) || !isInUnitRange(span.endT)) {
    errors.push(`${label} startT/endT must lie within [0, 1].`);
    return;
  }
  if (span.startT > span.endT) {
    errors.push(`${label} startT must be <= endT.`);
  }
}

function validateSeam(
  seam: ManualPhysicalSeam,
  index: number,
  errors: string[],
  warnings: string[]
): void {
  const label = `Seam[${index}] (${seam?.id ?? "no-id"})`;

  if (!seam || typeof seam !== "object") {
    errors.push(`${label} is missing or not an object.`);
    return;
  }
  if (typeof seam.id !== "string" || seam.id.trim().length === 0) {
    errors.push(`${label} must have a non-empty string id.`);
  }
  if (seam.kind !== "physical_floor_wall_seam") {
    errors.push(`${label} kind must be "physical_floor_wall_seam".`);
  }

  const points = seam.points;
  if (!Array.isArray(points)) {
    errors.push(`${label} points must be an array.`);
    return;
  }

  // Check 3: at least two points.
  if (points.length < 2) {
    errors.push(`${label} must have at least two points.`);
  }

  // Check 1 + 2: finite source-normalized coordinates within bounds.
  let allPointsValid = true;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      errors.push(`${label} point[${i}] must have finite x and y.`);
      allPointsValid = false;
      continue;
    }
    if (!isInUnitRange(point.x) || !isInUnitRange(point.y)) {
      errors.push(`${label} point[${i}] must be within source-normalized bounds [0, 1].`);
      allPointsValid = false;
    }
  }

  if (allPointsValid && points.length >= 2) {
    // Check 4: no zero-length adjacent segments.
    for (let i = 1; i < points.length; i += 1) {
      if (pointsAreEqual(points[i - 1], points[i])) {
        errors.push(`${label} has a zero-length segment between point[${i - 1}] and point[${i}].`);
      }
    }
    // Check (3, strengthened): at least two UNIQUE points.
    const hasUniquePair = points.some((point) => !pointsAreEqual(point, points[0]));
    if (!hasUniquePair) {
      errors.push(`${label} must contain at least two unique points.`);
    }
  }

  // Check 5: valid usable-span indices.
  const span = seam.usableSpan;
  if (!span || typeof span !== "object") {
    errors.push(`${label} usableSpan is missing or not an object.`);
  } else if (!isInteger(span.startVertexIndex) || !isInteger(span.endVertexIndex)) {
    errors.push(`${label} usableSpan indices must be integers.`);
  } else if (
    span.startVertexIndex < 0 ||
    span.endVertexIndex < 0 ||
    span.startVertexIndex >= points.length ||
    span.endVertexIndex >= points.length
  ) {
    errors.push(`${label} usableSpan indices are out of range for the seam points.`);
  } else if (span.startVertexIndex >= span.endVertexIndex) {
    errors.push(`${label} usableSpan startVertexIndex must be < endVertexIndex.`);
  }

  // Check 6: positive finite corridor width.
  const corridor = seam.corridor;
  if (!corridor || typeof corridor !== "object") {
    errors.push(`${label} corridor is missing or not an object.`);
  } else if (!isFiniteNumber(corridor.halfWidthSourcePx) || corridor.halfWidthSourcePx <= 0) {
    errors.push(`${label} corridor.halfWidthSourcePx must be a positive finite number.`);
  }

  if (typeof seam.notes !== "undefined" && typeof seam.notes !== "string") {
    errors.push(`${label} notes must be a string when present.`);
  }

  // Advisory: thin evidence (does not block).
  if (Array.isArray(points) && points.length <= SHORT_SEAM_VERTEX_WARN_THRESHOLD) {
    warnings.push(`${label} is a minimal two-point seam; consider adding vertices for stronger evidence.`);
  }
}

/**
 * Validates a manual floor-support annotation's structural integrity only.
 * Pure and deterministic. Has NO dependency on solver output, camera pose,
 * homography, reprojection residuals, FOV scan, Apply logic, or candidate
 * solvability — it operates solely on the supplied annotation.
 */
export function validateManualFloorSupportAnnotation(
  annotation: ManualFloorSupportAnnotation
): ManualFloorSupportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!annotation || typeof annotation !== "object") {
    return { ok: false, errors: ["Annotation is missing or not an object."], warnings };
  }

  if (annotation.schema !== "vibode-manual-floor-support-annotation/v0") {
    errors.push("Annotation schema must be vibode-manual-floor-support-annotation/v0.");
  }

  const seams = annotation.seams;
  const seamIds = new Set<string>();
  if (!Array.isArray(seams)) {
    errors.push("Annotation seams must be an array.");
  } else {
    for (let i = 0; i < seams.length; i += 1) {
      validateSeam(seams[i], i, errors, warnings);
      const id = seams[i]?.id;
      if (typeof id === "string" && id.length > 0) {
        if (seamIds.has(id)) {
          errors.push(`Duplicate seam id "${id}"; seam ids must be unique.`);
        }
        seamIds.add(id);
      }
    }
  }

  const seamExists = (seamId: unknown): boolean =>
    typeof seamId === "string" && seamIds.has(seamId);

  // --- Corner support map -----------------------------------------------------
  const cornerSupport = annotation.cornerSupport;
  if (cornerSupport === null || typeof cornerSupport !== "object") {
    errors.push("Annotation cornerSupport must be an object.");
  } else {
    for (const rawLabel of Object.keys(cornerSupport)) {
      // Check 7: valid corner labels.
      if (!isCornerLabel(rawLabel)) {
        errors.push(`cornerSupport has an invalid corner label "${rawLabel}".`);
        continue;
      }
      const support = cornerSupport[rawLabel as FloorCornerLabel];
      if (!support || typeof support !== "object") {
        errors.push(`cornerSupport[${rawLabel}] must be an object.`);
        continue;
      }
      // Check 7: valid corner state.
      if (!VALID_CORNER_SUPPORT_STATES.has(support.state)) {
        errors.push(`cornerSupport[${rawLabel}] has an invalid state "${String(support.state)}".`);
      }
      if (typeof support.note !== "undefined" && typeof support.note !== "string") {
        errors.push(`cornerSupport[${rawLabel}] note must be a string when present.`);
      }
      // Check 8: referenced seam ids exist.
      if (typeof support.linkedSeamId !== "undefined" && !seamExists(support.linkedSeamId)) {
        errors.push(
          `cornerSupport[${rawLabel}] linkedSeamId "${String(support.linkedSeamId)}" does not reference an existing seam.`
        );
      }
    }
  }

  // --- Mode + authority -------------------------------------------------------
  const mode = annotation.mode;
  if (!VALID_SEARCH_MODES.has(mode)) {
    errors.push(`Annotation mode "${String(mode)}" is not a valid search mode.`);
  }

  const authority = annotation.adjustmentAuthority;
  if (!authority || typeof authority !== "object") {
    errors.push("Annotation adjustmentAuthority is missing or not an object.");
  } else {
    validateAuthority(mode, authority, seamExists, errors);
  }

  // --- Determining edge -------------------------------------------------------
  if (annotation.determiningEdge !== null) {
    const edge = annotation.determiningEdge;
    if (!edge || typeof edge !== "object") {
      errors.push("Annotation determiningEdge must be null or an object.");
    } else {
      // Check 13: determining edge seam must exist.
      if (!seamExists(edge.seamId)) {
        errors.push(`determiningEdge.seamId "${String(edge.seamId)}" does not reference an existing seam.`);
      }
      if (!VALID_DETERMINING_EDGE_ROLES.has(edge.role)) {
        errors.push(`determiningEdge.role "${String(edge.role)}" is invalid.`);
      }
      if (!Array.isArray(edge.intendedCanonicalSupport)) {
        errors.push("determiningEdge.intendedCanonicalSupport must be an array.");
      } else {
        for (const corner of edge.intendedCanonicalSupport) {
          if (!isCornerLabel(corner)) {
            errors.push(`determiningEdge.intendedCanonicalSupport contains invalid corner "${String(corner)}".`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateAuthority(
  mode: ManualSearchMode,
  authority: ManualAdjustmentAuthority,
  seamExists: (seamId: unknown) => boolean,
  errors: string[]
): void {
  switch (authority.kind) {
    case "none": {
      // Check 9: direct/abstain (and only those) are compatible with none.
      if (mode === "single_corner_constrained" || mode === "coupled_far_edge_constrained") {
        errors.push(`Mode "${mode}" requires adjustment authority, but authority kind is "none".`);
      }
      return;
    }
    case "single_corner": {
      // Check 9: direct/abstain reject any non-none authority.
      if (mode === "direct" || mode === "abstain") {
        errors.push(`Mode "${mode}" must use authority kind "none", not "single_corner".`);
      } else if (mode !== "single_corner_constrained") {
        errors.push(`Authority kind "single_corner" requires mode "single_corner_constrained".`);
      }
      // Check 10: one valid corner plus one valid seam.
      if (!isCornerLabel(authority.corner)) {
        errors.push(`single_corner authority corner "${String(authority.corner)}" is invalid.`);
      }
      if (!seamExists(authority.seamId)) {
        errors.push(`single_corner authority seamId "${String(authority.seamId)}" does not reference an existing seam.`);
      }
      validateSpanT(authority.allowedSpan, "single_corner authority allowedSpan", errors);
      return;
    }
    case "coupled_far_edge": {
      // Check 9: direct/abstain reject any non-none authority.
      if (mode === "direct" || mode === "abstain") {
        errors.push(`Mode "${mode}" must use authority kind "none", not "coupled_far_edge".`);
      } else if (mode !== "coupled_far_edge_constrained") {
        errors.push(`Authority kind "coupled_far_edge" requires mode "coupled_far_edge_constrained".`);
      }
      // Check 11: coupled mode accepts exactly FL and FR.
      const corners = authority.corners;
      const isExactlyFlFr =
        Array.isArray(corners) &&
        corners.length === 2 &&
        corners[0] === "FL" &&
        corners[1] === "FR";
      if (!isExactlyFlFr) {
        errors.push('coupled_far_edge authority corners must be exactly ["FL", "FR"].');
      }
      // Check 12: valid seam reference and valid ranges.
      if (!seamExists(authority.seamId)) {
        errors.push(`coupled_far_edge authority seamId "${String(authority.seamId)}" does not reference an existing seam.`);
      }
      validateSpanT(authority.flAllowedSpan, "coupled_far_edge authority flAllowedSpan", errors);
      validateSpanT(authority.frAllowedSpan, "coupled_far_edge authority frAllowedSpan", errors);

      const coupling = authority.coupling;
      if (!coupling || typeof coupling !== "object") {
        errors.push("coupled_far_edge authority coupling is missing or not an object.");
      } else {
        if (coupling.preserveOrder !== true) {
          errors.push("coupled_far_edge authority coupling.preserveOrder must be true.");
        }
        if (coupling.preserveEdgeDirection !== true) {
          errors.push("coupled_far_edge authority coupling.preserveEdgeDirection must be true.");
        }
        if (
          !isFiniteNumber(coupling.maxRelativeAlongSeamDeltaSourcePx) ||
          coupling.maxRelativeAlongSeamDeltaSourcePx <= 0
        ) {
          errors.push(
            "coupled_far_edge authority coupling.maxRelativeAlongSeamDeltaSourcePx must be a positive finite number."
          );
        }
      }
      return;
    }
    default: {
      errors.push(`adjustmentAuthority.kind "${String((authority as { kind?: unknown }).kind)}" is invalid.`);
    }
  }
}
