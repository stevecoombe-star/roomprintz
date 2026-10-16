import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";

import { executeHarmonizeExport, executeHarmonizeQaSubmission } from "./harmonize-export-client";
import {
  HarmonizeExportError,
  certifiedHarmonizeCamera,
  encodeRgbaPng,
  harmonizeCameraRecord,
  sha256HexBytes,
  type HarmonizeExportAuthority,
  type HarmonizeExportCamera,
  type HarmonizeFurnitureCapture,
} from "./harmonize-export";
import { planHarmonizeEnqueue, reportHarmonizeEnqueueMismatch } from "./harmonize-jobs/plan";
import { interpretProductionRuntimeResponse } from "@/lib/afc-v2-runtime/production-runtime-client";
import type { HarmonizeTrustedRoom } from "./harmonize-jobs/types";
import type { HarmonizeMaterialCatalog } from "./harmonize-materials";
import { effectiveMetricScale } from "./room-scale";
import {
  buildHarmonizeQaSubmission,
  createHarmonizeQaAttemptGate,
  fetchHarmonizeQaOutput,
  harmonizeQaErrorMessage,
  readHarmonizeQaJob,
  readHarmonizeQaRoom,
  submitHarmonizeQaAttempt,
} from "./harmonize-qa";

const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const GENERATION = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const WIDTH = 8;
const HEIGHT = 6;

const CAMERA: HarmonizeExportCamera = {
  projection: "frozen-production-perspective",
  verticalFovDeg: 50,
  aspect: WIDTH / HEIGHT,
  near: AFC_V2_RUNTIME_CAMERA_NEAR,
  far: AFC_V2_RUNTIME_CAMERA_FAR,
  frame: { width: WIDTH, height: HEIGHT },
  pose: {
    position: { x: 0, y: 1.4, z: 4 },
    lookAt: { x: 0, y: 0.4, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  },
};

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

function catalog(): HarmonizeMaterialCatalog {
  return {
    products: [{
      productId: "nico",
      name: "Nico Chair",
      primaryMaterial: "Chenille Helios",
      secondaryMaterial: "black metal legs",
    }],
    variants: [{
      variantId: "nico-helios",
      productId: "nico",
      finishLabel: "Helios",
      primaryMaterial: null,
      secondaryMaterial: null,
    }],
  };
}

function savedChair(uniformScale = 1.4): SceneObjectDefinition {
  return {
    objectId: "chair-1",
    assetId: "asset-chair-1",
    productId: "nico",
    variantId: "nico-helios",
    userSizeMultiplier: 1,
    transform: {
      position: { x: 0.2, y: 0, z: 1.5 },
      rotationDeg: { x: 0, y: 15, z: 0 },
      uniformScale,
    },
  };
}

function skippedObject(): SceneObjectDefinition {
  return {
    objectId: "skipped-1",
    assetId: "asset-skipped",
    transform: {
      position: { x: 3, y: 0, z: 3 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      uniformScale: 1,
    },
  };
}

function capture(scene: readonly SceneObjectDefinition[]): HarmonizeFurnitureCapture {
  const pixels = WIDTH * HEIGHT * 4;
  return {
    rgba: new Uint8Array(pixels),
    width: WIDTH,
    height: HEIGHT,
    contactShadowsHidden: 0,
    objects: [{
      objectId: "chair-1",
      assetId: "asset-live",
      productId: "nico",
      variantId: "nico-helios",
      positionM: { x: 9, y: 9, z: 9 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      userSizeMultiplier: 1,
      effectiveDimensionsM: { width: 1, height: 0.8, depth: 0.9 },
    }],
    unmountedObjectIds: ["skipped-1"],
    camera: CAMERA,
    certifiedCamera: CAMERA,
    roomScaleMultiplier: 1,
    certifiedMetricScale: 1,
    effectiveMetricScale: effectiveMetricScale(1, 1),
    generationId: GENERATION,
    materialCatalog: catalog(),
    sceneObjects: scene,
  };
}

function roomFor(
  scene: readonly SceneObjectDefinition[],
  background: Uint8Array,
): HarmonizeTrustedRoom {
  return {
    userId: USER,
    currentAfcGenerationId: GENERATION,
    roomScaleMultiplier: 1,
    certifiedMetricScale: 1,
    camera: {
      verticalFovDeg: CAMERA.verticalFovDeg,
      frame: CAMERA.frame,
      pose: CAMERA.pose,
    },
    sourceUserId: USER,
    sourceRoomId: ROOM,
    background,
    emptySha256: "11".repeat(32),
    originalSha256: "22".repeat(32),
    persistedObjects: scene,
    scene: { afcGenerationId: GENERATION, objects: scene },
    catalog: catalog(),
  };
}

async function withAdmin<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.VIBODE_ADMIN_EMAIL;
  process.env.VIBODE_ADMIN_EMAIL = "admin@example.com";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.VIBODE_ADMIN_EMAIL;
    else process.env.VIBODE_ADMIN_EMAIL = previous;
  }
}

test("QA submission uses the saved scene and the server accepts it", async () => {
  const background = new TextEncoder().encode("viewport-bytes");
  const scene = [savedChair(), skippedObject()];
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    backgroundBytes: background,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: capture(scene),
  });
  const chair = built.submission.objects[0];
  assert.ok(chair);
  assert.equal(chair.objectId, "chair-1");
  assert.equal(chair.assetId, "asset-chair-1");
  assert.deepEqual(chair.positionM, { x: 0.2, y: 0, z: 1.5 });
  assert.equal(chair.uniformScale, 1.4);
  assert.deepEqual(chair.effectiveDimensionsM, { width: 1, height: 0.8, depth: 0.9 });
  assert.deepEqual(built.submission.unmountedObjectIds, ["skipped-1"]);
  assert.equal(built.submission.sourceVersionId, VERSION);
  assert.equal("prompt" in built.submission, false);
  assert.equal("provider" in built.submission, false);
  const wire = JSON.parse(JSON.stringify(built.submission)) as typeof built.submission;
  const planned = await withAdmin(() => planHarmonizeEnqueue({
    actor: { userId: USER, email: "admin@example.com" },
    submission: wire,
    composite: built.composite,
    loadTrusted: async () => ({ ok: true, room: roomFor(scene, background) }),
    mode: "admin",
  }));
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(planned.insert.snapshot.objects[0]?.positionM.x, 0.2);
  assert.equal(planned.insert.snapshot.uniformScales[0]?.uniformScale, 1.4);
  assert.equal(planned.insert.sourceVersionId, VERSION);
});

