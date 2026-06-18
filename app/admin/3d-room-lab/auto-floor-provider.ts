import type { Vec2 } from "./perspective-solve";
import {
  createMockAutoFloorDetectionResult,
  type AutoFloorDetectionResult,
} from "./auto-floor-detection";

// --- Phase 2E: Auto floor detection provider boundary -----------------------
// A small, mockable abstraction so the current deterministic mock flow can later
// be swapped for a real AI/vision/segmentation provider WITHOUT changing the
// preview / scoring / apply pipeline in the lab UI.
//
// Strict Phase 2E scope:
// - Only "mock-local" is active. It wraps createMockAutoFloorDetectionResult.
// - No real AI, no external API calls, no segmentation, no API keys.
// - Reserved provider IDs return a clear "failed/unsupported" result if invoked.
// - Pure boundary: providers never mutate the floor polygon or scene state.
// - The run() signature is async to model future providers; mock-local resolves
//   immediately.

export type AutoFloorDetectionProviderId =
  | "mock-local"
  | "mock-api"
  | "vision-model"
  | "segmentation";

export type AutoFloorDetectionInput = {
  imageUrl: string | null;
  frameSize: {
    width: number;
    height: number;
  } | null;
  currentFloorPolygon?: Vec2[];
};

export type AutoFloorDetectionProvider = {
  id: AutoFloorDetectionProviderId;
  label: string;
  description: string;
  // Whether this provider is wired up and selectable in Phase 2E.
  available: boolean;
  run(input: AutoFloorDetectionInput): Promise<AutoFloorDetectionResult>;
};

function buildUnsupportedResult(
  providerId: AutoFloorDetectionProviderId,
  reason: string
): AutoFloorDetectionResult {
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: [`Provider "${providerId}" is reserved but not implemented in Phase 2E.`],
    failureReasons: [reason],
  };
}

// Mock-local provider: wraps the existing deterministic mock generator. Adds
// provider-level notes so it is obvious in the UI/debug that this is not real
// detection, and surfaces a forward-looking note when real-provider inputs
// (image URL / frame size) are missing.
const mockLocalProvider: AutoFloorDetectionProvider = {
  id: "mock-local",
  label: "Mock local",
  description: "Deterministic local mock candidates. No AI, no API, no segmentation.",
  available: true,
  async run(input: AutoFloorDetectionInput): Promise<AutoFloorDetectionResult> {
    const base = createMockAutoFloorDetectionResult(input.currentFloorPolygon);

    const providerNotes = ["Provider: mock-local (deterministic; no AI/API/segmentation)."];
    const missingInputs: string[] = [];
    if (!input.imageUrl) missingInputs.push("image URL");
    if (!input.frameSize || input.frameSize.width <= 0 || input.frameSize.height <= 0) {
      missingInputs.push("frame size");
    }
    if (missingInputs.length > 0) {
      providerNotes.push(
        `Missing ${missingInputs.join(" and ")}; mock-local still works, but real providers will require this data.`
      );
    }

    return {
      ...base,
      notes: [...providerNotes, ...base.notes],
    };
  },
};

const reservedProvider = (
  id: AutoFloorDetectionProviderId,
  label: string,
  description: string
): AutoFloorDetectionProvider => ({
  id,
  label,
  description,
  available: false,
  async run(): Promise<AutoFloorDetectionResult> {
    return buildUnsupportedResult(id, `${label} provider is not implemented yet.`);
  },
});

export const AUTO_FLOOR_DETECTION_PROVIDERS: Record<
  AutoFloorDetectionProviderId,
  AutoFloorDetectionProvider
> = {
  "mock-local": mockLocalProvider,
  "mock-api": reservedProvider(
    "mock-api",
    "Mock API",
    "Reserved: future lab-only API-backed mock provider."
  ),
  "vision-model": reservedProvider(
    "vision-model",
    "Vision model",
    "Reserved: future direct vision-model floor detection."
  ),
  segmentation: reservedProvider(
    "segmentation",
    "Segmentation",
    "Reserved: future segmentation-fit floor detection."
  ),
};

export const ACTIVE_AUTO_FLOOR_DETECTION_PROVIDER_ID: AutoFloorDetectionProviderId = "mock-local";

export function getAutoFloorDetectionProvider(
  providerId: AutoFloorDetectionProviderId
): AutoFloorDetectionProvider | null {
  return AUTO_FLOOR_DETECTION_PROVIDERS[providerId] ?? null;
}

/**
 * Runs auto floor detection through the named provider. Phase 2E only wires
 * "mock-local"; any other (or unknown) provider resolves to a clear failed
 * result rather than throwing, so the UI can render failureReasons safely.
 */
export async function runAutoFloorDetection(
  providerId: AutoFloorDetectionProviderId,
  input: AutoFloorDetectionInput
): Promise<AutoFloorDetectionResult> {
  const provider = getAutoFloorDetectionProvider(providerId);
  if (!provider) {
    return buildUnsupportedResult(providerId, `Unknown provider "${providerId}".`);
  }
  if (!provider.available) {
    return buildUnsupportedResult(providerId, `${provider.label} provider is not available in Phase 2E.`);
  }
  try {
    return await provider.run(input);
  } catch (error) {
    return {
      status: "failed",
      candidates: [],
      selectedCandidateId: null,
      notes: [`Provider "${providerId}" threw during run.`],
      failureReasons: [error instanceof Error ? error.message : "Unknown provider error."],
    };
  }
}
