import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { fetchRoomImageSafely, validateImageUrl } from "@/lib/vibodeAutoFloorImageFetch";
import {
  G0_SYNTHETIC_ASSETS,
  type G0SyntheticAsset,
  type G0SyntheticAssetId,
} from "../assets-and-lineage";
import {
  createPurlDriftLoopbackRequestHandler,
  observePurlDriftDetectVisionMatchingFingerprintControl,
  observePurlDriftDualRouteMismatchContainment,
  observePurlDriftEmptyRoomMatchingFingerprintControl,
  P_URL_DRIFT_CLEARED_ENV_KEYS,
  P_URL_DRIFT_ROUTE_ENV,
  P_URL_DRIFT_SERVED_FILE_NAME,
} from "../p-url-drift-route-harness";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };

const ROUTE_ENV_KEYS = [
  "EMPTY_ROOM_ASSIST_ENABLED",
  "AUTO_FLOOR_VISION_ENABLED",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP",
  "AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS",
] as const;

const A_PARENT_CANONICAL_PATH =
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg";
const A_DRIFT_B_CANONICAL_PATH =
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-drift-b.jpg";
const REPO_RECEIPTS_ROOT = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/receipts"
);
const ROUTE_MODULE_SUFFIXES = [
  "/app/api/admin/3d-room-lab/auto-floor/detect-vision/route.ts",
  "/app/api/admin/3d-room-lab/empty-room-assist/run/route.ts",
] as const;

const A_PARENT_SHA = G0_SYNTHETIC_ASSETS["A-parent"].sha256;
const A_DRIFT_B_SHA = G0_SYNTHETIC_ASSETS["A-drift-b"].sha256;

function mismatchInput() {
  return {
    expectedParentBasisFingerprint: A_PARENT_SHA,
    canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
    canonicalADriftRepoRelativePath: A_DRIFT_B_CANONICAL_PATH,
  };
}

function controlInput() {
  return {
    expectedDriftBasisFingerprint: A_DRIFT_B_SHA,
    canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
    canonicalADriftRepoRelativePath: A_DRIFT_B_CANONICAL_PATH,
  };
}

