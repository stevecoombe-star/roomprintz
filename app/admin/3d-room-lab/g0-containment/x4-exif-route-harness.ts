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

// X4-specific bounded route-supporting observation module. This module is
// deliberately not shared with, derived from, or generalized over the
// completed P-dimension harness.

const X4_PROBE_ID = "X4";
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 3000;
const REQUIRED_ROUTE_FAILURE_REASON =
  "This image orientation is not yet supported for vision calibration." as const;

const ROUTE_ENV: Readonly<Record<string, string>> = {
  AUTO_FLOOR_VISION_ENABLED: "true",
  GEMINI_API_KEY: "g0-placeholder-key-presence-only",
  AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP: "true",
  AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS: "g0-loopback-only.invalid",
};

const A_EXIF_CANONICAL_SUFFIX =
  "/app/admin/3d-room-lab/g0-containment/synthetic-assets/A-exif.jpg";
const A_PARENT_CANONICAL_SUFFIX =
  "/app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg";

export const X4_PINNED_MATCHING_DIMENSIONS = {
  width: 320,
  height: 240,
} as const;

type ActiveTripwireState = {
  modelTripwireInvoked: boolean;
};

let routeHarnessActive = false;
let activeTripwireState: ActiveTripwireState | null = null;

function modelTripwireDelegator(): never {
  if (activeTripwireState) {
    activeTripwireState.modelTripwireInvoked = true;
  }
  throw new Error(`model_tripwire_reached:${X4_PROBE_ID}`);
}

function assertProbeLabelled(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function createX4LoopbackRequestHandler(input: {
  servedFileName: string;
  bytes: Buffer;
  servedRequestPaths: string[];
}): (request: IncomingMessage, response: ServerResponse) => void {
  const allowedPath = `/${input.servedFileName}`;
  return (request, response) => {
    const method = request.method ?? "UNKNOWN";
    const requestPath = new URL(
      request.url ?? "/",
      `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`
    ).pathname;
    input.servedRequestPaths.push(`${method} ${requestPath}`);

    if (method === "GET" && requestPath === allowedPath) {
      response.setHeader("content-type", "image/jpeg");
      response.setHeader("content-length", String(input.bytes.byteLength));
      response.writeHead(200).end(input.bytes);
      return;
    }
    response.writeHead(404).end("not-found");
  };
}

async function bindLoopbackServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`loopback_port_in_use:${LOOPBACK_HOST}:${LOOPBACK_PORT}`));
        return;
      }
      reject(new Error(`loopback_bind_failure:${X4_PROBE_ID}:${error.message}`));
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
  for (const [key, value] of Object.entries(ROUTE_ENV)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
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

const ROUTE_MODULE_REPO_RELATIVE_PATH =
  "app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts";
const ROUTE_MODULE_SUFFIX = `/${ROUTE_MODULE_REPO_RELATIVE_PATH}`;

function evictRouteModuleFromRequireCache(): void {
  const cache = (Module as unknown as { _cache: Record<string, unknown> })._cache;
  for (const key of Object.keys(cache)) {
    if (key.replaceAll("\\", "/").endsWith(ROUTE_MODULE_SUFFIX)) {
      delete cache[key];
    }
  }
}

let x4RouteImportNonce = 0;

// The route module captures its `detectFloorFromVerifiedBytes` binding at load
// time, and a plain specifier import would return whatever previously loaded
// instance the ESM registry memoized (potentially bound to another harness's
// tripwire). Loading a fresh instance through a nonce-suffixed file URL, with
// the CommonJS cache entry evicted, guarantees THIS harness's X4 tripwire and
// admin/request-id mocks are the ones bound. Cleanup evicts again so no
// X4-bound route instance leaks into later consumers.
async function importFreshRouteModuleBoundToX4Mocks(): Promise<{
  POST: (request: Request) => Promise<Response>;
}> {
  evictRouteModuleFromRequireCache();
  x4RouteImportNonce += 1;
  const routeAbsolutePath = path.join(process.cwd(), ROUTE_MODULE_REPO_RELATIVE_PATH);
  const freshRouteUrl = `${pathToFileURL(routeAbsolutePath).href}?g0X4RouteInstance=${x4RouteImportNonce}`;
  return (await import(freshRouteUrl)) as { POST: (request: Request) => Promise<Response> };
}

function installPatchedModuleLoad(input: {
  originalLoad: Function;
  requestId: string;
}): void {
  (Module as unknown as { _load: Function })._load = function patched(
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request === "@/lib/adminServer") {
      return {
        getAuthenticatedAdminUser: async () => ({ id: "g0-deterministic-admin" }),
      };
    }
    if (request === "@/lib/vibodeGeminiUsageAccounting") {
      return {
        getRequestIdFromHeaders: () => input.requestId,
      };
    }
    if (request === "@/lib/vibodeAutoFloorVisionDetect") {
      return {
        detectFloorFromVerifiedBytes: async () => modelTripwireDelegator(),
      };
    }
    return input.originalLoad.call(this, request, parent, isMain);
  };
}