test("QA submits the certified camera when room scale is 0.52", async () => {
  const certifiedMetricScale = 2;
  const roomScaleMultiplier = 0.52;
  const metricScale = effectiveMetricScale(certifiedMetricScale, roomScaleMultiplier);
  assert.notEqual(certifiedMetricScale, 1);
  assert.equal(roomScaleMultiplier, 0.52);
  assert.notEqual(metricScale, 1);
  const frozenPose = {
    position: { x: 2.1471, y: 1.9202, z: 2.0848 },
    lookAt: { x: 1.4115, y: 1.4215, z: 1.6263 },
    up: { x: -0.4331, y: 0.8667, z: -0.2477 },
  };
  const certifiedCamera = certifiedHarmonizeCamera({
    verticalFovDeg: CAMERA.verticalFovDeg,
    frame: CAMERA.frame,
    pose: frozenPose,
  });
  const realizedCamera = harmonizeCameraRecord({
    verticalFovDeg: certifiedCamera.verticalFovDeg,
    aspect: certifiedCamera.aspect,
    near: certifiedCamera.near,
    far: certifiedCamera.far,
    frame: certifiedCamera.frame,
    pose: {
      position: {
        x: frozenPose.position.x * metricScale,
        y: frozenPose.position.y * metricScale,
        z: frozenPose.position.z * metricScale,
      },
      lookAt: {
        x: frozenPose.lookAt.x * metricScale,
        y: frozenPose.lookAt.y * metricScale,
        z: frozenPose.lookAt.z * metricScale,
      },
      up: { ...frozenPose.up },
    },
  });
  assert.notDeepEqual(realizedCamera.pose, certifiedCamera.pose);
  const background = new TextEncoder().encode("viewport-bytes");
  const scene = [savedChair(), skippedObject()];
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    backgroundBytes: background,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: {
      ...capture(scene),
      camera: realizedCamera,
      certifiedCamera,
      roomScaleMultiplier,
      certifiedMetricScale,
      effectiveMetricScale: metricScale,
    },
  });
  assert.deepEqual(built.submission.camera.pose, frozenPose);
  assert.deepEqual(built.submission.objects[0]?.positionM, { x: 0.2, y: 0, z: 1.5 });
  assert.equal(built.submission.objects[0]?.uniformScale, 1.4);
  const room: HarmonizeTrustedRoom = {
    ...roomFor(scene, background),
    roomScaleMultiplier,
    certifiedMetricScale,
    camera: {
      verticalFovDeg: certifiedCamera.verticalFovDeg,
      frame: certifiedCamera.frame,
      pose: certifiedCamera.pose,
    },
  };
  await withAdmin(async () => {
    const accepted = await planHarmonizeEnqueue({
      actor: { userId: USER, email: "admin@example.com" },
      submission: built.submission,
      composite: built.composite,
      loadTrusted: async () => ({ ok: true, room }),
      mode: "admin",
    });
    assert.equal(accepted.ok, true);
    if (accepted.ok) {
      assert.equal(accepted.insert.snapshot.objects[0]?.positionM.x, 0.2);
      assert.equal(accepted.insert.snapshot.uniformScales[0]?.uniformScale, 1.4);
    }
    const realized = await planHarmonizeEnqueue({
      actor: { userId: USER, email: "admin@example.com" },
      submission: { ...built.submission, camera: realizedCamera },
      composite: built.composite,
      loadTrusted: async () => ({ ok: true, room }),
      mode: "admin",
    });
    assert.equal(realized.ok, false);
    if (!realized.ok) assert.equal(realized.code, "stale_scene");
  });
  const missing = capture(scene);
  delete (missing as { certifiedCamera?: unknown }).certifiedCamera;
  await assert.rejects(
    () => buildHarmonizeQaSubmission({
      roomId: ROOM,
      sourceVersionId: VERSION,
      idempotencyKey: KEY,
      backgroundBytes: background,
      roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
      capture: { ...missing, camera: certifiedCamera },
    }),
    (error: unknown) => error instanceof HarmonizeExportError
      && error.message === "Certified camera is not available for Harmonize testing.",
  );
  assert.equal(
    harmonizeQaErrorMessage("stale_scene"),
    "The current room view does not match its saved Harmonize references. Please refresh the room or report this issue.",
  );
  assert.equal(
    harmonizeQaErrorMessage("unsupported_aspect"),
    "This view is outside the supported room aspect ratios.",
  );
  assert.equal(harmonizeQaErrorMessage("unsupported_aspect").includes("4:3"), false);
});

