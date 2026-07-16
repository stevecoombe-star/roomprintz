import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;

// P-url-drift-specific bounded dual-route observation module. This module is
// deliberately not shared with, derived from, or generalized over the
// completed P-dimension or X4 harnesses.

const P_URL_DRIFT_PROBE_ID = "P-url-drift";
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 3000;
const REQUIRED_ROUTE_TOKEN = "basis_fingerprint_mismatch" as const;

export const P_URL_DRIFT_SERVED_FILE_NAME = "A-drift-b.jpg";
export const P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL =
  `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/${P_URL_DRIFT_SERVED_FILE_NAME}`;

export const P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS = {
  width: 320,
  height: 240,
} as const;

// Sentinel non-resolvable image-host allowlist plus the narrow dev-only
// localhost HTTP allowance: the only fetchable target is the bounded loopback
// server on 127.0.0.1:3000, and any external host or redirect escape fails the
// route's own host validation.
export const P_URL_DRIFT_ROUTE_ENV: Readonly<Record<string, string>> = {
  EMPTY_ROOM_ASSIST_ENABLED: "true",
  AUTO_FLOOR_VISION_ENABLED: "true",
  GEMINI_API_KEY: "g0-p-url-drift-placeholder-key-presence-only",
  AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP: "true",
  AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS: "g0-loopback-only.invalid",
};

// GOOGLE_API_KEY is explicitly pinned to a cleared state so key presence is
// governed solely by the placeholder GEMINI_API_KEY above.
export const P_URL_DRIFT_CLEARED_ENV_KEYS = ["GOOGLE_API_KEY"] as const;

const A_PARENT_CANONICAL_SUFFIX =
  "/app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg";
const A_DRIFT_B_CANONICAL_SUFFIX =
  "/app/admin/3d-room-lab/g0-containment/synthetic-assets/A-drift-b.jpg";

const DETECT_VISION_ROUTE_REPO_RELATIVE_PATH =
  "app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts";
const EMPTY_ROOM_ROUTE_REPO_RELATIVE_PATH =
  "app/api/admin/3d-room-lab/empty-room-assist/run/route.ts";
const ROUTE_MODULE_SUFFIXES = [
  `/${DETECT_VISION_ROUTE_REPO_RELATIVE_PATH}`,
  `/${EMPTY_ROOM_ROUTE_REPO_RELATIVE_PATH}`,
] as const;

type ActiveTripwireState = {
  visionModelTripwireInvoked: boolean;
  emptyRoomGenerationTripwireInvoked: boolean;
  boundaryInvocationOrder: string[];
};

let dualRouteHarnessActive = false;
let activeTripwireState: ActiveTripwireState | null = null;

function visionModelTripwireDelegator(): never {
  if (activeTripwireState) {
    activeTripwireState.visionModelTripwireInvoked = true;
    activeTripwireState.boundaryInvocationOrder.push("detectFloorFromVerifiedBytes");
  }
  throw new Error(`detect_vision_model_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`);
}

function emptyRoomGenerationTripwireDelegator(): never {
  if (activeTripwireState) {
    activeTripwireState.emptyRoomGenerationTripwireInvoked = true;
    activeTripwireState.boundaryInvocationOrder.push("getOrGenerateEmptyRoomImage");
  }
  throw new Error(`empty_room_generation_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`);
}