function buildRoutePostRequest(input: {
  servedFileName: string;
  expectedBasisFingerprint: string;
}): Request {
  return new Request("http://localhost/api/admin/3d-room-lab/auto-floor/detect-vision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageUrl: `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/${input.servedFileName}`,
      frameSize: {
        width: X4_PINNED_MATCHING_DIMENSIONS.width,
        height: X4_PINNED_MATCHING_DIMENSIONS.height,
      },
      intrinsicSize: {
        width: X4_PINNED_MATCHING_DIMENSIONS.width,
        height: X4_PINNED_MATCHING_DIMENSIONS.height,
      },
      floorRect: { widthMeters: 4, depthMeters: 4 },
      expectedBasisFingerprint: input.expectedBasisFingerprint,
    }),
  });
}

export async function observeX4ExifOrientationRouteContainment(input: {
  expectedBasisFingerprint: string;
  canonicalAExifRepoRelativePath: string;
}): Promise<{
  httpStatus: 200;
  responseStatus: "failed";
  candidatesLength: 0;
  selectedCandidateId: null;
  notesLength: 0;
  failureReason: "This image orientation is not yet supported for vision calibration.";
  attestedBasisFingerprint: string;
  servedRequestPaths: readonly string[];
  modelTripwireInvoked: false;
}> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`production_runtime_forbidden:${X4_PROBE_ID}`);
  }
  if (routeHarnessActive) {
    throw new Error(`route_harness_reentry_forbidden:${X4_PROBE_ID}`);
  }
  routeHarnessActive = true;

  let server: Server | null = null;
  let restoreEnv: (() => void) | null = null;
  const originalLoad = (Module as unknown as { _load: Function })._load;
  const previousTripwireState = activeTripwireState;
  const tripwireState: ActiveTripwireState = { modelTripwireInvoked: false };

  try {
    const canonicalAbsolutePath = path.join(
      process.cwd(),
      input.canonicalAExifRepoRelativePath
    );
    const normalizedAbsolutePath = path.resolve(canonicalAbsolutePath).replaceAll("\\", "/");
    assertProbeLabelled(
      normalizedAbsolutePath.endsWith(A_EXIF_CANONICAL_SUFFIX),
      `canonical_a_exif_path_missing:${X4_PROBE_ID}`
    );

    const registryAsset = G0_SYNTHETIC_ASSETS["A-exif"];
    const bytes = await readFile(canonicalAbsolutePath);
    const digest = computeCalibrationImageFingerprint(bytes);
    if (digest !== registryAsset.sha256 || digest !== input.expectedBasisFingerprint) {
      throw new Error(`loopback_fixture_digest_drift:${X4_PROBE_ID}`);
    }

    const metadata = await inspectImageMetadata(bytes);
    assertProbeLabelled(metadata.ok, `fixture_metadata_unreadable:${X4_PROBE_ID}`);
    if (metadata.orientation === 1 || registryAsset.decodedOrientationNormal) {
      throw new Error(`fixture_orientation_unexpectedly_normal:${X4_PROBE_ID}`);
    }
    if (
      metadata.width !== X4_PINNED_MATCHING_DIMENSIONS.width ||
      metadata.height !== X4_PINNED_MATCHING_DIMENSIONS.height ||
      registryAsset.decodedWidth !== X4_PINNED_MATCHING_DIMENSIONS.width ||
      registryAsset.decodedHeight !== X4_PINNED_MATCHING_DIMENSIONS.height
    ) {
      throw new Error(`pinned_dimensions_not_matching:${X4_PROBE_ID}`);
    }

    const servedRequestPaths: string[] = [];
    server = createServer(
      createX4LoopbackRequestHandler({
        servedFileName: "A-exif.jpg",
        bytes,
        servedRequestPaths,
      })
    );
    await bindLoopbackServer(server);

    restoreEnv = applyRouteEnv();
    activeTripwireState = tripwireState;
    installPatchedModuleLoad({ originalLoad, requestId: "g0-x4-exif-route-request-id" });

    const route = await importFreshRouteModuleBoundToX4Mocks();
    const response = await route.POST(
      buildRoutePostRequest({
        servedFileName: "A-exif.jpg",
        expectedBasisFingerprint: input.expectedBasisFingerprint,
      })
    );
    if (response.status !== 200) {
      throw new Error(`unexpected_http_status:${X4_PROBE_ID}:${response.status}`);
    }
    const body = (await response.json()) as {
      status?: unknown;
      candidates?: unknown;
      selectedCandidateId?: unknown;
      notes?: unknown;
      failureReasons?: unknown;
      attestedBasisFingerprint?: unknown;
    };
    if (body.status !== "failed") {
      throw new Error(`unexpected_route_status:${X4_PROBE_ID}:${String(body.status)}`);
    }
    if (!Array.isArray(body.candidates) || body.candidates.length !== 0) {
      throw new Error(`unexpected_route_candidates:${X4_PROBE_ID}`);
    }
    if (body.selectedCandidateId !== null) {
      throw new Error(`unexpected_selected_candidate:${X4_PROBE_ID}`);
    }
    if (!Array.isArray(body.notes) || body.notes.length !== 0) {
      throw new Error(`unexpected_route_notes:${X4_PROBE_ID}`);
    }
    if (!Array.isArray(body.failureReasons)) {
      throw new Error(`missing_failure_reasons:${X4_PROBE_ID}`);
    }
    if (
      body.failureReasons.length !== 1 ||
      body.failureReasons[0] !== REQUIRED_ROUTE_FAILURE_REASON
    ) {
      throw new Error(`unexpected_route_failure_reason:${X4_PROBE_ID}`);
    }
    if (body.attestedBasisFingerprint !== input.expectedBasisFingerprint) {
      throw new Error(`route_attested_fingerprint_mismatch:${X4_PROBE_ID}`);
    }
    if (servedRequestPaths.length !== 1 || servedRequestPaths[0] !== "GET /A-exif.jpg") {
      throw new Error(`unexpected_served_request_paths:${X4_PROBE_ID}`);
    }
    if (tripwireState.modelTripwireInvoked) {
      throw new Error(`model_tripwire_reached:${X4_PROBE_ID}`);
    }

    return {
      httpStatus: 200,
      responseStatus: "failed",
      candidatesLength: 0,
      selectedCandidateId: null,
      notesLength: 0,
      failureReason: REQUIRED_ROUTE_FAILURE_REASON,
      attestedBasisFingerprint: input.expectedBasisFingerprint,
      servedRequestPaths,
      modelTripwireInvoked: false,
    };
  } finally {
    (Module as unknown as { _load: Function })._load = originalLoad;
    evictRouteModuleFromRequireCache();
    if (restoreEnv) {
      restoreEnv();
    }
    activeTripwireState = previousTripwireState;
    await closeServerIfPresent(server);
    routeHarnessActive = false;
  }
}