test("QA accepts the stored frozen camera and the server rejects the manual camera", async () => {
  const certifiedMetricScale = 0.8587078045790216;
  const roomScaleMultiplier = 0.52;
  const metricScale = effectiveMetricScale(certifiedMetricScale, roomScaleMultiplier);
  const frame = CAMERA.frame;
  const storedPose = {
    position: { x: 2.147125, y: 1.920164, z: 2.084789 },
    lookAt: { x: 1.411506, y: 1.42152, z: 1.626292 },
    up: { x: -0.433086, y: 0.866653, z: -0.247688 },
  };
  const manualPose = {
    position: { x: 3.630524, y: 3.672853, z: 2.773113 },
    lookAt: { x: 2.999248, y: 3.101266, z: 2.24892 },
    up: { x: -0.526812, y: 0.812061, z: -0.251051 },
  };
  const storedCamera = certifiedHarmonizeCamera({
    verticalFovDeg: 59.8,
    frame,
    pose: storedPose,
  });
  const manualCamera = certifiedHarmonizeCamera({
    verticalFovDeg: 54.9,
    frame,
    pose: manualPose,
  });
  const background = new TextEncoder().encode("viewport-bytes");
  const scene = [savedChair(), skippedObject()];
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    backgroundBytes: background,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: {
      ...capture(scene),
      camera: harmonizeCameraRecord({
        verticalFovDeg: storedCamera.verticalFovDeg,
        aspect: storedCamera.aspect,
        near: storedCamera.near,
        far: storedCamera.far,
        frame: storedCamera.frame,
        pose: {
          position: {
            x: storedPose.position.x * metricScale,
            y: storedPose.position.y * metricScale,
            z: storedPose.position.z * metricScale,
          },
          lookAt: {
            x: storedPose.lookAt.x * metricScale,
            y: storedPose.lookAt.y * metricScale,
            z: storedPose.lookAt.z * metricScale,
          },
          up: storedPose.up,
        },
      }),
      certifiedCamera: storedCamera,
      roomScaleMultiplier,
      certifiedMetricScale,
      effectiveMetricScale: metricScale,
    },
  });
  assert.equal(built.submission.camera.verticalFovDeg, 59.8);
  assert.deepEqual(built.submission.camera.pose, storedPose);
  assert.deepEqual(built.submission.objects[0]?.positionM, { x: 0.2, y: 0, z: 1.5 });
  const room: HarmonizeTrustedRoom = {
    ...roomFor(scene, background),
    roomScaleMultiplier,
    certifiedMetricScale,
    camera: {
      verticalFovDeg: storedCamera.verticalFovDeg,
      frame: storedCamera.frame,
      pose: storedCamera.pose,
    },
  };
  const previous = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development";
  const lines: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    await withAdmin(async () => {
      const accepted = await planHarmonizeEnqueue({
        actor: { userId: USER, email: "admin@example.com" },
        submission: built.submission,
        composite: built.composite,
        loadTrusted: async () => ({ ok: true, room }),
        mode: "admin",
      });
      assert.equal(accepted.ok, true);
      if (accepted.ok) assert.equal(accepted.insert.snapshot.objects[0]?.positionM.x, 0.2);
      const manual = await planHarmonizeEnqueue({
        actor: { userId: USER, email: "admin@example.com" },
        submission: { ...built.submission, camera: manualCamera },
        composite: built.composite,
        loadTrusted: async () => ({ ok: true, room }),
        mode: "admin",
      });
      assert.equal(manual.ok, false);
      if (!manual.ok) assert.equal(manual.code, "stale_scene");
    });
  } finally {
    console.info = original;
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
  const logged = lines.find((line) => (
    typeof line[0] === "string" && line[0].startsWith("[vibode-harmonize] enqueue rejected")
  ));
  assert.ok(logged);
  const message = String(logged?.[0]);
  assert.match(message, /stage=camera/);
  assert.match(message, /submittedFov=54\.9/);
  assert.match(message, /trustedFov=59\.8/);
  assert.match(message, new RegExp(`roomId=${ROOM}`));
  assert.match(message, new RegExp(`sourceVersionId=${VERSION}`));
  assert.equal(message.includes("prompt"), false);
});

