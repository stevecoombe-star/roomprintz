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
  // Phase 2F-C (additive, optional): floor rectangle assumption needed by the
  // server-side mapper to run geometry scoring. mock-local safely ignores it.
  floorRect?: { widthMeters: number; depthMeters: number } | null;
};

export type AutoFloorDetectionProvider = {
  id: AutoFloorDetectionProviderId;
  label: string;
  description: string;
  // Whether this provider is wired up and selectable in the lab UI.
  available: boolean;
  run(input: AutoFloorDetectionInput): Promise<AutoFloorDetectionResult>;
};

// Lab-only mock API route (admin-gated; canned data; no AI/external calls).
export const MOCK_AUTO_FLOOR_API_ROUTE = "/api/admin/3d-room-lab/auto-floor/detect";
const MOCK_API_TIMEOUT_MS = 15000;

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

// Minimal trust check on the route's JSON. The route already runs the Phase
// 2F-B mapper, so this only guards against transport/shape corruption.
function coerceDetectionResult(value: unknown): AutoFloorDetectionResult | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const validStatuses = ["idle", "mock_ready", "ok", "needs_review", "failed"];
  if (typeof record.status !== "string" || !validStatuses.includes(record.status)) return null;
  if (!Array.isArray(record.candidates)) return null;
  if (!Array.isArray(record.notes)) return null;
  if (!Array.isArray(record.failureReasons)) return null;
  if (record.selectedCandidateId !== null && typeof record.selectedCandidateId !== "string") return null;
  return value as AutoFloorDetectionResult;
}

function transportFailedResult(reason: string): AutoFloorDetectionResult {
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: ["Provider: mock-api (lab-only route; canned data, no AI/external API)."],
    failureReasons: [reason],
  };
}

// Mock-api provider: POSTs to the lab-only route, which returns canned
// vision-shaped data already mapped to AutoFloorDetectionResult by the Phase
// 2F-B validator. Never throws into the UI; all failures become a failed result.
const mockApiProvider: AutoFloorDetectionProvider = {
  id: "mock-api",
  label: "Mock API",
  description:
    "Exercises the lab API boundary using canned vision-model-shaped data. No AI or external API is called.",
  available: true,
  async run(input: AutoFloorDetectionInput): Promise<AutoFloorDetectionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MOCK_API_TIMEOUT_MS);
    try {
      const response = await fetch(MOCK_AUTO_FLOOR_API_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: input.imageUrl ?? null,
          frameSize: input.frameSize ?? null,
          currentFloorPolygon: input.currentFloorPolygon ?? null,
          floorRect: input.floorRect ?? null,
          requestId:
            typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null,
        }),
        signal: controller.signal,
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        return transportFailedResult(`Mock API returned a non-JSON response (HTTP ${response.status}).`);
      }

      const coerced = coerceDetectionResult(payload);
      if (!coerced) {
        // The route returns a failed AutoFloorDetectionResult even on handled
        // errors; surface its reasons if present, otherwise a generic message.
        const reasons =
          typeof payload === "object" && payload !== null && Array.isArray((payload as Record<string, unknown>).failureReasons)
            ? ((payload as Record<string, unknown>).failureReasons as unknown[]).filter(
                (r): r is string => typeof r === "string"
              )
            : [];
        return transportFailedResult(
          reasons.length > 0
            ? reasons.join(" ")
            : `Mock API returned an unexpected payload (HTTP ${response.status}).`
        );
      }

      if (!response.ok && coerced.status !== "failed") {
        return transportFailedResult(`Mock API responded with HTTP ${response.status}.`);
      }

      return coerced;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return transportFailedResult("Mock API request timed out or was aborted.");
      }
      return transportFailedResult(error instanceof Error ? error.message : "Mock API transport failed.");
    } finally {
      clearTimeout(timeout);
    }
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
  "mock-api": mockApiProvider,
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

/** Providers that are wired up and may be exposed in the lab UI. */
export function getAvailableAutoFloorDetectionProviders(): AutoFloorDetectionProvider[] {
  return Object.values(AUTO_FLOOR_DETECTION_PROVIDERS).filter((provider) => provider.available);
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
