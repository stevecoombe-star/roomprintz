import assert from "node:assert/strict";
import test from "node:test";

import {
  createPi3aAuthority,
  PI3A_GENERATION_A,
  PI3A_REAR_WALL,
  PI3A_RIGHT_WALL,
} from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { afcDiagnosticsAdminJson } from "./admin-auth.server";
import {
  AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
  AFC_ADMIN_VISUAL_OVERLAY_VERSION,
  assertAfcAdminVisualOverlayPrivacy,
  buildAfcAdminVisualOverlayV1,
  collectAfcAdminVisualOverlayPrivacyViolations,
  handleAfcDiagnosticsAdminVisualOverlayGet,
  overlayGeometryTransferAllowed,
  overlayPairAllowsIdentityUv,
  overlayPairIsExactGrid,
  resolveAfcDiagnosticVisualOverlay,
  type AfcDiagnosticVisualOverlayGenerationRecord,
  type AfcDiagnosticVisualOverlayLog,
  type AfcDiagnosticVisualOverlayStore,
} from "./admin-visual-overlay.server";
import type { AfcDiagnosticVisualCaseRecord } from "./admin-visual-evidence.server";
import type { AfcDiagnosticVisualMembershipRecord } from "./admin-visual-evidence.server";
import type { AfcDiagnosticVisualSessionRecord } from "./admin-visual-evidence.server";

const USER_A = "22222222-2222-4222-8222-222222222222";
const USER_B = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_A = "d5fe6ada-3e33-4555-a6bd-f3624e2ad81a";
const SESSION_B = "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const GEN_1 = "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";
const GEN_2 = "85feaef6-d53a-4a28-a557-04e6abb975d9";
const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

function authorityWithFloorPolygon(
  points: ReadonlyArray<{ x: number; y: number }>,
) {
  const authority = typicalAuthority();
  return {
    ...authority,
    floor: {
      ...authority.floor,
      sourceNormalizedPolygon: points,
    },
  };
}

function typicalAuthority(overrides?: Parameters<typeof createPi3aAuthority>[0]) {
  return createPi3aAuthority({
    generationId: GEN_1,
    walls: [PI3A_RIGHT_WALL, PI3A_REAR_WALL],
    ...overrides,
  });
}

function typicalGeneration(
  overrides: Partial<AfcDiagnosticVisualOverlayGenerationRecord> = {},
): AfcDiagnosticVisualOverlayGenerationRecord {
  const authority = typicalAuthority();
  return {
    id: GEN_1,
    roomId: ROOM_A,
    userId: USER_A,
    status: "ready",
    productionAuthority: authority,
    frameWidth: 1200,
    frameHeight: 800,
    originalSha256: SHA_A,
    originalDecodedWidth: 1200,
    originalDecodedHeight: 800,
    originalOrientation: 1,
    emptySha256: SHA_B,
    emptyDecodedWidth: 1200,
    emptyDecodedHeight: 800,
    emptyOrientation: 1,
    tiledSha256: SHA_C,
    tiledDecodedWidth: 1200,
    tiledDecodedHeight: 800,
    tiledOrientation: 1,
    ...overrides,
  };
}

class MemoryOverlayStore implements AfcDiagnosticVisualOverlayStore {
  cases = new Map<string, AfcDiagnosticVisualCaseRecord>();
  sessions = new Map<string, AfcDiagnosticVisualSessionRecord>();
  memberships = new Map<string, AfcDiagnosticVisualMembershipRecord>();
  generations = new Map<string, AfcDiagnosticVisualOverlayGenerationRecord>();
  failNext = false;

  async findCaseById(caseId: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("boom");
    }
    return this.cases.get(caseId) ?? null;
  }
  async findSessionById(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }
  async findMembership(sessionId: string, generationId: string) {
    return this.memberships.get(`${sessionId}:${generationId}`) ?? null;
  }
  async findGenerationById(generationId: string) {
    return this.generations.get(generationId) ?? null;
  }
}