test("object position rejection logs submitted and trusted coordinates", async () => {
  const background = new TextEncoder().encode("viewport-bytes");
  const trustedChair = savedChair(1);
  const submittedChair: SceneObjectDefinition = {
    ...trustedChair,
    transform: {
      ...trustedChair.transform,
      position: { x: 1, y: 0, z: 0 },
    },
  };
  const trustedScene = [trustedChair, skippedObject()];
  const roomScaleMultiplier = 0.52;
  const certifiedMetricScale = 0.8587078045790216;
  const metricScale = effectiveMetricScale(certifiedMetricScale, roomScaleMultiplier);
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    backgroundBytes: background,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: {
      ...capture([submittedChair, skippedObject()]),
      roomScaleMultiplier,
      certifiedMetricScale,
      effectiveMetricScale: metricScale,
    },
  });
  assert.deepEqual(built.submission.objects[0]?.positionM, { x: 1, y: 0, z: 0 });
  assert.equal(built.submission.objects[0]?.positionM.x === 9, false);
  const room: HarmonizeTrustedRoom = {
    ...roomFor(trustedScene, background),
    roomScaleMultiplier,
    certifiedMetricScale,
  };
  const previous = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development";
  const lines: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args);
  };
  let rejectedCode = "";
  try {
    await withAdmin(async () => {
      const rejected = await planHarmonizeEnqueue({
        actor: { userId: USER, email: "admin@example.com" },
        submission: JSON.parse(JSON.stringify(built.submission)),
        composite: built.composite,
        loadTrusted: async () => ({ ok: true, room }),
        mode: "admin",
      });
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        rejectedCode = rejected.code;
        assert.equal("diagnostic" in rejected, false);
      }
    });
  } finally {
    console.info = original;
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
  assert.equal(rejectedCode, "stale_scene");
  const logged = lines.find((line) => (
    typeof line[0] === "string" && line[0].startsWith("[vibode-harmonize] enqueue rejected")
  ));
  assert.ok(logged);
  const message = String(logged?.[0]);
  assert.match(message, /stage=objects/);
  assert.match(message, /reason=position/);
  assert.match(message, /objectId=chair-1/);
  assert.match(message, /submittedX=1/);
  assert.match(message, /submittedY=0/);
  assert.match(message, /submittedZ=0/);
  assert.match(message, /trustedX=0\.2/);
  assert.match(message, /trustedY=0/);
  assert.match(message, /trustedZ=1\.5/);
  assert.match(message, new RegExp(`deltaX=${1 - 0.2}`));
  assert.match(message, /deltaY=0/);
  assert.match(message, new RegExp(`deltaZ=${0 - 1.5}`));
  assert.match(message, new RegExp(`effectiveScale=${metricScale}`));
  assert.equal(message.includes("prompt"), false);
  assert.equal(message.includes("submittedX=9"), false);
});