function assertProbeLabelled(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function createPurlDriftLoopbackRequestHandler(input: {
  canonicalDriftAbsolutePath: string;
  expectedServedDriftDigest: string;
  expectedParentBasisFingerprint: string | null;
  servedRequestPaths: string[];
  serveFailures: string[];
}): (request: IncomingMessage, response: ServerResponse) => void {
  const allowedPath = `/${P_URL_DRIFT_SERVED_FILE_NAME}`;
  return (request, response) => {
    const method = request.method ?? "UNKNOWN";
    const requestPath = new URL(
      request.url ?? "/",
      `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`
    ).pathname;
    input.servedRequestPaths.push(`${method} ${requestPath}`);

    if (method !== "GET" || requestPath !== allowedPath) {
      response.writeHead(404).end("not-found");
      return;
    }

    // Re-read and digest-verify the committed drift bytes before every serve
    // so no stale or substituted bytes can ever leave this handler.
    void (async () => {
      try {
        const bytes = await readFile(input.canonicalDriftAbsolutePath);
        const digest = computeCalibrationImageFingerprint(bytes);
        if (digest !== input.expectedServedDriftDigest) {
          input.serveFailures.push(`served_bytes_digest_drift:${P_URL_DRIFT_PROBE_ID}`);
          response.writeHead(500).end("digest-drift");
          return;
        }
        if (
          input.expectedParentBasisFingerprint !== null &&
          input.expectedParentBasisFingerprint === digest
        ) {
          input.serveFailures.push(
            `expected_parent_digest_equals_drift:${P_URL_DRIFT_PROBE_ID}`
          );
          response.writeHead(500).end("digest-collision");
          return;
        }
        response.setHeader("content-type", "image/jpeg");
        response.setHeader("content-length", String(bytes.byteLength));
        response.writeHead(200).end(bytes);
      } catch {
        input.serveFailures.push(`served_bytes_unreadable:${P_URL_DRIFT_PROBE_ID}`);
        response.writeHead(500).end("unreadable");
      }
    })();
  };
}

async function bindLoopbackServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`loopback_port_in_use:${LOOPBACK_HOST}:${LOOPBACK_PORT}`));
        return;
      }
      reject(new Error(`loopback_bind_failure:${P_URL_DRIFT_PROBE_ID}:${error.message}`));
    });
    server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => resolve());
  });
}