function getRouteEnvSnapshot(): Record<string, string | undefined> {
  return Object.fromEntries(ROUTE_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function routeModuleCacheKeys(): readonly string[] {
  const cache = (Module as unknown as { _cache: Record<string, unknown> })._cache;
  return Object.keys(cache).filter((key) => {
    const normalized = key.replaceAll("\\", "/");
    return ROUTE_MODULE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
  });
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

async function collectJsonFileHashes(root: string): Promise<readonly string[]> {
  const digests: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const bytes = await readFile(fullPath);
      const digest = createHash("sha256").update(bytes).digest("hex");
      digests.push(`${path.relative(root, fullPath)}:${digest}`);
    }
  }
  await visit(root);
  return digests.sort();
}

async function withMutatedSyntheticAsset<T>(
  assetId: G0SyntheticAssetId,
  mutate: (asset: Mutable<G0SyntheticAsset>) => void,
  fn: () => Promise<T>
): Promise<T> {
  const asset = G0_SYNTHETIC_ASSETS[assetId] as Mutable<G0SyntheticAsset>;
  const snapshot = { ...asset };
  mutate(asset);
  try {
    return await fn();
  } finally {
    Object.assign(asset, snapshot);
  }
}

test("P-url-drift dual-route harness returns exact mismatch observation for both routes and restores process state", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();
  const cacheKeysBefore = routeModuleCacheKeys();
  const receiptsBefore = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);

  const observation = await observePurlDriftDualRouteMismatchContainment(mismatchInput());

  assert.deepEqual(observation, {
    expectedBasisFingerprintSent: A_PARENT_SHA,
    vision: {
      httpStatus: 200,
      responseStatus: "failed",
      candidatesLength: 0,
      selectedCandidateId: null,
      notesLength: 0,
      failureReasons: ["basis_fingerprint_mismatch"],
      attestedBasisFingerprint:
        "dfddfdac51dca6ac42008699768d4decf5f7c29c09ac1f5f8b069e837cc5d572",
      servedRequestPaths: ["GET /A-drift-b.jpg"],
      modelTripwireInstalled: true,
      modelTripwireInvoked: false,
    },
    emptyRoom: {
      httpStatus: 200,
      emptyRoomAssistStatus: "blocked",
      failureReason: "basis_fingerprint_mismatch",
      policyReasons: ["basis_fingerprint_mismatch"],
      attestedOriginalBasisFingerprint:
        "dfddfdac51dca6ac42008699768d4decf5f7c29c09ac1f5f8b069e837cc5d572",
      attestedEmptyBasisFingerprint: null,
      calibratedCameraEligible: false,
      surfacedResult: null,
      originalResult: null,
      emptyResult: null,
      servedRequestPaths: ["GET /A-drift-b.jpg"],
      generationTripwireInstalled: true,
      generationTripwireInvoked: false,
      detectionTripwireInstalled: true,
      detectionTripwireInvoked: false,
    },
  });
  assert.equal(observation.vision.attestedBasisFingerprint, A_DRIFT_B_SHA);
  assert.equal(observation.emptyRoom.attestedOriginalBasisFingerprint, A_DRIFT_B_SHA);
  assert.notEqual(observation.vision.attestedBasisFingerprint, A_PARENT_SHA);
  assert.deepEqual(observation.vision.servedRequestPaths, ["GET /A-drift-b.jpg"]);
  assert.deepEqual(observation.emptyRoom.servedRequestPaths, ["GET /A-drift-b.jpg"]);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  assert.deepEqual(routeModuleCacheKeys(), cacheKeysBefore);
  await assertLoopbackPortAvailable();
  assert.deepEqual(await collectJsonFileHashes(REPO_RECEIPTS_ROOT), receiptsBefore);
});

test("P-url-drift matching-fingerprint detect-vision control reaches the P-url-drift model tripwire", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();

  const control = await observePurlDriftDetectVisionMatchingFingerprintControl(controlInput());
  assert.equal(control.modelTripwireInvoked, true);
  assert.deepEqual(control.servedRequestPaths, ["GET /A-drift-b.jpg"]);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("P-url-drift matching-fingerprint empty-room control reaches the generation tripwire first and never detection", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();

  const control = await observePurlDriftEmptyRoomMatchingFingerprintControl(controlInput());
  assert.equal(control.generationTripwireInvoked, true);
  assert.equal(control.generationTripwireReachedFirst, true);
  assert.equal(control.detectionTripwireInvoked, false);
  assert.deepEqual(control.servedRequestPaths, ["GET /A-drift-b.jpg"]);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("P-url-drift harness fails closed on occupied loopback port before either route and recovers cleanly", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();
  const occupied = await occupyLoopbackPort();
  try {
    await assert.rejects(
      observePurlDriftDualRouteMismatchContainment(mismatchInput()),
      /loopback_port_in_use:127\.0\.0\.1:3000/
    );
  } finally {
    await closeServer(occupied);
  }

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);

  const postFailureObservation = await observePurlDriftDualRouteMismatchContainment(
    mismatchInput()
  );
  assert.equal(postFailureObservation.vision.modelTripwireInvoked, false);
  assert.equal(postFailureObservation.emptyRoom.generationTripwireInvoked, false);
  assert.deepEqual(postFailureObservation.vision.servedRequestPaths, ["GET /A-drift-b.jpg"]);
  assert.deepEqual(postFailureObservation.emptyRoom.servedRequestPaths, [
    "GET /A-drift-b.jpg",
  ]);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("P-url-drift loopback handler serves only GET /A-drift-b.jpg, logs every request, and issues no redirects", async () => {
  const driftAbsolutePath = path.join(process.cwd(), A_DRIFT_B_CANONICAL_PATH);
  const driftBytes = await readFile(driftAbsolutePath);
  const servedRequestPaths: string[] = [];
  const serveFailures: string[] = [];
  const server = createServer(
    createPurlDriftLoopbackRequestHandler({
      canonicalDriftAbsolutePath: driftAbsolutePath,
      expectedServedDriftDigest: A_DRIFT_B_SHA,
      expectedParentBasisFingerprint: A_PARENT_SHA,
      servedRequestPaths,
      serveFailures,
    })
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, "127.0.0.1", () => resolve());
  });
  try {
    const wrongPath = await fetch("http://127.0.0.1:3000/A-parent.jpg");
    assert.equal(wrongPath.status, 404);
    assert.equal(await wrongPath.text(), "not-found");
    assert.equal(wrongPath.headers.get("location"), null);

    const wrongMethod = await fetch(`http://127.0.0.1:3000/${P_URL_DRIFT_SERVED_FILE_NAME}`, {
      method: "POST",
    });
    assert.equal(wrongMethod.status, 404);
    assert.equal(await wrongMethod.text(), "not-found");

    const headMethod = await fetch(`http://127.0.0.1:3000/${P_URL_DRIFT_SERVED_FILE_NAME}`, {
      method: "HEAD",
    });
    assert.equal(headMethod.status, 404);

    const allowed = await fetch(`http://127.0.0.1:3000/${P_URL_DRIFT_SERVED_FILE_NAME}`);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("content-type"), "image/jpeg");
    assert.equal(allowed.headers.get("location"), null);
    const receivedBytes = Buffer.from(await allowed.arrayBuffer());
    assert.equal(receivedBytes.equals(driftBytes), true);
  } finally {
    await closeServer(server);
  }
  assert.deepEqual(servedRequestPaths, [
    "GET /A-parent.jpg",
    "POST /A-drift-b.jpg",
    "HEAD /A-drift-b.jpg",
    "GET /A-drift-b.jpg",
  ]);
  assert.deepEqual(serveFailures, []);
  await assertLoopbackPortAvailable();
});

