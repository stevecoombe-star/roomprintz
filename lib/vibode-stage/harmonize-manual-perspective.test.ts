import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildManualPerspectiveRecord } from "@/lib/afc-v2-diagnostics/manual-perspective";
import {
  canonicalWorldRectangle,
  imagePointsFromQuad,
} from "@/lib/afc-v2-diagnostics/manual-perspective-geometry";
import type { ManualPerspectiveSolveResult } from "@/lib/afc-v2-diagnostics/manual-perspective-solve";
import { editorSceneObjectsFromAuthority } from "@/lib/afc-v2-runtime/editor-scene-objects";
import { resolveEffectiveProductionAuthority } from "@/lib/afc-v2-runtime/effective-production-authority";
import { createPi3aAuthority, PI3A_GENERATION_B } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import {
  certifiedHarmonizeCamera,
  harmonizeSceneCanonical,
  sha256HexBytes,
  type HarmonizeExportCamera,
} from "./harmonize-export";
import { planHarmonizeEnqueue } from "./harmonize-jobs/plan";
import { harmonizeTrustedRoomFromRecords } from "./harmonize-jobs/trust-records";
import type { HarmonizeTrustedRoom } from "./harmonize-jobs/types";
import type { HarmonizeMaterialCatalog } from "./harmonize-materials";
import { buildHarmonizeQaSubmission } from "./harmonize-qa";
import { effectiveMetricScale } from "./room-scale";

const USER = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const GENERATION = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const WIDTH = 8;
const HEIGHT = 6;
const BACKGROUND = new TextEncoder().encode("viewport-bytes");

const MANUAL_POSE = {
  verticalFovDeg: 48,
  position: { x: 0.35, y: 1.8, z: 3.7 },
  lookAt: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
};

