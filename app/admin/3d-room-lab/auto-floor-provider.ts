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
  // Phase 2F-F (additive, optional): original/intrinsic image dimensions, needed
  // by the real vision route to convert model source-normalized coordinates into
  // container-normalized-v0. mock providers safely ignore it.
  intrinsicSize?: { width: number; height: number } | null;
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

// Lab-only REAL Gemini vision route (admin-gated + server feature-flag-gated).
export const VISION_AUTO_FLOOR_API_ROUTE = "/api/admin/3d-room-lab/auto-floor/detect-vision";
// Slightly above the server budget (image fetch ~10s + Gemini ~25s) so the
// client doesn't abort a request the server is still legitimately working on.
const VISION_API_TIMEOUT_MS = 40000;

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

function visionTransportFailedResult(reason: string): AutoFloorDetectionResult {
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: ["Provider: vision-model (Gemini lab route; admin + server flag gated)."],
    failureReasons: [reason],
  };
}

// Vision-model provider: POSTs to the REAL, flag-gated Gemini route. The route
// performs auth, the feature-flag check, SSRF-safe image fetch, the Gemini call,
// coordinate conversion, and Phase 2F-B validation/mapping. This client provider
// only handles transport and never throws into the UI. It sends NO API key and
// NO image bytes (URL-first). `available: true` means it is wired; UI exposure is
// gated separately by the server-derived visionEnabled flag (see
// getSelectableAutoFloorDetectionProviders).
const visionModelProvider: AutoFloorDetectionProvider = {
  id: "vision-model",
  label: "Gemini vision (lab)",
  description:
    "Experimental lab provider. Gemini proposes candidates; Vibode validates geometry before preview. Admin + server flag gated.",
  available: true,
  async run(input: AutoFloorDetectionInput): Promise<AutoFloorDetectionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VISION_API_TIMEOUT_MS);
    try {
      const response = await fetch(VISION_AUTO_FLOOR_API_ROUTE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: input.imageUrl ?? null,
          frameSize: input.frameSize ?? null,
          intrinsicSize: input.intrinsicSize ?? null,
          floorRect: input.floorRect ?? null,
          // Sent only as an optional weak hint; the route may ignore it.
          currentFloorPolygon: input.currentFloorPolygon ?? null,
          requestId:
            typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null,
        }),
        signal: controller.signal,
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        return visionTransportFailedResult(
          `Vision route returned a non-JSON response (HTTP ${response.status}).`
        );
      }

      const coerced = coerceDetectionResult(payload);
      if (!coerced) {
        const reasons =
          typeof payload === "object" && payload !== null && Array.isArray((payload as Record<string, unknown>).failureReasons)
            ? ((payload as Record<string, unknown>).failureReasons as unknown[]).filter(
                (r): r is string => typeof r === "string"
              )
            : [];
        return visionTransportFailedResult(
          reasons.length > 0
            ? reasons.join(" ")
            : `Vision route returned an unexpected payload (HTTP ${response.status}).`
        );
      }

      if (!response.ok && coerced.status !== "failed") {
        return visionTransportFailedResult(`Vision route responded with HTTP ${response.status}.`);
      }

      return coerced;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return visionTransportFailedResult("Vision request timed out or was aborted.");
      }
      return visionTransportFailedResult(
        error instanceof Error ? error.message : "Vision transport failed."
      );
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
  "vision-model": visionModelProvider,
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

/** Providers that are wired up (selectable in principle). */
export function getAvailableAutoFloorDetectionProviders(): AutoFloorDetectionProvider[] {
  return Object.values(AUTO_FLOOR_DETECTION_PROVIDERS).filter((provider) => provider.available);
}

/**
 * Providers to actually expose in the lab UI. The real "vision-model" provider
 * is wired but must only be shown when the server-derived feature flag is on
 * (the route itself remains the hard security gate). mock-local/mock-api are
 * always shown.
 */
export function getSelectableAutoFloorDetectionProviders(
  visionEnabled: boolean
): AutoFloorDetectionProvider[] {
  return getAvailableAutoFloorDetectionProviders().filter((provider) => {
    if (provider.id === "vision-model") return visionEnabled;
    return true;
  });
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