test("runtime keeps the stored frozen camera apart from the manual stage camera", () => {
  const storedPose = {
    position: { x: 2.147125, y: 1.920164, z: 2.084789 },
    lookAt: { x: 1.411506, y: 1.42152, z: 1.626292 },
    up: { x: -0.433086, y: 0.866653, z: -0.247688 },
  };
  const manualPose = {
    position: { x: 3.630524, y: 3.672853, z: 2.773113 },
    lookAt: { x: 2.999248, y: 3.101266, z: 2.24892 },
    up: { x: -0.526812, y: 0.812061, z: -0.251051 },
  };
  const frame = { width: 2048, height: 1536 };
  const ready = interpretProductionRuntimeResponse({
    ok: true,
    payload: {
      status: "ready",
      generationId: GENERATION,
      authority: { frozenCamera: { verticalFovDeg: 54.9, frame, pose: manualPose } },
      certifiedFrozenCamera: { verticalFovDeg: 59.8, frame, pose: storedPose },
      originalImageUrl: "https://images.example.test/original.jpg",
    },
  });
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  assert.equal(ready.certifiedFrozenCamera?.verticalFovDeg, 59.8);
  assert.deepEqual(ready.certifiedFrozenCamera?.pose, storedPose);
  assert.equal(ready.authority.frozenCamera.verticalFovDeg, 54.9);
  const missingPose = interpretProductionRuntimeResponse({
    ok: true,
    payload: {
      status: "ready",
      generationId: GENERATION,
      authority: { frozenCamera: { verticalFovDeg: 54.9, frame, pose: manualPose } },
      certifiedFrozenCamera: { verticalFovDeg: 59.8, frame },
      originalImageUrl: "https://images.example.test/original.jpg",
    },
  });
  assert.equal(missingPose.status, "ready");
  if (missingPose.status !== "ready") return;
  assert.equal(missingPose.certifiedFrozenCamera, null);
});

test("enqueue diagnostics stay off outside development and omit prompt text", () => {
  const previous = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  const lines: unknown[][] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args);
  };
  try {
    env.NODE_ENV = "production";
    reportHarmonizeEnqueueMismatch("camera", { submittedFov: 54.9, prompt: "do not log this prompt" });
    assert.equal(lines.length, 0);
    env.NODE_ENV = "development";
    reportHarmonizeEnqueueMismatch("camera", { submittedFov: 54.9, prompt: "do not log this prompt" });
    assert.equal(lines.length, 1);
    const message = String(lines[0]?.[0]);
    assert.match(message, /stage=camera/);
    assert.match(message, /submittedFov=54\.9/);
    assert.equal(message.includes("do not log this prompt"), false);
  } finally {
    console.info = original;
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
});

test("a saved scene or scale that differs from the version is refused", async () => {
  const background = new TextEncoder().encode("viewport-bytes");
  const scene = [savedChair(), skippedObject()];
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    backgroundBytes: background,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: capture(scene),
  });
  const moved = [savedChair(), skippedObject()];
  moved[0] = {
    ...moved[0]!,
    transform: {
      ...moved[0]!.transform,
      position: { x: 4, y: 0, z: 1.5 },
    },
  };
  const scaled = [savedChair(2), skippedObject()];
  await withAdmin(async () => {
    const position = await planHarmonizeEnqueue({
      actor: { userId: USER, email: "admin@example.com" },
      submission: built.submission,
      composite: built.composite,
      loadTrusted: async () => ({ ok: true, room: roomFor(moved, background) }),
      mode: "admin",
    });
    assert.equal(position.ok, false);
    if (!position.ok) assert.equal(position.code, "stale_scene");
    const scale = await planHarmonizeEnqueue({
      actor: { userId: USER, email: "admin@example.com" },
      submission: built.submission,
      composite: built.composite,
      loadTrusted: async () => ({ ok: true, room: roomFor(scaled, background) }),
      mode: "admin",
    });
    assert.equal(scale.ok, false);
    if (!scale.ok) assert.equal(scale.code, "stale_scene");
  });
  const withoutScene = capture(scene);
  delete (withoutScene as { sceneObjects?: unknown }).sceneObjects;
  await assert.rejects(
    () => buildHarmonizeQaSubmission({
      roomId: ROOM,
      sourceVersionId: VERSION,
      idempotencyKey: KEY,
      backgroundBytes: background,
      roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
      capture: withoutScene,
    }),
    /Saved scene is not available/,
  );
});