async function closeServerIfPresent(server: Server | null): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if ((error as NodeJS.ErrnoException | null)?.code === "ERR_SERVER_NOT_RUNNING") {
        resolve();
        return;
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function applyRouteEnv(): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(P_URL_DRIFT_ROUTE_ENV)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  for (const key of P_URL_DRIFT_CLEARED_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  return () => {
    for (const [key, oldValue] of previous.entries()) {
      if (typeof oldValue === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  };
}

function evictRouteModulesFromRequireCache(): void {
  const cache = (Module as unknown as { _cache: Record<string, unknown> })._cache;
  for (const key of Object.keys(cache)) {
    const normalized = key.replaceAll("\\", "/");
    if (ROUTE_MODULE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
      delete cache[key];
    }
  }
}

let pUrlDriftRouteImportNonce = 0;

// Both production route modules capture their model/generation dependencies at
// module load time, and a plain specifier import would return whichever
// previously loaded instance the ESM registry memoized (potentially bound to
// another harness's tripwires). Loading a fresh instance through a
// nonce-suffixed file URL, with the CommonJS cache entries evicted, guarantees
// THIS harness's P-url-drift tripwires and admin/request-id mocks are the ones
// bound. Cleanup evicts again so no P-url-drift-bound route instance leaks
// into later consumers.
async function importFreshRouteModuleBoundToPurlDriftMocks(
  routeRepoRelativePath: string
): Promise<{ POST: (request: Request) => Promise<Response> }> {
  evictRouteModulesFromRequireCache();
  pUrlDriftRouteImportNonce += 1;
  const routeAbsolutePath = path.join(process.cwd(), routeRepoRelativePath);
  const freshRouteUrl = `${pathToFileURL(routeAbsolutePath).href}?g0PurlDriftRouteInstance=${pUrlDriftRouteImportNonce}`;
  return (await import(freshRouteUrl)) as {
    POST: (request: Request) => Promise<Response>;
  };
}

type InstalledPurlDriftMocks = {
  adminServer: { getAuthenticatedAdminUser: () => Promise<{ id: string }> };
  usageAccounting: { getRequestIdFromHeaders: () => string };
  visionDetect: { detectFloorFromVerifiedBytes: () => Promise<never> };
  emptyRoomAssist: { getOrGenerateEmptyRoomImage: () => Promise<never> };
};

function installPatchedModuleLoad(input: {
  originalLoad: ModuleLoad;
  requestId: string;
}): InstalledPurlDriftMocks {
  const mocks: InstalledPurlDriftMocks = {
    adminServer: {
      getAuthenticatedAdminUser: async () => ({ id: "g0-p-url-drift-admin" }),
    },
    usageAccounting: {
      getRequestIdFromHeaders: () => input.requestId,
    },
    visionDetect: {
      detectFloorFromVerifiedBytes: async () => visionModelTripwireDelegator(),
    },
    emptyRoomAssist: {
      getOrGenerateEmptyRoomImage: async () => emptyRoomGenerationTripwireDelegator(),
    },
  };
  (Module as unknown as { _load: ModuleLoad })._load = function patched(
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request === "@/lib/adminServer") {
      return mocks.adminServer;
    }
    if (request === "@/lib/vibodeGeminiUsageAccounting") {
      return mocks.usageAccounting;
    }
    if (request === "@/lib/vibodeAutoFloorVisionDetect") {
      return mocks.visionDetect;
    }
    if (request === "@/lib/vibodeEmptyRoomAssist") {
      return mocks.emptyRoomAssist;
    }
    return input.originalLoad.call(this, request, parent, isMain);
  };
  return mocks;
}

// Positive identity proof that THIS harness's tripwire mocks are the ones any
// fresh route evaluation will bind, without invoking the tripwires themselves.
function assertPurlDriftMocksInstalled(mocks: InstalledPurlDriftMocks): void {
  const loadFn = (Module as unknown as { _load: ModuleLoad })._load;
  const visionMock = loadFn.call(Module, "@/lib/vibodeAutoFloorVisionDetect", null, false) as {
    detectFloorFromVerifiedBytes?: unknown;
  };
  if (visionMock.detectFloorFromVerifiedBytes !== mocks.visionDetect.detectFloorFromVerifiedBytes) {
    throw new Error(`vision_tripwire_not_installed:${P_URL_DRIFT_PROBE_ID}`);
  }
  const assistMock = loadFn.call(Module, "@/lib/vibodeEmptyRoomAssist", null, false) as {
    getOrGenerateEmptyRoomImage?: unknown;
  };
  if (assistMock.getOrGenerateEmptyRoomImage !== mocks.emptyRoomAssist.getOrGenerateEmptyRoomImage) {
    throw new Error(`generation_tripwire_not_installed:${P_URL_DRIFT_PROBE_ID}`);
  }
}

type VerifiedDriftAssets = {
  parentDigest: string;
  driftDigest: string;
  driftAbsolutePath: string;
};

async function verifyResolverBoundDriftAssets(input: {
  canonicalAParentRepoRelativePath: string;
  canonicalADriftRepoRelativePath: string;
}): Promise<VerifiedDriftAssets> {
  const parentAbsolutePath = path.join(process.cwd(), input.canonicalAParentRepoRelativePath);
  const normalizedParentPath = path.resolve(parentAbsolutePath).replaceAll("\\", "/");
  assertProbeLabelled(
    normalizedParentPath.endsWith(A_PARENT_CANONICAL_SUFFIX),
    `canonical_a_parent_path_missing:${P_URL_DRIFT_PROBE_ID}`
  );
  const driftAbsolutePath = path.join(process.cwd(), input.canonicalADriftRepoRelativePath);
  const normalizedDriftPath = path.resolve(driftAbsolutePath).replaceAll("\\", "/");
  assertProbeLabelled(
    normalizedDriftPath.endsWith(A_DRIFT_B_CANONICAL_SUFFIX),
    `canonical_a_drift_b_path_missing:${P_URL_DRIFT_PROBE_ID}`
  );

  const parentRegistry = G0_SYNTHETIC_ASSETS["A-parent"];
  const driftRegistry = G0_SYNTHETIC_ASSETS["A-drift-b"];

  const parentBytes = await readFile(parentAbsolutePath);
  const parentDigest = computeCalibrationImageFingerprint(parentBytes);
  if (parentDigest !== parentRegistry.sha256) {
    throw new Error(`loopback_parent_digest_drift:${P_URL_DRIFT_PROBE_ID}`);
  }

  const driftBytes = await readFile(driftAbsolutePath);
  const driftDigest = computeCalibrationImageFingerprint(driftBytes);
  if (driftDigest !== driftRegistry.sha256) {
    throw new Error(`loopback_drift_digest_drift:${P_URL_DRIFT_PROBE_ID}`);
  }
  if (parentDigest === driftDigest) {
    throw new Error(`parent_and_drift_digests_equal:${P_URL_DRIFT_PROBE_ID}`);
  }
  if (driftRegistry.parentAssetId !== "A-parent") {
    throw new Error(`drift_parent_lineage_drift:${P_URL_DRIFT_PROBE_ID}`);
  }

  const driftMetadata = await inspectImageMetadata(driftBytes);
  assertProbeLabelled(driftMetadata.ok, `drift_metadata_unreadable:${P_URL_DRIFT_PROBE_ID}`);
  if (driftMetadata.orientation !== 1 || !driftRegistry.decodedOrientationNormal) {
    throw new Error(`drift_orientation_not_normal:${P_URL_DRIFT_PROBE_ID}`);
  }
  if (
    driftMetadata.width !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width ||
    driftMetadata.height !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height ||
    driftRegistry.decodedWidth !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width ||
    driftRegistry.decodedHeight !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height ||
    parentRegistry.decodedWidth !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width ||
    parentRegistry.decodedHeight !== P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height
  ) {
    throw new Error(`pinned_dimensions_not_matching:${P_URL_DRIFT_PROBE_ID}`);
  }
  return { parentDigest, driftDigest, driftAbsolutePath };
}

function buildDetectVisionPostRequest(expectedBasisFingerprint: string): Request {
  return new Request("http://localhost/api/admin/3d-room-lab/auto-floor/detect-vision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageUrl: P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL,
      frameSize: {
        width: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width,
        height: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height,
      },
      intrinsicSize: {
        width: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width,
        height: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height,
      },
      floorRect: { widthMeters: 4, depthMeters: 4 },
      expectedBasisFingerprint,
    }),
  });
}