function typicalStore(overrides?: {
  generation?: Partial<AfcDiagnosticVisualOverlayGenerationRecord>;
}): MemoryOverlayStore {
  const store = new MemoryOverlayStore();
  store.cases.set(CASE_1, {
    id: CASE_1,
    sessionId: SESSION_A,
    roomId: ROOM_A,
  });
  store.sessions.set(SESSION_A, {
    id: SESSION_A,
    roomId: ROOM_A,
    userId: USER_A,
    baseAssetId: null,
  });
  store.memberships.set(`${SESSION_A}:${GEN_1}`, {
    sessionId: SESSION_A,
    generationId: GEN_1,
  });
  store.generations.set(GEN_1, typicalGeneration(overrides?.generation));
  return store;
}

async function jsonBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function overlayRequest(artifact = "original") {
  return new Request(`http://localhost/overlay?artifact=${artifact}`);
}

test("ready authority projects floor order, unclamped points, and collision ids", () => {
  const floor = [
    { x: -0.05, y: 1.1 },
    { x: 1.05, y: 1.1 },
    { x: 0.8, y: 0.4 },
    { x: 0.2, y: 0.4 },
  ];
  const mutated = authorityWithFloorPolygon(floor);
  const overlay = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ productionAuthority: mutated }),
    kind: "original",
  });
  assert.equal(overlay.version, AFC_ADMIN_VISUAL_OVERLAY_VERSION);
  assert.equal(
    overlay.projectionVersion,
    AFC_ADMIN_VISUAL_OVERLAY_PROJECTION_VERSION,
  );
  assert.equal(overlay.artifactBasis, "original");
  assert.deepEqual(overlay.frame, { width: 1200, height: 800 });
  assert.ok(overlay.floorQuad);
  assert.equal(overlay.floorQuad.space, "source-normalized/v1");
  assert.deepEqual(overlay.floorQuad.points, floor);
  assert.equal(overlay.collisionEdges.length, 2);
  assert.deepEqual(
    overlay.collisionEdges.map((edge) => edge.id),
    ["rb_right", "rb_back"],
  );
  for (const edge of overlay.collisionEdges) {
    assert.equal(edge.points.length, 2);
    for (const point of edge.points) {
      assert.equal(typeof point.x, "number");
      assert.equal(typeof point.y, "number");
    }
  }
  assert.doesNotThrow(() => assertAfcAdminVisualOverlayPrivacy(overlay));
});

test("missing, unknown, running, and failed generations return empty overlays", () => {
  const missing = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ productionAuthority: null }),
    kind: "original",
  });
  assert.equal(missing.floorQuad, null);
  assert.deepEqual(missing.collisionEdges, []);

  const unknown = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: { schemaVersion: "lab-payload/v9" },
    }),
    kind: "original",
  });
  assert.equal(unknown.floorQuad, null);
  assert.deepEqual(unknown.collisionEdges, []);

  const running = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ status: "running" }),
    kind: "original",
  });
  assert.equal(running.floorQuad, null);
  assert.deepEqual(running.collisionEdges, []);

  const failed = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ status: "failed" }),
    kind: "original",
  });
  assert.equal(failed.floorQuad, null);
  assert.deepEqual(failed.collisionEdges, []);
});

test("floor absent and empty collision walls are independent", () => {
  const noFloor = authorityWithFloorPolygon([]);
  const floorMissing = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ productionAuthority: noFloor }),
    kind: "original",
  });
  assert.equal(floorMissing.floorQuad, null);
  assert.ok(floorMissing.collisionEdges.length > 0);

  const noWalls = typicalAuthority({ walls: [] });
  const wallsMissing = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ productionAuthority: noWalls }),
    kind: "original",
  });
  assert.ok(wallsMissing.floorQuad);
  assert.deepEqual(wallsMissing.collisionEdges, []);
});