test("P-url-drift loopback handler digest-verifies served bytes before every serve and fails closed", async () => {
  const driftAbsolutePath = path.join(process.cwd(), A_DRIFT_B_CANONICAL_PATH);

  const driftedServedRequestPaths: string[] = [];
  const driftedServeFailures: string[] = [];
  const driftedServer = createServer(
    createPurlDriftLoopbackRequestHandler({
      canonicalDriftAbsolutePath: driftAbsolutePath,
      expectedServedDriftDigest: "f".repeat(64),
      expectedParentBasisFingerprint: A_PARENT_SHA,
      servedRequestPaths: driftedServedRequestPaths,
      serveFailures: driftedServeFailures,
    })
  );
  await new Promise<void>((resolve, reject) => {
    driftedServer.once("error", reject);
    driftedServer.listen(3000, "127.0.0.1", () => resolve());
  });
  try {
    const response = await fetch(`http://127.0.0.1:3000/${P_URL_DRIFT_SERVED_FILE_NAME}`);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "digest-drift");
  } finally {
    await closeServer(driftedServer);
  }
  assert.deepEqual(driftedServeFailures, ["served_bytes_digest_drift:P-url-drift"]);

  // Equal expected/served digest fails closed at serve time too.
  const collisionServedRequestPaths: string[] = [];
  const collisionServeFailures: string[] = [];
  const collisionServer = createServer(
    createPurlDriftLoopbackRequestHandler({
      canonicalDriftAbsolutePath: driftAbsolutePath,
      expectedServedDriftDigest: A_DRIFT_B_SHA,
      expectedParentBasisFingerprint: A_DRIFT_B_SHA,
      servedRequestPaths: collisionServedRequestPaths,
      serveFailures: collisionServeFailures,
    })
  );
  await new Promise<void>((resolve, reject) => {
    collisionServer.once("error", reject);
    collisionServer.listen(3000, "127.0.0.1", () => resolve());
  });
  try {
    const response = await fetch(`http://127.0.0.1:3000/${P_URL_DRIFT_SERVED_FILE_NAME}`);
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "digest-collision");
  } finally {
    await closeServer(collisionServer);
  }
  assert.deepEqual(collisionServeFailures, ["expected_parent_digest_equals_drift:P-url-drift"]);
  await assertLoopbackPortAvailable();
});