const OTHER_MANUAL_POSE = {
  verticalFovDeg: 44,
  position: { x: -0.4, y: 2.1, z: 3.4 },
  lookAt: { x: 0.1, y: 0, z: 0.2 },
  up: { x: 0, y: 1, z: 0 },
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

function authority(): AfcV2ProductionRoomAuthority {
  return createPi3aAuthority({ generationId: GENERATION });
}

function chair(): SceneObjectDefinition {
  return {
    objectId: "chair-1",
    assetId: "asset-chair-1",
    productId: "nico",
    variantId: "nico-helios",
    userSizeMultiplier: 1,
    transform: {
      position: { x: 0.2, y: 0, z: 1.5 },
      rotationDeg: { x: 0, y: 15, z: 0 },
      uniformScale: 1,
    },
  };
}

function manualRecord(
  roomAuthority: AfcV2ProductionRoomAuthority,
  camera: typeof MANUAL_POSE,
  generationId = roomAuthority.generationId,
) {
  const points = imagePointsFromQuad(roomAuthority.floor.sourceNormalizedPolygon);
  const rectangle = canonicalWorldRectangle(
    roomAuthority.floor.worldWidthM,
    roomAuthority.floor.referenceDepthM,
  );
  assert.ok(points);
  assert.ok(rectangle);
  const solution: ManualPerspectiveSolveResult = {
    status: "converged",
    imagePoints: points,
    worldRectangle: rectangle,
    verticalFovDeg: camera.verticalFovDeg,
    pose: {
      position: camera.position,
      lookAt: camera.lookAt,
      up: camera.up,
    },
    objectivePx: 0.2,
    iterationCount: 4,
    convergenceReason: "test",
    elapsedMs: 2,
    applySafe: true,
  };
  const record = buildManualPerspectiveRecord({
    generationId,
    referenceDepthM: roomAuthority.floor.referenceDepthM,
    origin: "automatic_quad_adjustment",
    originalPoints: points,
    initialBootstrapPoints: null,
    solution,
    appliedAt: "2026-10-12T00:00:00.000Z",
  });
  assert.ok(record);
  return record;
}

function trustedRoom(manualPerspective: unknown): HarmonizeTrustedRoom {
  const loaded = harmonizeTrustedRoomFromRecords({
    userId: USER,
    roomId: ROOM,
    sourceVersionId: VERSION,
    room: {
      id: ROOM,
      user_id: USER,
      current_afc_generation_id: GENERATION,
      room_scale_multiplier: 1,
    },
    source: { id: VERSION, room_id: ROOM, user_id: USER },
    background: BACKGROUND,
    scene: { afc_generation_id: GENERATION, objects_json: [chair()] },
    generation: {
      id: GENERATION,
      room_id: ROOM,
      user_id: USER,
      status: "ready",
      production_authority: authority(),
      manual_perspective: manualPerspective,
      empty_sha256: "11".repeat(32),
      original_sha256: "22".repeat(32),
    },
    products: [{
      product_id: "nico",
      name: "Nico Chair",
      primary_material: "Chenille Helios",
      secondary_material: "black metal legs",
    }],
    variants: [{
      variant_id: "nico-helios",
      product_id: "nico",
      finish_label: "Helios",
      primary_material: null,
      secondary_material: null,
    }],
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("trusted room");
  return loaded.room;
}

function certifiedCamera(): HarmonizeExportCamera {
  return certifiedHarmonizeCamera(authority().frozenCamera);
}

async function enqueue(
  room: HarmonizeTrustedRoom,
  scene: readonly SceneObjectDefinition[],
  patch?: (submission: Record<string, unknown>) => void,
) {
  const roomAuthority = authority();
  const built = await buildHarmonizeQaSubmission({
    roomId: ROOM,
    sourceVersionId: VERSION,
    idempotencyKey: KEY,
    backgroundBytes: BACKGROUND,
    roomRgba: new Uint8Array(WIDTH * HEIGHT * 4),
    capture: {
      rgba: new Uint8Array(WIDTH * HEIGHT * 4),
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
      unmountedObjectIds: [],
      camera: certifiedCamera(),
      certifiedCamera: certifiedCamera(),
      roomScaleMultiplier: 1,
      certifiedMetricScale: roomAuthority.metric.metricScale,
      effectiveMetricScale: effectiveMetricScale(roomAuthority.metric.metricScale, 1),
      generationId: GENERATION,
      materialCatalog: catalog(),
      sceneObjects: scene,
    },
  });
  const wire = JSON.parse(JSON.stringify(built.submission)) as Record<string, unknown>;
  patch?.(wire);
  const planned = await withAdmin(() => planHarmonizeEnqueue({
    actor: { userId: USER, email: "admin@example.com" },
    submission: wire,
    composite: built.composite,
    loadTrusted: async () => ({ ok: true, room }),
    mode: "admin",
  }));
  return { built, planned };
}

async function rejectionLine(
  room: HarmonizeTrustedRoom,
  scene: readonly SceneObjectDefinition[],
  patch?: (submission: Record<string, unknown>) => void,
): Promise<string> {
  const previous = process.env.NODE_ENV;
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "development";
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((entry) => String(entry)).join(" "));
  };
  try {
    const { planned } = await enqueue(room, scene, patch);
    assert.equal(planned.ok, false);
    const line = lines.find((entry) => entry.includes("enqueue rejected"));
    assert.ok(line);
    return line;
  } finally {
    console.info = original;
    if (previous === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previous;
  }
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

test("scene GET and Harmonize share the authoritative manual-perspective remap", () => {
  const route = source("app/api/vibode/3d-scene/route.ts");
  const trust = source("lib/vibode-stage/harmonize-jobs/trust-records.ts");
  const jobs = source("lib/vibode-stage/harmonize-jobs/jobs.server.ts");
  const plan = source("lib/vibode-stage/harmonize-jobs/plan.ts");
  const shared = source("lib/afc-v2-runtime/editor-scene-objects.ts");
  assert.match(route, /editorSceneObjectsFromAuthority\(/);
  assert.match(trust, /editorSceneObjectsFromAuthority\(/);
  assert.match(trust, /direction: "to-effective"/);
  assert.match(jobs, /manual_perspective/);
  assert.match(shared, /mapSceneObjectsBetweenCameras\(/);
  assert.match(shared, /resolveEffectiveProductionAuthority\(/);
  assert.doesNotMatch(shared, /Math\.round|toFixed/);
  assert.doesNotMatch(route, /mapSceneObjectsBetweenCameras\(/);
  assert.doesNotMatch(plan, /manualPerspective|manual_perspective|editorSceneObjectsFromAuthority/);
  assert.doesNotMatch(trust, /\.update\(|\.insert\(|\.delete\(/);
  assert.match(source("lib/vibode-stage/harmonize-jobs/plan.ts"), /left\.x === right\.x && left\.y === right\.y && left\.z === right\.z/);
});

test("an automatic-perspective scene passes with stored coordinates", async () => {
  const room = trustedRoom(null);
  const stored = chair().transform.position;
  const trusted = room.scene.objects[0]?.transform.position;
  assert.ok(trusted);
  assert.equal(trusted.x, stored.x);
  assert.equal(trusted.y, stored.y);
  assert.equal(trusted.z, stored.z);
  assert.equal(room.camera.verticalFovDeg, authority().frozenCamera.verticalFovDeg);
  const { built, planned } = await enqueue(room, room.scene.objects);
  assert.equal(planned.ok, true);
  assert.deepEqual(built.submission.objects[0]?.positionM, stored);
  assert.equal(built.submission.objects[0]?.positionM.x === 9, false);
});

test("a manual-perspective scene passes after the shared effective remap", async () => {
  const roomAuthority = authority();
  const record = manualRecord(roomAuthority, MANUAL_POSE);
  const resolved = resolveEffectiveProductionAuthority(roomAuthority, record);
  assert.equal(resolved.kind, "manual");
  const room = trustedRoom(record);
  const placed = editorSceneObjectsFromAuthority({
    objects: [chair()],
    productionAuthority: roomAuthority,
    manualPerspective: record,
    direction: "to-effective",
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  const again = editorSceneObjectsFromAuthority({
    objects: [chair()],
    productionAuthority: roomAuthority,
    manualPerspective: record,
    direction: "to-effective",
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  const effective = placed.objects[0]?.transform.position;
  const repeated = again.objects[0]?.transform.position;
  const trusted = room.scene.objects[0]?.transform.position;
  assert.ok(effective && repeated && trusted);
  assert.equal(effective.x, repeated.x);
  assert.equal(effective.y, repeated.y);
  assert.equal(effective.z, repeated.z);
  assert.equal(trusted.x, effective.x);
  assert.equal(trusted.y, effective.y);
  assert.equal(trusted.z, effective.z);
  assert.notEqual(effective.x, 0.2);
  assert.equal(room.camera.verticalFovDeg, roomAuthority.frozenCamera.verticalFovDeg);
  assert.notEqual(room.camera.verticalFovDeg, MANUAL_POSE.verticalFovDeg);
  const roundTrip = JSON.parse(JSON.stringify(effective)) as typeof effective;
  assert.equal(roundTrip.x, effective.x);
  assert.equal(roundTrip.y, effective.y);
  assert.equal(roundTrip.z, effective.z);
  const { built, planned } = await enqueue(room, room.scene.objects);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  assert.equal(built.submission.objects[0]?.positionM.x, effective.x);
  assert.equal(built.submission.objects[0]?.positionM.y, effective.y);
  assert.equal(built.submission.objects[0]?.positionM.z, effective.z);
  assert.equal(planned.insert.sceneSnapshotSha256, built.submission.sceneSnapshotSha256);
  assert.deepEqual(planned.insert.sceneObjects[0]?.transform.position, chair().transform.position);
  assert.notEqual(planned.insert.sceneObjects[0]?.transform.position.x, effective.x);
  assert.equal(planned.insert.snapshot.objects[0]?.positionM.x, effective.x);
  assert.deepEqual(room.persistedObjects[0]?.transform.position, chair().transform.position);
  const storedHash = await sha256HexBytes(new TextEncoder().encode(harmonizeSceneCanonical({
    generationId: GENERATION,
    roomScaleMultiplier: built.submission.roomScaleMultiplier,
    certifiedMetricScale: built.submission.certifiedMetricScale,
    effectiveMetricScale: built.submission.effectiveMetricScale,
    camera: built.submission.camera,
    objects: built.submission.objects.map((object) => ({
      ...object,
      positionM: chair().transform.position,
    })),
    unmountedObjectIds: built.submission.unmountedObjectIds,
  })));
  assert.notEqual(storedHash, built.submission.sceneSnapshotSha256);
});

test("a genuine move in effective space still fails", async () => {
  const room = trustedRoom(manualRecord(authority(), MANUAL_POSE));
  const object = room.scene.objects[0];
  assert.ok(object);
  const moved: SceneObjectDefinition = {
    ...object,
    transform: {
      ...object.transform,
      position: { ...object.transform.position, x: object.transform.position.x + 0.25 },
    },
  };
  const line = await rejectionLine(room, [moved]);
  assert.match(line, /stage=objects/);
  assert.match(line, /reason=position/);
  assert.match(line, /objectId=chair-1/);
});

test("rotation and scale mismatches still fail in effective space", async () => {
  const room = trustedRoom(manualRecord(authority(), MANUAL_POSE));
  const object = room.scene.objects[0];
  assert.ok(object);
  const rotated: SceneObjectDefinition = {
    ...object,
    transform: {
      ...object.transform,
      rotationDeg: { ...object.transform.rotationDeg, y: object.transform.rotationDeg.y + 10 },
    },
  };
  const scaled: SceneObjectDefinition = {
    ...object,
    transform: { ...object.transform, uniformScale: 1.4 },
  };
  const rotation = await rejectionLine(room, [rotated]);
  const scale = await rejectionLine(room, [scaled]);
  assert.match(rotation, /stage=objects/);
  assert.match(rotation, /reason=rotation/);
  assert.match(scale, /stage=objects/);
  assert.match(scale, /reason=uniformScale/);
});

test("a different authoritative manual perspective fails", async () => {
  const roomAuthority = authority();
  const submitted = editorSceneObjectsFromAuthority({
    objects: [chair()],
    productionAuthority: roomAuthority,
    manualPerspective: manualRecord(roomAuthority, MANUAL_POSE),
    direction: "to-effective",
  });
  const room = trustedRoom(manualRecord(roomAuthority, OTHER_MANUAL_POSE));
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  const trusted = room.scene.objects[0]?.transform.position;
  const sent = submitted.objects[0]?.transform.position;
  assert.ok(trusted && sent);
  assert.notEqual(sent.x, trusted.x);
  const line = await rejectionLine(room, submitted.objects);
  assert.match(line, /stage=objects/);
  assert.match(line, /reason=position/);
});

test("a manual record for another generation does not remap the trusted scene", async () => {
  const roomAuthority = authority();
  const foreign = manualRecord(roomAuthority, MANUAL_POSE, PI3A_GENERATION_B);
  assert.equal(resolveEffectiveProductionAuthority(roomAuthority, foreign).kind, "automatic");
  const room = trustedRoom(foreign);
  const stored = chair().transform.position;
  const trusted = room.scene.objects[0]?.transform.position;
  assert.ok(trusted);
  assert.equal(trusted.x, stored.x);
  assert.equal(trusted.z, stored.z);
  const effective = editorSceneObjectsFromAuthority({
    objects: [chair()],
    productionAuthority: roomAuthority,
    manualPerspective: manualRecord(roomAuthority, MANUAL_POSE),
    direction: "to-effective",
  });
  assert.equal(effective.ok, true);
  if (!effective.ok) return;
  const rejected = await rejectionLine(room, effective.objects);
  assert.match(rejected, /stage=objects/);
  assert.match(rejected, /reason=position/);
  const { planned } = await enqueue(room, room.scene.objects);
  assert.equal(planned.ok, true);
});

test("an incorrect generation id still fails before the scene comparison", async () => {
  const room = trustedRoom(manualRecord(authority(), MANUAL_POSE));
  const line = await rejectionLine(room, room.scene.objects, (submission) => {
    submission.generationId = PI3A_GENERATION_B;
  });
  assert.match(line, /stage=generation/);
});

test("a client-supplied manual camera does not replace the certified camera", async () => {
  const room = trustedRoom(manualRecord(authority(), MANUAL_POSE));
  const manualCamera = certifiedHarmonizeCamera({
    verticalFovDeg: MANUAL_POSE.verticalFovDeg,
    frame: authority().frozenCamera.frame,
    pose: {
      position: MANUAL_POSE.position,
      lookAt: MANUAL_POSE.lookAt,
      up: MANUAL_POSE.up,
    },
  });
  const line = await rejectionLine(room, room.scene.objects, (submission) => {
    submission.camera = manualCamera;
  });
  assert.match(line, /stage=camera/);
  assert.equal(room.camera.verticalFovDeg, authority().frozenCamera.verticalFovDeg);
});
