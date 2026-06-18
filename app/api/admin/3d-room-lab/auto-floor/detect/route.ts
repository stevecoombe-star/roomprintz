import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import {
  mapRawVisionFloorResponseToDetectionResult,
} from "@/app/admin/3d-room-lab/auto-floor-vision-schema";
import type { AutoFloorDetectionResult } from "@/app/admin/3d-room-lab/auto-floor-detection";

// --- Phase 2F-C: Lab-only mock auto-floor detection API route ---------------
// Proves the future network boundary WITHOUT any AI/external calls:
//   client (mock-api provider) -> this route -> canned vision-shaped JSON
//   -> Phase 2F-B validator/mapper -> AutoFloorDetectionResult -> client.
//
// Hard constraints for this phase:
// - No real model, no external API, no API keys.
// - Does NOT fetch imageUrl (no remote image access / SSRF surface).
// - Deterministic canned response; never analyzes the image.
// - Never mutates floor polygon / scene state (it has no access to them).
// - Returns a normal AutoFloorDetectionResult JSON even for bad input.

const DEFAULT_FLOOR_RECT = { widthMeters: 4, depthMeters: 4 };
const DEFAULT_MAX_CANDIDATES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseFrameSize(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return { width: value.width, height: value.height };
}

function parseFloorRect(value: unknown): { widthMeters: number; depthMeters: number } {
  if (!isRecord(value)) return DEFAULT_FLOOR_RECT;
  if (!isFiniteNumber(value.widthMeters) || !isFiniteNumber(value.depthMeters)) return DEFAULT_FLOOR_RECT;
  if (value.widthMeters <= 0 || value.depthMeters <= 0) return DEFAULT_FLOOR_RECT;
  return { widthMeters: value.widthMeters, depthMeters: value.depthMeters };
}

function failedResult(reason: string): AutoFloorDetectionResult {
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: ["Mock API route (canned data; no AI or external API was called)."],
    failureReasons: [reason],
  };
}

/**
 * Deterministic, imperfect-but-valid canned response shaped like a real vision
 * model would return. Intentionally exercises the Phase 2F-B validator:
 * - candidate 1 uses a NON-canonical point order (proves local canonicalization)
 * - candidate 2 uses the labeled `corners` form + risks
 * - candidate 3 has a mildly out-of-frame point (proves clamp + risk)
 * Model confidence values intentionally do NOT track geometry quality, proving
 * the app never trusts model confidence.
 */
function buildCannedRawVisionResponse() {
  return {
    status: "ok",
    modelNotes: [
      "Canned mock-api response — not real AI detection.",
      "Coordinates are illustrative and were not derived from the image.",
    ],
    failureReasons: [],
    // Included to prove they are ignored (mapper only adds a note for these).
    visibleFloorRegionNorm: [
      { x: 0.1, y: 0.55 },
      { x: 0.9, y: 0.55 },
      { x: 0.95, y: 0.98 },
      { x: 0.05, y: 0.98 },
    ],
    horizonHint: { yNorm: 0.42, vanishingPointsNorm: [{ x: 0.5, y: 0.42 }] },
    candidates: [
      {
        // Strong central patch. Points deliberately scrambled (FR, NL, FL, NR)
        // so canonicalization via orderFloorCorners is actually required.
        quad: [
          { x: 0.62, y: 0.6 },
          { x: 0.28, y: 0.9 },
          { x: 0.38, y: 0.6 },
          { x: 0.72, y: 0.9 },
        ],
        label: "Central floor patch",
        // Under-confident on purpose vs. likely-high geometry score.
        confidence: 0.55,
        confidenceBand: "medium",
        notes: ["Large clearly-floor region near image center-bottom."],
        risks: [],
        occluded: false,
      },
      {
        // Wider / more ambitious, provided in labeled `corners` form.
        corners: {
          nearLeft: { x: 0.12, y: 0.93 },
          nearRight: { x: 0.88, y: 0.93 },
          farRight: { x: 0.72, y: 0.55 },
          farLeft: { x: 0.28, y: 0.55 },
        },
        label: "Wide ambitious patch",
        // Over-confident on purpose despite disclosed risks.
        confidence: 0.92,
        confidenceBand: "high",
        notes: ["Covers more floor area for a wider calibration spread."],
        risks: ["wall-floor-bleed", "corner-inferred-occluded"],
        occluded: true,
      },
      {
        // Imperfect-but-tolerable: nearRight.y = 1.06 is mildly out of frame
        // (within the [-0.25, 1.25] tolerance) and should clamp + add a risk.
        quad: [
          { x: 0.3, y: 0.95 },
          { x: 0.78, y: 1.06 },
          { x: 0.62, y: 0.66 },
          { x: 0.4, y: 0.66 },
        ],
        label: "Foreground patch (edge clipped)",
        confidence: 0.3,
        confidenceBand: "low",
        notes: ["Foreground floor patch; one corner sits just past the frame edge."],
        risks: [],
        occluded: false,
      },
    ],
  };
}

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) {
    return NextResponse.json(failedResult("Admin access required."), { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failedResult("Request body was not valid JSON."), { status: 200 });
  }

  const record = isRecord(body) ? body : {};
  const frameSize = parseFrameSize(record.frameSize);
  const floorRect = parseFloorRect(record.floorRect);

  // Note: imageUrl/currentFloorPolygon/requestId are accepted to exercise the
  // boundary but are intentionally NOT used to generate the canned response.
  const raw = buildCannedRawVisionResponse();

  let result: AutoFloorDetectionResult;
  try {
    result = mapRawVisionFloorResponseToDetectionResult(raw, {
      frameSize,
      floorRect,
      maxCandidates: DEFAULT_MAX_CANDIDATES,
    });
  } catch (error) {
    return NextResponse.json(
      failedResult(error instanceof Error ? error.message : "Mapper failed unexpectedly."),
      { status: 200 }
    );
  }

  return NextResponse.json(result, { status: 200 });
}