test("EMPTY and TILED identity UV require the certified compatibility matrix", () => {
  const original = {
    fingerprint: SHA_A,
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  };
  const exact = {
    fingerprint: SHA_B,
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  };
  const rescaled = {
    fingerprint: SHA_B,
    decodedWidth: 600,
    decodedHeight: 400,
    orientation: 1,
  };
  const mismatch = {
    fingerprint: SHA_B,
    decodedWidth: 800,
    decodedHeight: 800,
    orientation: 1,
  };
  const tiledExact = {
    fingerprint: SHA_C,
    decodedWidth: 600,
    decodedHeight: 400,
    orientation: 1,
  };
  const tiledMismatch = {
    fingerprint: SHA_C,
    decodedWidth: 601,
    decodedHeight: 400,
    orientation: 1,
  };
  assert.equal(overlayPairAllowsIdentityUv(original, exact), true);
  assert.equal(overlayPairAllowsIdentityUv(original, rescaled), true);
  assert.equal(overlayPairAllowsIdentityUv(original, mismatch), false);
  assert.equal(overlayPairIsExactGrid(rescaled, tiledExact), true);
  assert.equal(overlayPairIsExactGrid(rescaled, tiledMismatch), false);
  assert.equal(
    overlayGeometryTransferAllowed({
      kind: "empty",
      original,
      empty: rescaled,
      tiled: tiledExact,
    }),
    true,
  );
  assert.equal(
    overlayGeometryTransferAllowed({
      kind: "tiled",
      original,
      empty: rescaled,
      tiled: tiledExact,
    }),
    true,
  );
  assert.equal(
    overlayGeometryTransferAllowed({
      kind: "tiled",
      original,
      empty: rescaled,
      tiled: tiledMismatch,
    }),
    false,
  );
  assert.equal(
    overlayGeometryTransferAllowed({
      kind: "tiled",
      original,
      empty: mismatch,
      tiled: exact,
    }),
    false,
  );
  assert.equal(
    overlayGeometryTransferAllowed({
      kind: "empty",
      original,
      empty: null,
      tiled: exact,
    }),
    false,
  );
});

test("EMPTY compatible copies ORIGINAL UV; incompatible EMPTY/TILED stay empty", () => {
  const authority = typicalAuthority();
  const compatible = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: authority,
      emptyDecodedWidth: 600,
      emptyDecodedHeight: 400,
      tiledDecodedWidth: 600,
      tiledDecodedHeight: 400,
    }),
    kind: "empty",
  });
  const original = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({ productionAuthority: authority }),
    kind: "original",
  });
  assert.deepEqual(compatible.floorQuad, original.floorQuad);
  assert.deepEqual(compatible.collisionEdges, original.collisionEdges);
  assert.deepEqual(compatible.frame, { width: 600, height: 400 });

  const tiled = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: authority,
      emptyDecodedWidth: 600,
      emptyDecodedHeight: 400,
      tiledDecodedWidth: 600,
      tiledDecodedHeight: 400,
    }),
    kind: "tiled",
  });
  assert.deepEqual(tiled.floorQuad, original.floorQuad);
  assert.deepEqual(tiled.frame, { width: 600, height: 400 });

  const incompatibleEmpty = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: authority,
      emptyDecodedWidth: 800,
      emptyDecodedHeight: 800,
    }),
    kind: "empty",
  });
  assert.equal(incompatibleEmpty.floorQuad, null);
  assert.deepEqual(incompatibleEmpty.collisionEdges, []);
  assert.deepEqual(incompatibleEmpty.frame, { width: 800, height: 800 });

  const tiledMismatch = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: authority,
      emptyDecodedWidth: 600,
      emptyDecodedHeight: 400,
      tiledDecodedWidth: 601,
      tiledDecodedHeight: 400,
    }),
    kind: "tiled",
  });
  assert.equal(tiledMismatch.floorQuad, null);
  assert.deepEqual(tiledMismatch.collisionEdges, []);

  const oriented = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: authority,
      emptyOrientation: 6,
    }),
    kind: "empty",
  });
  assert.equal(oriented.floorQuad, null);

  const missingDims = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: authority,
      emptyDecodedWidth: null,
      emptyDecodedHeight: null,
    }),
    kind: "empty",
  });
  assert.equal(missingDims.floorQuad, null);
});

