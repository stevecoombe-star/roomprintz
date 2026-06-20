// --- Phase 2F-G1: Controlled real-image fixture harness (lab-only) ----------
// Pure, side-effect-free manifest + types for a deliberate, human-driven test
// harness in the 3D Room Lab.
//
// HARD GUARANTEES:
// - No network, no model calls, no DB. This module only describes fixtures.
// - Fixture image files are LOCAL/DEV-ONLY and are NOT committed to git
//   (see public/3d-lab/fixtures/README.txt + .gitignore). Missing files simply
//   fail to load in the lab and surface a clear local message.
// - The committed manifest below is a small set of placeholder/example entries,
//   one per category. It does NOT auto-load or auto-run anything.

export type AutoFloorFixtureCategory =
  | "clean-open-floor"
  | "centered-rectangular-room"
  | "rug-dominant"
  | "sofa-or-table-occlusion"
  | "small-visible-floor"
  | "wide-angle"
  | "dark-floor-wall-blending"
  | "open-plan-or-angled-room"
  | "floor-corners-off-frame"
  | "unsupported-orientation-or-invalid-image";

export type AutoFloorFixtureExpectedBehavior =
  | "likely_good"
  | "needs_review"
  | "likely_manual"
  | "expected_failure";

export type AutoFloorFixture = {
  id: string;
  label: string;
  category: AutoFloorFixtureCategory;
  // Local dev path under /public; the file may not exist (placeholder).
  imageUrl: string;
  expectedBehavior: AutoFloorFixtureExpectedBehavior;
  notes: string[];
};

// Local, git-ignored fixture asset folder (served from /public).
export const AUTO_FLOOR_FIXTURE_DIR = "/3d-lab/fixtures";

function fixtureImagePath(fileName: string): string {
  return `${AUTO_FLOOR_FIXTURE_DIR}/${fileName}`;
}

// Initial committed manifest: one placeholder example per category. Drop a
// matching local image into public/3d-lab/fixtures/ to exercise each entry.
export const AUTO_FLOOR_FIXTURES: AutoFloorFixture[] = [
  {
    id: "clean-open-floor",
    label: "Clean open floor",
    category: "clean-open-floor",
    imageUrl: fixtureImagePath("clean-open-floor.jpg"),
    expectedBehavior: "likely_good",
    notes: ["Large unobstructed floor; baseline best-case for calibration."],
  },
  {
    id: "centered-rectangular-room",
    label: "Centered rectangular room",
    category: "centered-rectangular-room",
    imageUrl: fixtureImagePath("centered-rectangular-room.jpg"),
    expectedBehavior: "likely_good",
    notes: ["Symmetric, head-on framing; strong wall-floor edges."],
  },
  {
    id: "rug-dominant",
    label: "Rug-dominant floor",
    category: "rug-dominant",
    imageUrl: fixtureImagePath("rug-dominant.jpg"),
    expectedBehavior: "needs_review",
    notes: ["Model may trace the rug outline instead of the floor plane."],
  },
  {
    id: "sofa-or-table-occlusion",
    label: "Sofa / table occlusion",
    category: "sofa-or-table-occlusion",
    imageUrl: fixtureImagePath("sofa-or-table-occlusion.jpg"),
    expectedBehavior: "needs_review",
    notes: ["Furniture hides floor corners; expect occlusion risks disclosed."],
  },
  {
    id: "small-visible-floor",
    label: "Small visible floor",
    category: "small-visible-floor",
    imageUrl: fixtureImagePath("small-visible-floor.jpg"),
    expectedBehavior: "likely_manual",
    notes: ["Little floor visible; calibration likely needs manual correction."],
  },
  {
    id: "wide-angle",
    label: "Wide-angle lens",
    category: "wide-angle",
    imageUrl: fixtureImagePath("wide-angle.jpg"),
    expectedBehavior: "needs_review",
    notes: ["Lens distortion can bow straight floor edges."],
  },
  {
    id: "dark-floor-wall-blending",
    label: "Dark floor / wall blending",
    category: "dark-floor-wall-blending",
    imageUrl: fixtureImagePath("dark-floor-wall-blending.jpg"),
    expectedBehavior: "needs_review",
    notes: ["Low contrast at the floor-wall boundary; edge may be ambiguous."],
  },
  {
    id: "open-plan-or-angled-room",
    label: "Open-plan / angled room",
    category: "open-plan-or-angled-room",
    imageUrl: fixtureImagePath("open-plan-or-angled-room.jpg"),
    expectedBehavior: "needs_review",
    notes: ["Off-angle framing; the critical wall-floor edge is the key signal."],
  },
  {
    id: "floor-corners-off-frame",
    label: "Floor corners off-frame",
    category: "floor-corners-off-frame",
    imageUrl: fixtureImagePath("floor-corners-off-frame.jpg"),
    expectedBehavior: "likely_manual",
    notes: ["Corners fall outside the image; expect inferred/clamped corners."],
  },
  {
    id: "unsupported-orientation-or-invalid-image",
    label: "Unsupported orientation / invalid image",
    category: "unsupported-orientation-or-invalid-image",
    imageUrl: fixtureImagePath("unsupported-orientation-or-invalid-image.jpg"),
    expectedBehavior: "expected_failure",
    notes: ["EXIF-rotated or invalid image; should fail closed via route guards."],
  },
];

export function getAutoFloorFixtureById(id: string): AutoFloorFixture | null {
  return AUTO_FLOOR_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Observation record (local React state only; never persisted)
// ---------------------------------------------------------------------------

export type AutoFloorFixtureManualCorrection =
  | "not_recorded"
  | "none"
  | "minor"
  | "major"
  | "manual_required"
  | "not_applicable";

export type AutoFloorFixtureHumanAssessment =
  | "not_recorded"
  | "good"
  | "needs_review"
  | "bad"
  | "expected_failure";

export type AutoFloorFixtureObservation = {
  fixtureId: string;
  fixtureCategory: AutoFloorFixtureCategory | null;
  providerId: string;
  model?: string | null;
  timestamp: string;
  detectionStatus: "ok" | "needs_review" | "failed";
  candidateCount: number;
  selectedCandidateId: string | null;
  selectedScoreBand: string | null;
  selectedScore: number | null;
  homographyStatus: string | null;
  cameraPoseStatus: string | null;
  fovScanStatus: string | null;
  rayHomographyAgreement?: number | null;
  latestFailureReason: string | null;
  manualCorrectionAssessment: AutoFloorFixtureManualCorrection;
  humanAssessment: AutoFloorFixtureHumanAssessment;
  notes: string;
};