test("one explicit attempt keeps its idempotency key across transport retries", async () => {
  const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"];
  let issued = 0;
  const gate = createHarmonizeQaAttemptGate(() => {
    const next = ids[issued];
    issued += 1;
    if (!next) throw new Error("ids");
    return next;
  });
  const first = gate.start();
  assert.equal(first, ids[0]);
  assert.equal(gate.start(), null);
  gate.finish();
  assert.equal(gate.start(), ids[1]);

  const background = new TextEncoder().encode("viewport-bytes");
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: ids[0]!,
    backgroundBytes: background,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: capture([savedChair(), skippedObject()]),
  });
  let uploads = 0;
  let puts = 0;
  let enqueues = 0;
  const result = await submitHarmonizeQaAttempt({
    ...built,
    transportAttempts: 2,
    fetchImpl: async (url, init) => {
      const href = String(url);
      if (href.endsWith("/upload")) {
        uploads += 1;
        const body = JSON.parse(String(init?.body)) as { idempotencyKey?: string; path?: string };
        assert.equal(body.idempotencyKey, ids[0]);
        assert.equal("path" in body, false);
        if (uploads === 1) return new Response("busy", { status: 503 });
        return Response.json({ signedUrl: "https://signed.test/put", path: "secret/path", token: "secret" });
      }
      if (href === "https://signed.test/put") {
        puts += 1;
        assert.equal(init?.credentials, "omit");
        if (puts === 1) throw new Error("socket reset");
        return new Response(null, { status: 200 });
      }
      enqueues += 1;
      const body = JSON.parse(String(init?.body)) as { idempotencyKey?: string; provider?: string };
      assert.equal(body.idempotencyKey, ids[0]);
      assert.equal(body.provider, undefined);
      return Response.json({ jobId: KEY, status: "queued", created: true }, { status: 202 });
    },
  });
  assert.equal(uploads, 2);
  assert.equal(puts, 2);
  assert.equal(enqueues, 1);
  assert.equal(result.jobId, KEY);
  assert.equal(result.status, "queued");

  let conflicts = 0;
  await assert.rejects(
    () => submitHarmonizeQaAttempt({
      ...built,
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.endsWith("/upload")) return Response.json({ signedUrl: "https://signed.test/put" });
        if (href === "https://signed.test/put") return new Response(null, { status: 200 });
        conflicts += 1;
        return Response.json({ error: "stale_scene" }, { status: 409 });
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarmonizeExportError);
      assert.equal(error.message, harmonizeQaErrorMessage("stale_scene"));
      return true;
    },
  );
  assert.equal(conflicts, 1);
});

test("status polling and JPEG retrieval use the owner routes", async () => {
  const found = await readHarmonizeQaRoom({
    roomId: ROOM,
    fetchImpl: async (url, init) => {
      assert.equal(init?.method, "GET");
      assert.match(String(url), /roomId=22222222-2222-4222-8222-222222222222/);
      return Response.json({
        job: { id: KEY, status: "running", failureCode: null, failureMessage: null },
      });
    },
  });
  assert.equal(found.available, true);
  if (!found.available || !found.job) return;
  const polled = await readHarmonizeQaJob({
    jobId: found.job.id,
    fetchImpl: async (url, init) => {
      assert.equal(init?.method, "GET");
      assert.match(String(url), new RegExp(`/jobs/${KEY}$`));
      return Response.json({
        job: { id: KEY, status: "succeeded", failureCode: null, failureMessage: null },
      });
    },
  });
  assert.equal(polled?.status, "succeeded");
  const jpeg = await fetchHarmonizeQaOutput({
    jobId: KEY,
    fetchImpl: async (url, init) => {
      assert.equal(init?.credentials, "same-origin");
      assert.match(String(url), /\/output$/);
      return new Response(Uint8Array.of(1, 2, 3), { headers: { "content-type": "image/jpeg" } });
    },
  });
  assert.equal(jpeg.type, "image/jpeg");
  assert.equal(jpeg.size, 3);
  await assert.rejects(
    () => fetchHarmonizeQaOutput({
      jobId: KEY,
      fetchImpl: async () => new Response(Uint8Array.of(1), { headers: { "content-type": "image/png" } }),
    }),
    /not available/,
  );
  const unavailable = await readHarmonizeQaRoom({
    roomId: ROOM,
    fetchImpl: async () => new Response(JSON.stringify({ error: "Not found." }), { status: 404 }),
  });
  assert.deepEqual(unavailable, { available: false });
  const empty = await readHarmonizeQaRoom({
    roomId: ROOM,
    fetchImpl: async () => Response.json({ job: null }),
  });
  assert.deepEqual(empty, { available: true, job: null });
});