test("nameless walls get deterministic ids and degenerate cameras empty collision", () => {
  const nameless = {
    ...PI3A_RIGHT_WALL,
    id: "",
  };
  const overlay = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: typicalAuthority({ walls: [nameless, PI3A_REAR_WALL] }),
    }),
    kind: "original",
  });
  assert.equal(overlay.collisionEdges[0]?.id, "wall-1");
  assert.equal(overlay.collisionEdges[1]?.id, "rb_back");

  const logs: string[] = [];
  const degenerate = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration({
      productionAuthority: typicalAuthority({
        pose: {
          position: { x: 0, y: 0, z: 0 },
          lookAt: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 1, z: 0 },
        },
      }),
    }),
    kind: "original",
    log: (reason) => logs.push(reason),
  });
  assert.ok(degenerate.floorQuad);
  assert.deepEqual(degenerate.collisionEdges, []);
  assert.ok(logs.some((reason) => reason.startsWith("camera_build:")));
});

test("overlay DTO privacy whitelist rejects authority and storage leakage", () => {
  const overlay = buildAfcAdminVisualOverlayV1({
    generation: typicalGeneration(),
    kind: "original",
  });
  const serialized = JSON.stringify(overlay);
  assert.doesNotMatch(
    serialized,
    /production_authority|frozenCamera|sourceNormalizedPolygon|worldXz|signedUrl|diagnosticPayload/,
  );
  assert.equal(collectAfcAdminVisualOverlayPrivacyViolations(overlay).length, 0);
  assert.ok(
    collectAfcAdminVisualOverlayPrivacyViolations({
      ...overlay,
      frozenCamera: { verticalFovDeg: 50 },
    }).length > 0,
  );
});

test("membership chain and cross-session generation are opaque 404s", async () => {
  const missingCase = typicalStore();
  missingCase.cases.clear();
  await assert.rejects(
    () =>
      resolveAfcDiagnosticVisualOverlay({
        store: missingCase,
        caseId: CASE_1,
        generationId: GEN_1,
        kind: "original",
      }),
    { name: "AfcDiagnosticVisualNotFoundError" },
  );

  const missingMembership = typicalStore();
  missingMembership.memberships.clear();
  await assert.rejects(
    () =>
      resolveAfcDiagnosticVisualOverlay({
        store: missingMembership,
        caseId: CASE_1,
        generationId: GEN_1,
        kind: "original",
      }),
    { name: "AfcDiagnosticVisualNotFoundError" },
  );

  const store = typicalStore();
  store.sessions.set(SESSION_B, {
    id: SESSION_B,
    roomId: ROOM_A,
    userId: USER_A,
    baseAssetId: null,
  });
  store.generations.set(GEN_2, typicalGeneration({ id: GEN_2 }));
  store.memberships.set(`${SESSION_B}:${GEN_2}`, {
    sessionId: SESSION_B,
    generationId: GEN_2,
  });
  await assert.rejects(
    () =>
      resolveAfcDiagnosticVisualOverlay({
        store,
        caseId: CASE_1,
        generationId: GEN_2,
        kind: "original",
      }),
    { name: "AfcDiagnosticVisualNotFoundError" },
  );

  const wrongRoom = typicalStore({ generation: { roomId: ROOM_B } });
  await assert.rejects(
    () =>
      resolveAfcDiagnosticVisualOverlay({
        store: wrongRoom,
        caseId: CASE_1,
        generationId: GEN_1,
        kind: "original",
      }),
    { name: "AfcDiagnosticVisualNotFoundError" },
  );

  const wrongUser = typicalStore({ generation: { userId: USER_B } });
  await assert.rejects(
    () =>
      resolveAfcDiagnosticVisualOverlay({
        store: wrongUser,
        caseId: CASE_1,
        generationId: GEN_1,
        kind: "original",
      }),
    { name: "AfcDiagnosticVisualNotFoundError" },
  );
});