// Positive control: normal-orientation A-parent bytes with the same pinned
// matching 320x240 dimensions must pass the route's orientation and dimension
// guards and reach the model boundary tripwire. Together with the A-exif
// observation above (identical dimensions, identical fingerprint discipline,
// orientation being the only differing axis), this proves the X4 orientation
// branch - not a dimension mismatch or another guard - is what prevented
// model execution for A-exif.
export async function observeX4NormalOrientationRoutePreemptionControl(input: {
  expectedParentBasisFingerprint: string;
  canonicalAParentRepoRelativePath: string;
}): Promise<{
  modelTripwireInvoked: true;
  servedRequestPaths: readonly string[];
}> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`production_runtime_forbidden:${X4_PROBE_ID}`);
  }
  if (routeHarnessActive) {
    throw new Error(`route_harness_reentry_forbidden:${X4_PROBE_ID}`);
  }
  routeHarnessActive = true;

  let server: Server | null = null;
  let restoreEnv: (() => void) | null = null;
  const originalLoad = (Module as unknown as { _load: Function })._load;
  const previousTripwireState = activeTripwireState;
  const tripwireState: ActiveTripwireState = { modelTripwireInvoked: false };

  try {
    const canonicalAbsolutePath = path.join(
      process.cwd(),
      input.canonicalAParentRepoRelativePath
    );
    const normalizedAbsolutePath = path.resolve(canonicalAbsolutePath).replaceAll("\\", "/");
    assertProbeLabelled(
      normalizedAbsolutePath.endsWith(A_PARENT_CANONICAL_SUFFIX),
      `canonical_a_parent_path_missing:${X4_PROBE_ID}`
    );

    const registryAsset = G0_SYNTHETIC_ASSETS["A-parent"];
    const bytes = await readFile(canonicalAbsolutePath);
    const digest = computeCalibrationImageFingerprint(bytes);
    if (digest !== registryAsset.sha256 || digest !== input.expectedParentBasisFingerprint) {
      throw new Error(`loopback_control_digest_drift:${X4_PROBE_ID}`);
    }

    const metadata = await inspectImageMetadata(bytes);
    assertProbeLabelled(metadata.ok, `control_metadata_unreadable:${X4_PROBE_ID}`);
    if (metadata.orientation !== 1 || !registryAsset.decodedOrientationNormal) {
      throw new Error(`control_orientation_not_normal:${X4_PROBE_ID}`);
    }
    if (
      metadata.width !== X4_PINNED_MATCHING_DIMENSIONS.width ||
      metadata.height !== X4_PINNED_MATCHING_DIMENSIONS.height ||
      registryAsset.decodedWidth !== X4_PINNED_MATCHING_DIMENSIONS.width ||
      registryAsset.decodedHeight !== X4_PINNED_MATCHING_DIMENSIONS.height
    ) {
      throw new Error(`pinned_dimensions_not_matching:${X4_PROBE_ID}`);
    }

    const servedRequestPaths: string[] = [];
    server = createServer(
      createX4LoopbackRequestHandler({
        servedFileName: "A-parent.jpg",
        bytes,
        servedRequestPaths,
      })
    );
    await bindLoopbackServer(server);

    restoreEnv = applyRouteEnv();
    activeTripwireState = tripwireState;
    installPatchedModuleLoad({ originalLoad, requestId: "g0-x4-preemption-control-request-id" });

    const route = await importFreshRouteModuleBoundToX4Mocks();
    let tripwireThrew = false;
    try {
      await route.POST(
        buildRoutePostRequest({
          servedFileName: "A-parent.jpg",
          expectedBasisFingerprint: input.expectedParentBasisFingerprint,
        })
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === `model_tripwire_reached:${X4_PROBE_ID}`
      ) {
        tripwireThrew = true;
      } else {
        throw error;
      }
    }
    if (!tripwireThrew || tripwireState.modelTripwireInvoked !== true) {
      throw new Error(`control_model_boundary_not_reached:${X4_PROBE_ID}`);
    }
    if (servedRequestPaths.length !== 1 || servedRequestPaths[0] !== "GET /A-parent.jpg") {
      throw new Error(`unexpected_served_request_paths:${X4_PROBE_ID}`);
    }

    return {
      modelTripwireInvoked: true,
      servedRequestPaths,
    };
  } finally {
    (Module as unknown as { _load: Function })._load = originalLoad;
    evictRouteModuleFromRequireCache();
    if (restoreEnv) {
      restoreEnv();
    }
    activeTripwireState = previousTripwireState;
    await closeServerIfPresent(server);
    routeHarnessActive = false;
  }
}
