import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { G0_SYNTHETIC_ASSETS } from "../assets-and-lineage";
import {
  createX4LoopbackRequestHandler,
  observeX4ExifOrientationRouteContainment,
  observeX4NormalOrientationRoutePreemptionControl,
} from "../x4-exif-route-harness";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;

const ROUTE_ENV_KEYS = [
  "AUTO_FLOOR_VISION_ENABLED",
  "GEMINI_API_KEY",
  "AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP",
  "AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS",
] as const;

const A_EXIF_CANONICAL_PATH =
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-exif.jpg";
const A_PARENT_CANONICAL_PATH =
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/A-parent.jpg";
const REPO_RECEIPTS_ROOT = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/g0-containment/receipts"
);

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

test("X4 route harness returns exact orientation-refusal observation and restores process state", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();
  const receiptsBefore = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);

  const observation = await observeX4ExifOrientationRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
    canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
  });

  assert.deepEqual(observation, {
    httpStatus: 200,
    responseStatus: "failed",
    candidatesLength: 0,
    selectedCandidateId: null,
    notesLength: 0,
    failureReason: "This image orientation is not yet supported for vision calibration.",
    attestedBasisFingerprint:
      "26d09c2e02a9c05a02d0684a1cc6a509aa6cb037e83f0e09c23e4da8b1aab859",
    servedRequestPaths: ["GET /A-exif.jpg"],
    modelTripwireInvoked: false,
  });
  assert.deepEqual(observation.servedRequestPaths, ["GET /A-exif.jpg"]);
  assert.equal(observation.attestedBasisFingerprint, G0_SYNTHETIC_ASSETS["A-exif"].sha256);
  assert.equal(observation.modelTripwireInvoked, false);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
  assert.deepEqual(await collectJsonFileHashes(REPO_RECEIPTS_ROOT), receiptsBefore);
});

test("X4 route harness fails closed on occupied loopback port and recovers with a clean run", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();
  const occupied = await occupyLoopbackPort();
  try {
    await assert.rejects(
      observeX4ExifOrientationRouteContainment({
        expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
        canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
      }),
      /loopback_port_in_use:127\.0\.0\.1:3000/
    );
  } finally {
    await closeServer(occupied);
  }

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);

  const postFailureObservation = await observeX4ExifOrientationRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
    canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
  });
  assert.equal(postFailureObservation.modelTripwireInvoked, false);
  assert.deepEqual(postFailureObservation.servedRequestPaths, ["GET /A-exif.jpg"]);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("X4 loopback handler serves only GET /A-exif.jpg and records every request", async () => {
  const bytes = await readFile(path.join(process.cwd(), A_EXIF_CANONICAL_PATH));
  const servedRequestPaths: string[] = [];
  const server = createServer(
    createX4LoopbackRequestHandler({
      servedFileName: "A-exif.jpg",
      bytes,
      servedRequestPaths,
    })
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3000, "127.0.0.1", () => resolve());
  });
  try {
    const wrongPath = await fetch("http://127.0.0.1:3000/other.jpg");
    assert.equal(wrongPath.status, 404);
    assert.equal(await wrongPath.text(), "not-found");

    const wrongMethod = await fetch("http://127.0.0.1:3000/A-exif.jpg", { method: "POST" });
    assert.equal(wrongMethod.status, 404);
    assert.equal(await wrongMethod.text(), "not-found");

    const headMethod = await fetch("http://127.0.0.1:3000/A-exif.jpg", { method: "HEAD" });
    assert.equal(headMethod.status, 404);

    const allowed = await fetch("http://127.0.0.1:3000/A-exif.jpg");
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("content-type"), "image/jpeg");
    const receivedBytes = Buffer.from(await allowed.arrayBuffer());
    assert.equal(receivedBytes.equals(bytes), true);
  } finally {
    await closeServer(server);
  }
  assert.deepEqual(servedRequestPaths, [
    "GET /other.jpg",
    "POST /A-exif.jpg",
    "HEAD /A-exif.jpg",
    "GET /A-exif.jpg",
  ]);
  await assertLoopbackPortAvailable();
});

test("X4 route harness verifies A-exif digest before serving and fails closed on drift", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();
  await assert.rejects(
    observeX4ExifOrientationRouteContainment({
      expectedBasisFingerprint: "f".repeat(64),
      canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
    }),
    /loopback_fixture_digest_drift:X4/
  );
  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();

  await assert.rejects(
    observeX4ExifOrientationRouteContainment({
      expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
      canonicalAExifRepoRelativePath: A_PARENT_CANONICAL_PATH,
    }),
    /canonical_a_exif_path_missing:X4/
  );
  await assertLoopbackPortAvailable();
});

test("X4 normal-orientation positive control reaches and trips the model boundary", async () => {
  const originalLoad = (Module as unknown as { _load: ModuleLoad })._load;
  const envBefore = getRouteEnvSnapshot();

  const control = await observeX4NormalOrientationRoutePreemptionControl({
    expectedParentBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
  });
  assert.equal(control.modelTripwireInvoked, true);
  assert.deepEqual(control.servedRequestPaths, ["GET /A-parent.jpg"]);

  assert.equal((Module as unknown as { _load: ModuleLoad })._load, originalLoad);
  assert.deepEqual(getRouteEnvSnapshot(), envBefore);
  await assertLoopbackPortAvailable();
});

test("X4 positive control fails closed on control digest drift", async () => {
  await assert.rejects(
    observeX4NormalOrientationRoutePreemptionControl({
      expectedParentBasisFingerprint: "0".repeat(64),
      canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
    }),
    /loopback_control_digest_drift:X4/
  );
  await assertLoopbackPortAvailable();
});

test("X4 route harness rejects reentry and restores the reentry lock afterwards", async () => {
  const firstRun = observeX4ExifOrientationRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
    canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
  });
  await assert.rejects(
    observeX4ExifOrientationRouteContainment({
      expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
      canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
    }),
    /route_harness_reentry_forbidden:X4/
  );
  const firstObservation = await firstRun;
  assert.equal(firstObservation.modelTripwireInvoked, false);

  const cleanObservation = await observeX4ExifOrientationRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
    canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
  });
  assert.equal(cleanObservation.modelTripwireInvoked, false);
  await assertLoopbackPortAvailable();
});

test("X4 route harness forbids production NODE_ENV", async () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = "production";
  try {
    await assert.rejects(
      observeX4ExifOrientationRouteContainment({
        expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
        canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
      }),
      /production_runtime_forbidden:X4/
    );
    await assert.rejects(
      observeX4NormalOrientationRoutePreemptionControl({
        expectedParentBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
        canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
      }),
      /production_runtime_forbidden:X4/
    );
  } finally {
    if (typeof previousNodeEnv === "undefined") {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = previousNodeEnv;
    }
  }
});

test("X4 harness runs leave repository receipt records untouched", async () => {
  const receiptsBefore = await collectJsonFileHashes(REPO_RECEIPTS_ROOT);
  await observeX4ExifOrientationRouteContainment({
    expectedBasisFingerprint: G0_SYNTHETIC_ASSETS["A-exif"].sha256,
    canonicalAExifRepoRelativePath: A_EXIF_CANONICAL_PATH,
  });
  await observeX4NormalOrientationRoutePreemptionControl({
    expectedParentBasisFingerprint: G0_SYNTHETIC_ASSETS["A-parent"].sha256,
    canonicalAParentRepoRelativePath: A_PARENT_CANONICAL_PATH,
  });
  assert.deepEqual(await collectJsonFileHashes(REPO_RECEIPTS_ROOT), receiptsBefore);
});