test("P-url-drift harness verifies digests before binding and fails closed on drift or expected/served equality", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();

  await assert.rejects(
    observePurlDriftDualRouteMismatchContainment({
      ...mismatchInput(),
      expectedParentBasisFingerprint: "f".repeat(64),
    }),
    /expected_parent_digest_drift:P-url-drift/
  );
  await assertLoopbackPortAvailable();

  // Passing the served drift digest as the expected fingerprint fails closed
  // before either route observation can run.
  await assert.rejects(
    observePurlDriftDualRouteMismatchContainment({
      ...mismatchInput(),
      expectedParentBasisFingerprint: A_DRIFT_B_SHA,
    }),
    /expected_parent_digest_drift:P-url-drift/
  );
  await assertLoopbackPortAvailable();

  await withMutatedSyntheticAsset(
    "A-drift-b",
    (asset) => {
      asset.sha256 = "0".repeat(64);
    },
    async () => {
      await assert.rejects(
        observePurlDriftDualRouteMismatchContainment(mismatchInput()),
        /loopback_drift_digest_drift:P-url-drift/
      );
    }
  );
  await assertLoopbackPortAvailable();

  await assert.rejects(
    observePurlDriftDualRouteMismatchContainment({
      ...mismatchInput(),
      canonicalADriftRepoRelativePath: A_PARENT_CANONICAL_PATH,
    }),
    /canonical_a_drift_b_path_missing:P-url-drift/
  );
  await assert.rejects(
    observePurlDriftDualRouteMismatchContainment({
      ...mismatchInput(),
      canonicalAParentRepoRelativePath: A_DRIFT_B_CANONICAL_PATH,
    }),
    /canonical_a_parent_path_missing:P-url-drift/
  );
  await assert.rejects(
    observePurlDriftDetectVisionMatchingFingerprintControl({
      ...controlInput(),
      expectedDriftBasisFingerprint: A_PARENT_SHA,
    }),
    /control_expected_digest_drift:P-url-drift/
  );
  await assert.rejects(
    observePurlDriftEmptyRoomMatchingFingerprintControl({
      ...controlInput(),
      expectedDriftBasisFingerprint: A_PARENT_SHA,
    }),
    /control_expected_digest_drift:P-url-drift/
  );

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("P-url-drift sentinel allowlist blocks external hosts and redirect escape under harness env values", async () => {
  const allowedHosts = P_URL_DRIFT_ROUTE_ENV.AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS.split(",");
  assert.deepEqual(allowedHosts, ["g0-loopback-only.invalid"]);
  assert.deepEqual(P_URL_DRIFT_CLEARED_ENV_KEYS, ["GOOGLE_API_KEY"]);

  const externalHost = await validateImageUrl(
    "https://images.example.com/A-drift-b.jpg",
    allowedHosts,
    true
  );
  assert.equal(externalHost.ok, false);

  const sentinelHost = await validateImageUrl(
    "https://g0-loopback-only.invalid/A-drift-b.jpg",
    allowedHosts,
    true
  );
  assert.equal(sentinelHost.ok, false);

  const nonLoopbackPort = await validateImageUrl(
    "http://127.0.0.1:3001/A-drift-b.jpg",
    allowedHosts,
    true
  );
  assert.equal(nonLoopbackPort.ok, false);

  // A loopback redirect toward an external host cannot pass the route's fetch
  // path under the harness env: the redirect target is re-validated and blocked.
  const redirectServer = createServer((_request, response) => {
    response.writeHead(302, { location: "https://images.example.com/escape.jpg" }).end();
  });
  await new Promise<void>((resolve, reject) => {
    redirectServer.once("error", reject);
    redirectServer.listen(3000, "127.0.0.1", () => resolve());
  });
  try {
    const escaped = await fetchRoomImageSafely("http://127.0.0.1:3000/A-drift-b.jpg", {
      allowedHosts,
      maxBytes: 10 * 1024 * 1024,
      timeoutMs: 5000,
      allowLocalhostHttp: true,
    });
    assert.equal(escaped.ok, false);
    if (!escaped.ok) {
      assert.match(escaped.reason, /Blocked image redirect/);
    }
  } finally {
    await closeServer(redirectServer);
  }
  await assertLoopbackPortAvailable();
});

test("P-url-drift harness rejects reentry across the dual-route operation and both controls", async () => {
  const firstRun = observePurlDriftDualRouteMismatchContainment(mismatchInput());
  await assert.rejects(
    observePurlDriftDualRouteMismatchContainment(mismatchInput()),
    /route_harness_reentry_forbidden:P-url-drift/
  );
  await assert.rejects(
    observePurlDriftDetectVisionMatchingFingerprintControl(controlInput()),
    /route_harness_reentry_forbidden:P-url-drift/
  );
  await assert.rejects(
    observePurlDriftEmptyRoomMatchingFingerprintControl(controlInput()),
    /route_harness_reentry_forbidden:P-url-drift/
  );
  const firstObservation = await firstRun;
  assert.equal(firstObservation.vision.modelTripwireInvoked, false);
  assert.equal(firstObservation.emptyRoom.generationTripwireInvoked, false);

  const cleanObservation = await observePurlDriftDualRouteMismatchContainment(mismatchInput());
  assert.equal(cleanObservation.vision.modelTripwireInvoked, false);
  await assertLoopbackPortAvailable();
});

test("P-url-drift harness forbids production NODE_ENV for the dual observation and both controls", async () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    await assert.rejects(
      observePurlDriftDualRouteMismatchContainment(mismatchInput()),
      /production_runtime_forbidden:P-url-drift/
    );
    await assert.rejects(
      observePurlDriftDetectVisionMatchingFingerprintControl(controlInput()),
      /production_runtime_forbidden:P-url-drift/
    );
    await assert.rejects(
      observePurlDriftEmptyRoomMatchingFingerprintControl(controlInput()),
      /production_runtime_forbidden:P-url-drift/
    );
  } finally {
    if (typeof previousNodeEnv === "undefined") {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = previousNodeEnv;
    }
  }
});