function buildEmptyRoomPostRequest(expectedBasisFingerprint: string): Request {
  return new Request("http://localhost/api/admin/3d-room-lab/empty-room-assist/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageUrl: P_URL_DRIFT_PINNED_SOURCE_IMAGE_URL,
      frameSize: {
        width: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width,
        height: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height,
      },
      intrinsicSize: {
        width: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.width,
        height: P_URL_DRIFT_PINNED_MATCHING_DIMENSIONS.height,
      },
      floorRect: { widthMeters: 4, depthMeters: 4 },
      expectedBasisFingerprint,
    }),
  });
}

export type PurlDriftDualRouteMismatchObservation = {
  expectedBasisFingerprintSent: string;
  vision: {
    httpStatus: 200;
    responseStatus: "failed";
    candidatesLength: 0;
    selectedCandidateId: null;
    notesLength: 0;
    failureReasons: readonly [typeof REQUIRED_ROUTE_TOKEN];
    attestedBasisFingerprint: string;
    servedRequestPaths: readonly string[];
    modelTripwireInstalled: true;
    modelTripwireInvoked: false;
  };
  emptyRoom: {
    httpStatus: 200;
    emptyRoomAssistStatus: "blocked";
    failureReason: typeof REQUIRED_ROUTE_TOKEN;
    policyReasons: readonly [typeof REQUIRED_ROUTE_TOKEN];
    attestedOriginalBasisFingerprint: string;
    attestedEmptyBasisFingerprint: null;
    calibratedCameraEligible: false;
    surfacedResult: null;
    originalResult: null;
    emptyResult: null;
    servedRequestPaths: readonly string[];
    generationTripwireInstalled: true;
    generationTripwireInvoked: false;
    detectionTripwireInstalled: true;
    detectionTripwireInvoked: false;
  };
};

