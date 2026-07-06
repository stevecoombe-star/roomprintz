import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { G0_SYNTHETIC_ASSETS } from "./assets-and-lineage";

const P_DIMENSION_PROBE_ID = "P-dimension-mismatch";
const LOOPBACK_HOST = "127.0.0.1";
const LOOPBACK_PORT = 3000;
const REQUIRED_ROUTE_FAILURE_REASON =
  "Room image dimensions changed before vision calibration could run." as const;

const ROUTE_ENV: Readonly<Record<string, string>> = {
  AUTO_FLOOR_VISION_ENABLED: "true",
  GEMINI_API_KEY: "g0-placeholder-key-presence-only",
  AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP: "true",
  AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS: "g0-loopback-only.invalid",
};

const A_PARENT_CANONICAL_SUFFIX = "/app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg";

export const P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS = {
  width: 319,
  height: 240,
} as const;

type ActiveTripwireState = {
  modelTripwireInvoked: boolean;
};

let routeHarnessActive = false;
let activeTripwireState: ActiveTripwireState | null = null;

function modelTripwireDelegator(): never {
  if (!activeTripwireState) {
    throw new Error(`model_tripwire_reached:${P_DIMENSION_PROBE_ID}`);
  }
  activeTripwireState.modelTripwireInvoked = true;
  throw new Error(`model_tripwire_reached:${P_DIMENSION_PROBE_ID}`);
}

function assertProbeLabelled(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function bindLoopbackServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`loopback_port_in_use:${LOOPBACK_HOST}:${LOOPBACK_PORT}`));
        return;
      }
      reject(new Error(`loopback_bind_failure:${P_DIMENSION_PROBE_ID}:${error.message}`));
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

