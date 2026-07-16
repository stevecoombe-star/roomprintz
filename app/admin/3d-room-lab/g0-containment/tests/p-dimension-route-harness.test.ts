import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { G0_SYNTHETIC_ASSET_BASE_DIR, G0_SYNTHETIC_ASSETS } from "../assets-and-lineage";
import { observePdimensionMismatchRouteContainment } from "../p-dimension-route-harness";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;

const ROUTE_ENV_KEYS = [
  "AUTO_FLOOR_VISION_ENABLED",
  "GEMINI_API_KEY",
  "AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP",
  "AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS",
] as const;

const A_PARENT_CANONICAL_PATH =
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg";

function getRouteEnvSnapshot(): Record<string, string | undefined> {
  return Object.fromEntries(ROUTE_ENV_KEYS.map((key) => [key, process.env[key]]));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function occupyLoopbackPort(): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(200).end("occupied");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, "127.0.0.1", () => resolve());
  });
  return server;
}

async function assertLoopbackPortAvailable(): Promise<void> {
  const probe = await occupyLoopbackPort();
  await closeServer(probe);
}

async function withModuleMocks<T>(
  mocks: Record<string, unknown>,
  run: () => Promise<T>
): Promise<T> {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  (Module as unknown as { _load: ModuleLoad })._load = function patched(
    request: string,
    parent: unknown,
    isMain: boolean
  ) {
    if (request in mocks) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await run();
  } finally {
    (Module as unknown as { _load: ModuleLoad })._load = originalLoad;
  }
}

async function withRouteEnv<T>(run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  const nextValues = {
    AUTO_FLOOR_VISION_ENABLED: "true",
    GEMINI_API_KEY: "g0-placeholder-key-presence-only",
    AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP: "true",
    AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS: "g0-loopback-only.invalid",
  } as const;
  for (const [key, value] of Object.entries(nextValues)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, oldValue] of previous.entries()) {
      if (typeof oldValue === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  }
}

test("P-dimension route harness returns exact supporting mismatch observation and restores process state", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();

  const observation = await observePdimensionMismatchRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
  });

  assert.deepEqual(observation, {
    httpStatus: 200,
    responseStatus: "failed",
    candidatesLength: 0,
    selectedCandidateId: null,
    failureReason: "Room image dimensions changed before vision calibration could run.",
    attestedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    servedRequestPaths: ["GET /A-parent.jpg"],
    modelTripwireInvoked: false,
  });
  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("P-dimension route harness fails closed on occupied loopback port before route execution", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();
  const occupied = await occupyLoopbackPort();
  try {
    await assert.rejects(
      observePdimensionMismatchRouteContainment({
        expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
        canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
      }),
      /loopback_port_in_use:127\.0\.0\.1:3000/
    );
  } finally {
    await closeServer(occupied);
  }

  const postFailureObservation = await observePdimensionMismatchRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
  });
  assert.equal(postFailureObservation.modelTripwireInvoked, false);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("matching dimensions route path reaches model tripwire and fails closed", async () => {
  const bytes = await readFile(path.join(G0_SYNTHETIC_ASSET_BASE_DIR, "A-parent.jpg"));
  const expectedBasisFingerprint = computeCalibrationImageFingerprint(bytes);
  const servedRequestPaths: string[] = [];

  const server = createServer((request, response) => {
    const method = request.method ?? "UNKNOWN";
    const requestPath = new URL(request.url ?? "/", "http://127.0.0.1:3000").pathname;
    servedRequestPaths.push(`${method} ${requestPath}`);
    if (method === "GET" && requestPath === "/A-parent.jpg") {
      response.setHeader("content-type", "image/jpeg");
      response.setHeader("content-length", String(bytes.byteLength));
      response.writeHead(200).end(bytes);
      return;
    }
    response.writeHead(404).end("not-found");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, "127.0.0.1", () => resolve());
  });

  try {
    await withRouteEnv(() =>
      withModuleMocks(
        {
          "@/lib/adminServer": {
            getAuthenticatedAdminUser: async () => ({ id: "g0-deterministic-admin" }),
          },
          "@/lib/vibodeGeminiUsageAccounting": {
            getRequestIdFromHeaders: () => "g0-p-dimension-matching-dims",
          },
          "@/lib/vibodeAutoFloorVisionDetect": {
            detectFloorFromVerifiedBytes: async () => {
              throw new Error("model_tripwire_reached:P-dimension-mismatch");
            },
          },
        },
        async () => {
          const route = await import("@/app/api/admin/3d-room-lab/auto-floor/detect-vision/route");
          await assert.rejects(
            route.POST(
              new Request("http://localhost/api/admin/3d-room-lab/auto-floor/detect-vision", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  imageUrl: "http://127.0.0.1:3000/A-parent.jpg",
                  frameSize: { width: 320, height: 240 },
                  intrinsicSize: { width: 320, height: 240 },
                  floorRect: { widthMeters: 4, depthMeters: 4 },
                  expectedBasisFingerprint,
                }),
              })
            ),
            /model_tripwire_reached:P-dimension-mismatch/
          );
        }
      )
    );
  } finally {
    await closeServer(server);
  }

  assert.deepEqual(servedRequestPaths, ["GET /A-parent.jpg"]);
  await assertLoopbackPortAvailable();
});

test("P-dimension route harness forbids production NODE_ENV", async () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    await assert.rejects(
      observePdimensionMismatchRouteContainment({
        expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
        canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
      }),
      /production_runtime_forbidden:P-dimension-mismatch/
    );
  } finally {
    if (typeof previousNodeEnv === "undefined") {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = previousNodeEnv;
    }
  }
});