export async function observePurlDriftDualRouteMismatchContainment(input: {
  expectedParentBasisFingerprint: string;
  canonicalAParentRepoRelativePath: string;
  canonicalADriftRepoRelativePath: string;
}): Promise<PurlDriftDualRouteMismatchObservation> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`production_runtime_forbidden:${P_URL_DRIFT_PROBE_ID}`);
  }
  if (dualRouteHarnessActive) {
    throw new Error(`route_harness_reentry_forbidden:${P_URL_DRIFT_PROBE_ID}`);
  }
  dualRouteHarnessActive = true;

  let visionServer: Server | null = null;
  let emptyRoomServer: Server | null = null;
  let restoreEnv: (() => void) | null = null;
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const previousTripwireState = activeTripwireState;
  const tripwireState: ActiveTripwireState = {
    visionModelTripwireInvoked: false,
    emptyRoomGenerationTripwireInvoked: false,
    boundaryInvocationOrder: [],
  };

  try {
    const verified = await verifyResolverBoundDriftAssets(input);
    if (input.expectedParentBasisFingerprint !== verified.parentDigest) {
      throw new Error(`expected_parent_digest_drift:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (input.expectedParentBasisFingerprint === verified.driftDigest) {
      throw new Error(`expected_parent_digest_equals_drift:${P_URL_DRIFT_PROBE_ID}`);
    }

    restoreEnv = applyRouteEnv();
    activeTripwireState = tripwireState;
    const mocks = installPatchedModuleLoad({
      originalLoad,
      requestId: "g0-p-url-drift-route-request-id",
    });
    assertPurlDriftMocksInstalled(mocks);

    // --- Observation A: detect-vision (bind -> observe -> close) -------------
    const visionServedRequestPaths: string[] = [];
    const visionServeFailures: string[] = [];
    visionServer = createServer(
      createPurlDriftLoopbackRequestHandler({
        canonicalDriftAbsolutePath: verified.driftAbsolutePath,
        expectedServedDriftDigest: verified.driftDigest,
        expectedParentBasisFingerprint: input.expectedParentBasisFingerprint,
        servedRequestPaths: visionServedRequestPaths,
        serveFailures: visionServeFailures,
      })
    );
    await bindLoopbackServer(visionServer);

    const visionRoute = await importFreshRouteModuleBoundToPurlDriftMocks(
      DETECT_VISION_ROUTE_REPO_RELATIVE_PATH
    );
    const visionResponse = await visionRoute.POST(
      buildDetectVisionPostRequest(input.expectedParentBasisFingerprint)
    );
    if (visionServeFailures.length > 0) {
      throw new Error(visionServeFailures[0]);
    }
    if (visionResponse.status !== 200) {
      throw new Error(
        `vision_unexpected_http_status:${P_URL_DRIFT_PROBE_ID}:${visionResponse.status}`
      );
    }
    const visionBody = (await visionResponse.json()) as {
      status?: unknown;
      candidates?: unknown;
      selectedCandidateId?: unknown;
      notes?: unknown;
      failureReasons?: unknown;
      attestedBasisFingerprint?: unknown;
    };
    if (visionBody.status !== "failed") {
      throw new Error(
        `vision_unexpected_route_status:${P_URL_DRIFT_PROBE_ID}:${String(visionBody.status)}`
      );
    }
    if (!Array.isArray(visionBody.candidates) || visionBody.candidates.length !== 0) {
      throw new Error(`vision_unexpected_route_candidates:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (visionBody.selectedCandidateId !== null) {
      throw new Error(`vision_unexpected_selected_candidate:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (!Array.isArray(visionBody.notes) || visionBody.notes.length !== 0) {
      throw new Error(`vision_unexpected_route_notes:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      !Array.isArray(visionBody.failureReasons) ||
      visionBody.failureReasons.length !== 1 ||
      visionBody.failureReasons[0] !== REQUIRED_ROUTE_TOKEN
    ) {
      throw new Error(`vision_route_token_missing:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (visionBody.attestedBasisFingerprint !== verified.driftDigest) {
      throw new Error(`vision_route_attested_fingerprint_mismatch:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      visionServedRequestPaths.length !== 1 ||
      visionServedRequestPaths[0] !== `GET /${P_URL_DRIFT_SERVED_FILE_NAME}`
    ) {
      throw new Error(`vision_unexpected_served_request_paths:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (tripwireState.visionModelTripwireInvoked) {
      throw new Error(`detect_vision_model_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`);
    }

    await closeServerIfPresent(visionServer);
    visionServer = null;

    // --- Observation B: empty-room-assist/run (bind -> observe -> close) -----
    const emptyRoomServedRequestPaths: string[] = [];
    const emptyRoomServeFailures: string[] = [];
    emptyRoomServer = createServer(
      createPurlDriftLoopbackRequestHandler({
        canonicalDriftAbsolutePath: verified.driftAbsolutePath,
        expectedServedDriftDigest: verified.driftDigest,
        expectedParentBasisFingerprint: input.expectedParentBasisFingerprint,
        servedRequestPaths: emptyRoomServedRequestPaths,
        serveFailures: emptyRoomServeFailures,
      })
    );
    await bindLoopbackServer(emptyRoomServer);

    const emptyRoomRoute = await importFreshRouteModuleBoundToPurlDriftMocks(
      EMPTY_ROOM_ROUTE_REPO_RELATIVE_PATH
    );
    const emptyRoomResponse = await emptyRoomRoute.POST(
      buildEmptyRoomPostRequest(input.expectedParentBasisFingerprint)
    );
    if (emptyRoomServeFailures.length > 0) {
      throw new Error(emptyRoomServeFailures[0]);
    }
    if (emptyRoomResponse.status !== 200) {
      throw new Error(
        `empty_room_unexpected_http_status:${P_URL_DRIFT_PROBE_ID}:${emptyRoomResponse.status}`
      );
    }
    const emptyRoomBody = (await emptyRoomResponse.json()) as {
      assist?: {
        emptyRoomAssistStatus?: unknown;
        emptyRoomCacheStatus?: unknown;
        failureReason?: unknown;
        policyReasons?: unknown;
        attestedOriginalBasisFingerprint?: unknown;
        attestedEmptyBasisFingerprint?: unknown;
        calibratedCameraEligible?: unknown;
      };
      surfacedResult?: unknown;
      originalResult?: unknown;
      emptyResult?: unknown;
    };
    const assist = emptyRoomBody.assist;
    if (!assist || assist.emptyRoomAssistStatus !== "blocked") {
      throw new Error(
        `empty_room_unexpected_status:${P_URL_DRIFT_PROBE_ID}:${String(assist?.emptyRoomAssistStatus)}`
      );
    }
    if (assist.failureReason !== REQUIRED_ROUTE_TOKEN) {
      throw new Error(`empty_room_route_token_missing:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      !Array.isArray(assist.policyReasons) ||
      assist.policyReasons.length !== 1 ||
      assist.policyReasons[0] !== REQUIRED_ROUTE_TOKEN
    ) {
      throw new Error(`empty_room_policy_reasons_token_missing:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (assist.attestedOriginalBasisFingerprint !== verified.driftDigest) {
      throw new Error(
        `empty_room_route_attested_fingerprint_mismatch:${P_URL_DRIFT_PROBE_ID}`
      );
    }
    if (assist.attestedEmptyBasisFingerprint !== null) {
      throw new Error(`empty_room_unexpected_empty_fingerprint:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (assist.emptyRoomCacheStatus !== "not_used") {
      throw new Error(`empty_room_unexpected_cache_status:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (assist.calibratedCameraEligible !== false) {
      throw new Error(`empty_room_unexpected_eligibility:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      emptyRoomBody.surfacedResult !== null ||
      emptyRoomBody.originalResult !== null ||
      emptyRoomBody.emptyResult !== null
    ) {
      throw new Error(`empty_room_unexpected_result_payloads:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      emptyRoomServedRequestPaths.length !== 1 ||
      emptyRoomServedRequestPaths[0] !== `GET /${P_URL_DRIFT_SERVED_FILE_NAME}`
    ) {
      throw new Error(`empty_room_unexpected_served_request_paths:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (tripwireState.emptyRoomGenerationTripwireInvoked) {
      throw new Error(`empty_room_generation_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (tripwireState.visionModelTripwireInvoked) {
      throw new Error(`detect_vision_model_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`);
    }

    return {
      expectedBasisFingerprintSent: input.expectedParentBasisFingerprint,
      vision: {
        httpStatus: 200,
        responseStatus: "failed",
        candidatesLength: 0,
        selectedCandidateId: null,
        notesLength: 0,
        failureReasons: [REQUIRED_ROUTE_TOKEN],
        attestedBasisFingerprint: verified.driftDigest,
        servedRequestPaths: visionServedRequestPaths,
        modelTripwireInstalled: true,
        modelTripwireInvoked: false,
      },
      emptyRoom: {
        httpStatus: 200,
        emptyRoomAssistStatus: "blocked",
        failureReason: REQUIRED_ROUTE_TOKEN,
        policyReasons: [REQUIRED_ROUTE_TOKEN],
        attestedOriginalBasisFingerprint: verified.driftDigest,
        attestedEmptyBasisFingerprint: null,
        calibratedCameraEligible: false,
        surfacedResult: null,
        originalResult: null,
        emptyResult: null,
        servedRequestPaths: emptyRoomServedRequestPaths,
        generationTripwireInstalled: true,
        generationTripwireInvoked: false,
        detectionTripwireInstalled: true,
        detectionTripwireInvoked: false,
      },
    };
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = originalLoad;
    evictRouteModulesFromRequireCache();
    if (restoreEnv) {
      restoreEnv();
    }
    activeTripwireState = previousTripwireState;
    await closeServerIfPresent(visionServer);
    await closeServerIfPresent(emptyRoomServer);
    dualRouteHarnessActive = false;
  }
}

// Positive control: serve the same digest-verified A-drift-b bytes but send the
// A-drift-b digest itself as the expected fingerprint, so the fingerprint check
// passes and the route must reach the vision model boundary tripwire. Together
// with the mismatch observation above (identical bytes, identical dimensions,
// identical orientation, the expected fingerprint being the only differing
// input), this proves the fingerprint-mismatch branch - not another guard -
// stopped model execution during the mismatch observation.
export async function observePurlDriftDetectVisionMatchingFingerprintControl(input: {
  expectedDriftBasisFingerprint: string;
  canonicalAParentRepoRelativePath: string;
  canonicalADriftRepoRelativePath: string;
}): Promise<{
  modelTripwireInvoked: true;
  servedRequestPaths: readonly string[];
}> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`production_runtime_forbidden:${P_URL_DRIFT_PROBE_ID}`);
  }
  if (dualRouteHarnessActive) {
    throw new Error(`route_harness_reentry_forbidden:${P_URL_DRIFT_PROBE_ID}`);
  }
  dualRouteHarnessActive = true;

  let server: Server | null = null;
  let restoreEnv: (() => void) | null = null;
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const previousTripwireState = activeTripwireState;
  const tripwireState: ActiveTripwireState = {
    visionModelTripwireInvoked: false,
    emptyRoomGenerationTripwireInvoked: false,
    boundaryInvocationOrder: [],
  };

  try {
    const verified = await verifyResolverBoundDriftAssets(input);
    if (input.expectedDriftBasisFingerprint !== verified.driftDigest) {
      throw new Error(`control_expected_digest_drift:${P_URL_DRIFT_PROBE_ID}`);
    }

    const servedRequestPaths: string[] = [];
    const serveFailures: string[] = [];
    server = createServer(
      createPurlDriftLoopbackRequestHandler({
        canonicalDriftAbsolutePath: verified.driftAbsolutePath,
        expectedServedDriftDigest: verified.driftDigest,
        expectedParentBasisFingerprint: null,
        servedRequestPaths,
        serveFailures,
      })
    );
    await bindLoopbackServer(server);

    restoreEnv = applyRouteEnv();
    activeTripwireState = tripwireState;
    const mocks = installPatchedModuleLoad({
      originalLoad,
      requestId: "g0-p-url-drift-vision-control-request-id",
    });
    assertPurlDriftMocksInstalled(mocks);

    const route = await importFreshRouteModuleBoundToPurlDriftMocks(
      DETECT_VISION_ROUTE_REPO_RELATIVE_PATH
    );
    let tripwireThrew = false;
    try {
      await route.POST(buildDetectVisionPostRequest(input.expectedDriftBasisFingerprint));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `detect_vision_model_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`
      ) {
        tripwireThrew = true;
      } else {
        throw error;
      }
    }
    if (serveFailures.length > 0) {
      throw new Error(serveFailures[0]);
    }
    if (!tripwireThrew || tripwireState.visionModelTripwireInvoked !== true) {
      throw new Error(`control_model_boundary_not_reached:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      servedRequestPaths.length !== 1 ||
      servedRequestPaths[0] !== `GET /${P_URL_DRIFT_SERVED_FILE_NAME}`
    ) {
      throw new Error(`vision_unexpected_served_request_paths:${P_URL_DRIFT_PROBE_ID}`);
    }

    return {
      modelTripwireInvoked: true,
      servedRequestPaths,
    };
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = originalLoad;
    evictRouteModulesFromRequireCache();
    if (restoreEnv) {
      restoreEnv();
    }
    activeTripwireState = previousTripwireState;
    await closeServerIfPresent(server);
    dualRouteHarnessActive = false;
  }
}

// Positive control for the empty-room route: with matching expected/served
// fingerprints the mismatch branch cannot fire, so the first boundary reached
// must be the empty-room generation tripwire (and never the detection
// tripwire, which sits behind generation).
export async function observePurlDriftEmptyRoomMatchingFingerprintControl(input: {
  expectedDriftBasisFingerprint: string;
  canonicalAParentRepoRelativePath: string;
  canonicalADriftRepoRelativePath: string;
}): Promise<{
  generationTripwireInvoked: true;
  generationTripwireReachedFirst: true;
  detectionTripwireInvoked: false;
  servedRequestPaths: readonly string[];
}> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`production_runtime_forbidden:${P_URL_DRIFT_PROBE_ID}`);
  }
  if (dualRouteHarnessActive) {
    throw new Error(`route_harness_reentry_forbidden:${P_URL_DRIFT_PROBE_ID}`);
  }
  dualRouteHarnessActive = true;

  let server: Server | null = null;
  let restoreEnv: (() => void) | null = null;
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const previousTripwireState = activeTripwireState;
  const tripwireState: ActiveTripwireState = {
    visionModelTripwireInvoked: false,
    emptyRoomGenerationTripwireInvoked: false,
    boundaryInvocationOrder: [],
  };

  try {
    const verified = await verifyResolverBoundDriftAssets(input);
    if (input.expectedDriftBasisFingerprint !== verified.driftDigest) {
      throw new Error(`control_expected_digest_drift:${P_URL_DRIFT_PROBE_ID}`);
    }

    const servedRequestPaths: string[] = [];
    const serveFailures: string[] = [];
    server = createServer(
      createPurlDriftLoopbackRequestHandler({
        canonicalDriftAbsolutePath: verified.driftAbsolutePath,
        expectedServedDriftDigest: verified.driftDigest,
        expectedParentBasisFingerprint: null,
        servedRequestPaths,
        serveFailures,
      })
    );
    await bindLoopbackServer(server);

    restoreEnv = applyRouteEnv();
    activeTripwireState = tripwireState;
    const mocks = installPatchedModuleLoad({
      originalLoad,
      requestId: "g0-p-url-drift-empty-room-control-request-id",
    });
    assertPurlDriftMocksInstalled(mocks);

    const route = await importFreshRouteModuleBoundToPurlDriftMocks(
      EMPTY_ROOM_ROUTE_REPO_RELATIVE_PATH
    );
    let tripwireThrew = false;
    try {
      await route.POST(buildEmptyRoomPostRequest(input.expectedDriftBasisFingerprint));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `empty_room_generation_tripwire_reached:${P_URL_DRIFT_PROBE_ID}`
      ) {
        tripwireThrew = true;
      } else {
        throw error;
      }
    }
    if (serveFailures.length > 0) {
      throw new Error(serveFailures[0]);
    }
    if (!tripwireThrew || tripwireState.emptyRoomGenerationTripwireInvoked !== true) {
      throw new Error(`control_generation_boundary_not_reached:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (tripwireState.visionModelTripwireInvoked !== false) {
      throw new Error(`control_detection_boundary_unexpectedly_reached:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      tripwireState.boundaryInvocationOrder.length !== 1 ||
      tripwireState.boundaryInvocationOrder[0] !== "getOrGenerateEmptyRoomImage"
    ) {
      throw new Error(`control_boundary_order_unexpected:${P_URL_DRIFT_PROBE_ID}`);
    }
    if (
      servedRequestPaths.length !== 1 ||
      servedRequestPaths[0] !== `GET /${P_URL_DRIFT_SERVED_FILE_NAME}`
    ) {
      throw new Error(`empty_room_unexpected_served_request_paths:${P_URL_DRIFT_PROBE_ID}`);
    }

    return {
      generationTripwireInvoked: true,
      generationTripwireReachedFirst: true,
      detectionTripwireInvoked: false,
      servedRequestPaths,
    };
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = originalLoad;
    evictRouteModulesFromRequireCache();
    if (restoreEnv) {
      restoreEnv();
    }
    activeTripwireState = previousTripwireState;
    await closeServerIfPresent(server);
    dualRouteHarnessActive = false;
  }
}