export async function observePdimensionMismatchRouteContainment(input: {
  expectedBasisFingerprint: string;
  canonicalAParentRepoRelativePath: string;
}): Promise<{
  httpStatus: 200;
  responseStatus: "failed";
  candidatesLength: 0;
  selectedCandidateId: null;
  failureReason: "Room image dimensions changed before vision calibration could run.";
  attestedBasisFingerprint: string;
  servedRequestPaths: readonly string[];
  modelTripwireInvoked: false;
}> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(`production_runtime_forbidden:${P_DIMENSION_PROBE_ID}`);
  }
  if (routeHarnessActive) {
    throw new Error(`route_harness_reentry_forbidden:${P_DIMENSION_PROBE_ID}`);
  }
  routeHarnessActive = true;

  let server: Server | null = null;
  let restoreEnv: (() => void) | null = null;
  const originalLoad = (Module as unknown as { _load: Function })._load;
  const previousTripwireState = activeTripwireState;
  const tripwireState: ActiveTripwireState = { modelTripwireInvoked: false };

  try {
    const canonicalAbsolutePath = path.join(process.cwd(), input.canonicalAParentRepoRelativePath);
    const normalizedAbsolutePath = path.resolve(canonicalAbsolutePath).replaceAll("\\", "/");
    assertProbeLabelled(
      normalizedAbsolutePath.endsWith(A_PARENT_CANONICAL_SUFFIX),
      `canonical_a_parent_path_missing:${P_DIMENSION_PROBE_ID}`
    );

    const bytes = await readFile(canonicalAbsolutePath);
    const digest = computeCalibrationImageFingerprint(bytes);
    if (digest !== input.expectedBasisFingerprint) {
      throw new Error(`loopback_fixture_digest_drift:${P_DIMENSION_PROBE_ID}`);
    }

    const metadata = await inspectImageMetadata(bytes);
    assertProbeLabelled(metadata.ok, `fixture_metadata_unreadable:${P_DIMENSION_PROBE_ID}`);
    if (
      metadata.width === P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.width &&
      metadata.height === P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.height
    ) {
      throw new Error(`pinned_dimensions_not_mismatched:${P_DIMENSION_PROBE_ID}`);
    }
    const registryAsset = G0_SYNTHETIC_ASSETS["A-parent"];
    if (
      registryAsset.decodedWidth === P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.width &&
      registryAsset.decodedHeight === P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.height
    ) {
      throw new Error(`pinned_dimensions_not_mismatched:${P_DIMENSION_PROBE_ID}`);
    }

    const servedRequestPaths: string[] = [];
    server = createServer((request, response) => {
      const method = request.method ?? "UNKNOWN";
      const requestPath = new URL(
        request.url ?? "/",
        `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}`
      ).pathname;
      servedRequestPaths.push(`${method} ${requestPath}`);

      if (method === "GET" && requestPath === "/A-parent.jpg") {
        response.setHeader("content-type", "image/jpeg");
        response.setHeader("content-length", String(bytes.byteLength));
        response.writeHead(200).end(bytes);
        return;
      }
      response.writeHead(404).end("not-found");
    });
    await bindLoopbackServer(server);

    restoreEnv = applyRouteEnv();
    activeTripwireState = tripwireState;

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
          getRequestIdFromHeaders: () => "g0-p-dimension-route-request-id",
        };
      }
      if (request === "@/lib/vibodeAutoFloorVisionDetect") {
        return {
          detectFloorFromVerifiedBytes: async () => modelTripwireDelegator(),
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    const route = await import("@/app/api/admin/3d-room-lab/auto-floor/detect-vision/route");
    const request = new Request("http://localhost/api/admin/3d-room-lab/auto-floor/detect-vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageUrl: `http://${LOOPBACK_HOST}:${LOOPBACK_PORT}/A-parent.jpg`,
        frameSize: { width: 320, height: 240 },
        intrinsicSize: {
          width: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.width,
          height: P_DIMENSION_PINNED_SYNTHETIC_DIMENSIONS.height,
        },
        floorRect: { widthMeters: 4, depthMeters: 4 },
        expectedBasisFingerprint: input.expectedBasisFingerprint,
      }),
    });

    const response = await route.POST(request);
    if (response.status !== 200) {
      throw new Error(`unexpected_http_status:${P_DIMENSION_PROBE_ID}:${response.status}`);
    }
    const body = (await response.json()) as {
      status?: unknown;
      candidates?: unknown;
      selectedCandidateId?: unknown;
      failureReasons?: unknown;
      attestedBasisFingerprint?: unknown;
    };
    if (body.status !== "failed") {
      throw new Error(`unexpected_route_status:${P_DIMENSION_PROBE_ID}:${String(body.status)}`);
    }
    if (!Array.isArray(body.candidates) || body.candidates.length !== 0) {
      throw new Error(`unexpected_route_candidates:${P_DIMENSION_PROBE_ID}`);
    }
    if (body.selectedCandidateId !== null) {
      throw new Error(`unexpected_selected_candidate:${P_DIMENSION_PROBE_ID}`);
    }
    if (!Array.isArray(body.failureReasons)) {
      throw new Error(`missing_failure_reasons:${P_DIMENSION_PROBE_ID}`);
    }
    if (
      body.failureReasons.length !== 1 ||
      body.failureReasons[0] !== REQUIRED_ROUTE_FAILURE_REASON
    ) {
      throw new Error(`unexpected_route_failure_reason:${P_DIMENSION_PROBE_ID}`);
    }
    if (body.attestedBasisFingerprint !== input.expectedBasisFingerprint) {
      throw new Error(`route_attested_fingerprint_mismatch:${P_DIMENSION_PROBE_ID}`);
    }
    if (
      servedRequestPaths.length !== 1 ||
      servedRequestPaths[0] !== "GET /A-parent.jpg"
    ) {
      throw new Error(`unexpected_served_request_paths:${P_DIMENSION_PROBE_ID}`);
    }
    if (tripwireState.modelTripwireInvoked) {
      throw new Error(`model_tripwire_reached:${P_DIMENSION_PROBE_ID}`);
    }

    return {
      httpStatus: 200,
      responseStatus: "failed",
      candidatesLength: 0,
      selectedCandidateId: null,
      failureReason: REQUIRED_ROUTE_FAILURE_REASON,
      attestedBasisFingerprint: input.expectedBasisFingerprint,
      servedRequestPaths,
      modelTripwireInvoked: false,
    };
  } finally {
    (Module as unknown as { _load: Function })._load = originalLoad;
    if (restoreEnv) {
      restoreEnv();
    }
    activeTripwireState = previousTripwireState;
    await closeServerIfPresent(server);
    routeHarnessActive = false;
  }
}