test("overlay route auth, validation, headers, and empty-on-projection-failure", async () => {
  const logs: AfcDiagnosticVisualOverlayLog[] = [];
  const unauthorized = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: CASE_1,
    generationId: GEN_1,
    store: typicalStore(),
    authorize: async () => ({
      ok: false,
      response: afcDiagnosticsAdminJson({ error: "Unauthorized." }, 401),
    }),
    log: (entry) => logs.push(entry),
  });
  assert.equal(unauthorized.status, 401);

  const forbidden = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: CASE_1,
    generationId: GEN_1,
    store: typicalStore(),
    authorize: async () => ({
      ok: false,
      response: afcDiagnosticsAdminJson(
        { error: "Admin access required." },
        403,
      ),
    }),
    log: (entry) => logs.push(entry),
  });
  assert.equal(forbidden.status, 403);

  const admin = {
    ok: true as const,
    admin: { userId: ADMIN_ID, email: "admin@example.com" },
  };

  const badCase = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: "not-a-uuid",
    generationId: GEN_1,
    store: typicalStore(),
    authorize: async () => admin,
  });
  assert.equal(badCase.status, 400);
  assert.deepEqual(await jsonBody(badCase), { error: "Invalid request." });

  const badGeneration = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: CASE_1,
    generationId: "bad",
    store: typicalStore(),
    authorize: async () => admin,
  });
  assert.equal(badGeneration.status, 400);

  const missingArtifact = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: new Request("http://localhost/overlay"),
    caseId: CASE_1,
    generationId: GEN_1,
    store: typicalStore(),
    authorize: async () => admin,
  });
  assert.equal(missingArtifact.status, 400);

  const badArtifact = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest("overlay"),
    caseId: CASE_1,
    generationId: GEN_1,
    store: typicalStore(),
    authorize: async () => admin,
  });
  assert.equal(badArtifact.status, 400);

  const missing = typicalStore();
  missing.cases.clear();
  const notFound = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: CASE_1,
    generationId: GEN_1,
    store: missing,
    authorize: async () => admin,
  });
  assert.equal(notFound.status, 404);
  assert.deepEqual(await jsonBody(notFound), { error: "Not found." });

  const boom = typicalStore();
  boom.failNext = true;
  const serverError = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: CASE_1,
    generationId: GEN_1,
    store: boom,
    authorize: async () => admin,
    log: (entry) => logs.push(entry),
  });
  assert.equal(serverError.status, 500);
  assert.deepEqual(await jsonBody(serverError), { error: "Server error." });

  const success = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest("empty"),
    caseId: CASE_1,
    generationId: GEN_1,
    store: typicalStore(),
    authorize: async () => admin,
  });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("Cache-Control"), "private, no-store");
  assert.equal(success.headers.get("X-Content-Type-Options"), "nosniff");
  const body = await jsonBody(success);
  assert.equal(body.version, "afc-admin-visual-overlay/v1");
  assert.equal(body.projectionVersion, "afc-admin-world-to-image/v1");
  assert.equal(body.artifactBasis, "empty");
  assert.doesNotMatch(
    JSON.stringify(body),
    /production_authority|frozenCamera|sourceNormalizedPolygon|signedUrl|storage_path/,
  );

  const degenerate = await handleAfcDiagnosticsAdminVisualOverlayGet({
    request: overlayRequest(),
    caseId: CASE_1,
    generationId: GEN_1,
    store: typicalStore({
      generation: {
        productionAuthority: typicalAuthority({
          pose: {
            position: { x: 1, y: 1, z: 1 },
            lookAt: { x: 1, y: 1, z: 1 },
            up: { x: 0, y: 1, z: 0 },
          },
        }),
      },
    }),
    authorize: async () => admin,
    log: (entry) => logs.push(entry),
  });
  assert.equal(degenerate.status, 200);
  const degenerateBody = await jsonBody(degenerate);
  assert.equal(degenerateBody.version, "afc-admin-visual-overlay/v1");
  assert.deepEqual(degenerateBody.collisionEdges, []);
  assert.notEqual(degenerate.status, 500);
  void PI3A_GENERATION_A;
});