test("P-url-drift dual route-module cache isolation evicts both route modules after success and failure", async () => {
  await observePurlDriftDualRouteMismatchContainment(mismatchInput());
  assert.deepEqual(routeModuleCacheKeys(), []);

  await assert.rejects(
    observePurlDriftDualRouteMismatchContainment({
      ...mismatchInput(),
      expectedParentBasisFingerprint: "f".repeat(64),
    }),
    /expected_parent_digest_drift:P-url-drift/
  );
  assert.deepEqual(routeModuleCacheKeys(), []);

  // Later consumers get fresh instances, never P-url-drift-bound mocks: a
  // subsequent control still binds and trips its own tripwire deterministically.
  const control = await observePurlDriftDetectVisionMatchingFingerprintControl(controlInput());
  assert.equal(control.modelTripwireInvoked, true);
  assert.deepEqual(routeModuleCacheKeys(), []);
  await assertLoopbackPortAvailable();
});

test("P-url-drift harness runs leave repository receipt records untouched", async () => {
  const receiptsBefore = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  await observePurlDriftDualRouteMismatchContainment(mismatchInput());
  await observePurlDriftDetectVisionMatchingFingerprintControl(controlInput());
  await observePurlDriftEmptyRoomMatchingFingerprintControl(controlInput());
  assert.deepEqual(await collectJsonFileHashes(REPO_RECEIPTS_ROOT), receiptsBefore);
});