test("reopening a room reads the job from the server and does not keep it in the browser", async () => {
  const qa = source("lib/vibode-stage/harmonize-qa.ts");
  const header = source("components/stage/StageEditorHeader.tsx");
  const experience = source("components/stage/HarmonizeExperience.tsx");
  assert.match(experience, /\/api\/vibode\/harmonize\/jobs\?roomId=/);
  assert.doesNotMatch(qa, /localStorage|sessionStorage/);
  assert.doesNotMatch(header, /HarmonizeQaButton|Test Harmonize|Save JPEG/);
  const recovered = await readHarmonizeQaRoom({
    roomId: ROOM,
    fetchImpl: async () => Response.json({
      job: { id: KEY, status: "queued", failureCode: null, failureMessage: null },
    }),
  });
  assert.equal(recovered.available && recovered.job?.id, KEY);
  assert.equal(recovered.available && recovered.job?.status, "queued");
});

test("the permanent header action follows the server lookup and the server still authorizes it", () => {
  const header = source("components/stage/StageEditorHeader.tsx");
  const button = source("components/stage/HarmonizeExperience.tsx");
  const route = source("app/api/vibode/harmonize/jobs/route.ts");
  const upload = source("app/api/vibode/harmonize/jobs/upload/route.ts");
  const server = source("lib/vibode-stage/harmonize-jobs/jobs.server.ts");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  const lookup = server.slice(
    server.indexOf("export async function readHarmonizeRoomJob"),
    server.indexOf("export async function readHarmonizeGenerationOutput"),
  );
  assert.match(header, /<HarmonizeButton \/>/);
  assert.equal(header.match(/<HarmonizeButton \/>/g)?.length, 1);
  assert.doesNotMatch(header, /HarmonizeExportButton|HarmonizeQaButton|Download|Test Harmonize|Save JPEG|Harmonize Export/);
  assert.doesNotMatch(button, /\/api\/auth\/admin-access/);
  assert.doesNotMatch(button, /isAdmin/);
  assert.match(button, /access === "hidden"/);
  assert.match(button, /Harmonize is unavailable/);
  assert.match(button, /aria-label="Harmonize"/);
  assert.doesNotMatch(button, /Test Harmonize|Save JPEG|Harmonize Export/);
  assert.doesNotMatch(button, /VIBODE_HARMONIZE_PROVIDER|VIBODE_HARMONIZE_ALLOW_FAKE|saveOwnedVersionScene/);
  assert.match(get, /readHarmonizeActor\(\)/);
  assert.match(get, /readHarmonizeRoomJob/);
  assert.ok(get.indexOf("readHarmonizeActor") < get.indexOf("readHarmonizeRoomJob"));
  assert.match(lookup, /\.eq\("user_id", input\.userId\)/);
  assert.match(lookup, /\.eq\("room_id", input\.roomId\)/);
  assert.doesNotMatch(lookup, /prompt_text|composite_path|output_path|output_bucket/);
  assert.match(upload, /signedUrl: uploaded\.signedUrl/);
  assert.doesNotMatch(upload, /path:|token:/);
  assert.match(viewer, /sceneObjects: currentSerializedObjects\(\)/);
  assert.match(viewer, /camera: harmonizeCameraRecord\(activeWorld\.camera\)/);
  assert.match(viewer, /certifiedCamera: storedCertifiedCamera\s*\?\s*certifiedHarmonizeCamera\(storedCertifiedCamera\)/);
  assert.doesNotMatch(viewer, /certifiedHarmonizeCamera\(harmonizeAuthorityRef|certifiedHarmonizeCamera\(authority/);
  const runtimeRoute = source("app/api/vibode/afc/runtime/route.ts");
  assert.match(runtimeRoute, /readCertifiedFrozenCamera\(authority\.frozenCamera\)/);
  assert.doesNotMatch(runtimeRoute, /readCertifiedFrozenCamera\(validated|readCertifiedFrozenCamera\(restored/);
  assert.match(
    source("components/afc-3d/AfcIntegratedEditorViewport.tsx"),
    /harmonizeCertifiedCamera=\{runtime\.certifiedFrozenCamera\}/,
  );
  assert.match(viewer, /executeHarmonizeQaSubmission/);
  assert.match(viewer, /harmonizeInFlightRef/);
  const qa = source("lib/vibode-stage/harmonize-qa.ts");
  const exporter = source("lib/vibode-stage/harmonize-export.ts");
  const certifiedHelper = exporter.slice(
    exporter.indexOf("export function certifiedHarmonizeCamera"),
    exporter.indexOf("export function canonicalJson"),
  );
  const zip = exporter.slice(
    exporter.indexOf("export async function buildHarmonizeZip"),
    exporter.indexOf("export function zipStore"),
  );
  assert.doesNotMatch(certifiedHelper, /metricScale|roomScaleMultiplier/);
  assert.doesNotMatch(zip, /capture\.certifiedCamera/);
  assert.doesNotMatch(qa, /saveOwnedVersionScene|vibode_room_history|insert\(/);
  assert.doesNotMatch(qa, /capture\.camera/);
});

test("the ZIP export ignores QA scene rows and stays byte-identical", async () => {
  const room = Uint8Array.of(
    10, 20, 30, 255,
    40, 50, 60, 255,
    1, 2, 3, 255,
    9, 9, 9, 255,
  );
  const furniture = Uint8Array.of(
    255, 0, 0, 255,
    0, 0, 0, 0,
    255, 0, 0, 128,
    0, 0, 0, 0,
  );
  const emptyBytes = await encodeRgbaPng(room, 2, 2);
  const sha = await sha256HexBytes(emptyBytes);
  const authority: HarmonizeExportAuthority = {
    generationId: GENERATION,
    empty: { sha256: sha, decodedWidth: 2, decodedHeight: 2 },
    frame: { width: 2, height: 2 },
    frozenCamera: { frame: { width: 2, height: 2 } },
  };
  const saved: Uint8Array[] = [];
  const run = (withScene: boolean) => executeHarmonizeExport({
    roomId: ROOM,
    authority,
    now: () => new Date("2026-10-12T00:00:00.000Z"),
    backgroundUrl: "https://images.example.test/viewport.png",
    fetchBackground: async () => emptyBytes,
    save: (_fileName, bytes) => {
      saved.push(bytes);
    },
    captureFurniture: (size) => ({
      rgba: furniture,
      width: size.width,
      height: size.height,
      contactShadowsHidden: 1,
      objects: [{
        objectId: "chair-1",
        assetId: "asset-chair-1",
        productId: null,
        variantId: null,
        positionM: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        userSizeMultiplier: 1,
        effectiveDimensionsM: null,
      }],
      unmountedObjectIds: [],
      camera: {
        ...CAMERA,
        aspect: 1,
        frame: { width: 2, height: 2 },
      },
      roomScaleMultiplier: 1,
      certifiedMetricScale: 1,
      effectiveMetricScale: 1,
      generationId: GENERATION,
      ...(withScene ? {
        sceneObjects: [savedChair()],
        certifiedCamera: {
          ...CAMERA,
          aspect: 1,
          frame: { width: 2, height: 2 },
          pose: {
            position: { x: 9.87654321, y: 0, z: 0 },
            lookAt: { x: 0, y: 0, z: 0 },
            up: { x: 0, y: 1, z: 0 },
          },
        },
      } : {}),
    }),
  });
  await run(false);
  await run(true);
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0], saved[1]);
  assert.equal(Buffer.from(saved[0]!).includes(Buffer.from("sceneObjects")), false);
  assert.equal(Buffer.from(saved[0]!).includes(Buffer.from("uniformScale")), false);
  assert.equal(Buffer.from(saved[0]!).includes(Buffer.from("9.87654321")), false);
  assert.equal(Buffer.from(saved[1]!).includes(Buffer.from("1.4")), true);
});

test("QA capture runs once and refuses a missing saved version before rendering", async () => {
  const room = new Uint8Array(WIDTH * HEIGHT * 4);
  const png = await encodeRgbaPng(room, WIDTH, HEIGHT);
  const sha = await sha256HexBytes(png);
  const authority: HarmonizeExportAuthority = {
    generationId: GENERATION,
    empty: { sha256: sha, decodedWidth: WIDTH, decodedHeight: HEIGHT },
    frame: { width: WIDTH, height: HEIGHT },
    frozenCamera: { frame: { width: WIDTH, height: HEIGHT } },
  };
  let captures = 0;
  const built = await executeHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    authority,
    backgroundUrl: "https://images.example.test/viewport.png",
    fetchBackground: async () => png,
    captureFurniture: () => {
      captures += 1;
      return capture([savedChair(), skippedObject()]);
    },
  });
  assert.equal(captures, 1);
  assert.equal(built.submission.idempotencyKey, KEY);
  captures = 0;
  await assert.rejects(
    () => executeHarmonizeQaSubmission({
      roomId: ROOM,
      sourceVersionId: "not-a-version",
      idempotencyKey: KEY,
      authority,
      backgroundUrl: "https://images.example.test/viewport.png",
      fetchBackground: async () => png,
      captureFurniture: () => {
        captures += 1;
        return capture([savedChair(), skippedObject()]);
      },
    }),
    /Save this room version/,
  );
  assert.equal(captures, 0);
});
