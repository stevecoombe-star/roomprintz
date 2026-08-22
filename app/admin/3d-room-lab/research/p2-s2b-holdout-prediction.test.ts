import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import sharp from "sharp";

import {
  EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION,
  P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS,
} from "./empty-region-boundary-fragments";
import {
  EMPTY_VISIBLE_FLOOR_REGION_VERSION,
  P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS,
} from "./empty-visible-floor-region";
import {
  P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB,
  P2_S2B_CERTIFIED_REGION_MODULE_BLOB,
  P2_S2B_CERTIFIED_UI_GIT_SHA,
  type P2S2BFrozenPredictionReceipt,
  canonicalP2S2BPredictionReceiptJson,
  createP2S2BEphemeralIdentityAdapter,
  createP2S2BFrozenPredictionReceipt,
  hashP2S2BPredictionReceipt,
  parseP2S2BFrozenPredictionReceipt,
  readP2S2BFrozenHoldout,
} from "./p2-s2b-holdout-prediction";
import {
  type P2S2BHoldoutIdentity,
  parseP2S2BHoldoutIdentity,
} from "./p2-s2b-holdout-identity";

const execFileAsync = promisify(execFile);
const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);
const FIXTURE_ROOT = path.join(RESEARCH_ROOT, "fixtures");
const FIXED_INPUTS_ROOT = process.env.AFC_UI1_FIXED_INPUTS_ROOT ??
  path.join(
    os.homedir(),
    "Documents",
    "Vibode",
    "AFC",
    "vibode-afc-r3c-fixed-inputs"
  );
const ROOMS = ["room-b", "room-d"] as const;

type RoomId = typeof ROOMS[number];
type Holdout = Readonly<{
  roomId: RoomId;
  identityValue: unknown;
  identity: P2S2BHoldoutIdentity;
  manifest: {
    roomId: string;
    original: { sha256: string };
    emptyRoomAssist: {
      filePath: string;
      sha256: string;
      decodedWidth: number;
      decodedHeight: number;
      generatedFromOriginalSha256: string;
      generatorId: string;
    };
  };
  bytes: Uint8Array;
  persisted: P2S2BFrozenPredictionReceipt;
  sidecarHash: string;
  fresh: P2S2BFrozenPredictionReceipt;
  repeated: P2S2BFrozenPredictionReceipt;
  alternateDummy: P2S2BFrozenPredictionReceipt;
}>;

function parsedIdentity(value: unknown): P2S2BHoldoutIdentity {
  const parsed = parseP2S2BHoldoutIdentity(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.identity;
}

function parsedReceipt(value: unknown): P2S2BFrozenPredictionReceipt {
  const parsed = parseP2S2BFrozenPredictionReceipt(value);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.receipt;
}

function certifiedInputPath(identity: P2S2BHoldoutIdentity): string {
  const [rootName, ...relativeParts] = identity.sourceIdentity.split("/");
  assert.equal(rootName, path.basename(FIXED_INPUTS_ROOT));
  const resolved = path.resolve(FIXED_INPUTS_ROOT, ...relativeParts);
  assert.ok(resolved.startsWith(`${path.resolve(FIXED_INPUTS_ROOT)}${path.sep}`));
  return resolved;
}

async function loadHoldout(roomId: RoomId): Promise<Holdout> {
  const identityValue = JSON.parse(await readFile(path.join(
    FIXTURE_ROOT,
    "p2-s2b-holdout-identity",
    `${roomId}.json`
  ), "utf8")) as unknown;
  const identity = parsedIdentity(identityValue);
  const manifest = JSON.parse(await readFile(path.join(
    FIXED_INPUTS_ROOT,
    roomId,
    identity.manifestFileName
  ), "utf8")) as Holdout["manifest"];
  const bytes = await readFile(certifiedInputPath(identity));
  const persisted = parsedReceipt(JSON.parse(await readFile(path.join(
    FIXTURE_ROOT,
    "p2-s2b-holdout-predictions",
    `${roomId}.json`
  ), "utf8")) as unknown);
  const sidecarHash = (await readFile(path.join(
    FIXTURE_ROOT,
    "p2-s2b-holdout-predictions",
    `${roomId}.json.sha256`
  ), "utf8")).trim();
  const [fresh, repeated, alternateDummy] = await Promise.all([
    createP2S2BFrozenPredictionReceipt(bytes, identity, "a"),
    createP2S2BFrozenPredictionReceipt(bytes, identity, "a"),
    createP2S2BFrozenPredictionReceipt(bytes, identity, "b"),
  ]);
  return Object.freeze({
    roomId,
    identityValue,
    identity,
    manifest,
    bytes,
    persisted,
    sidecarHash,
    fresh,
    repeated,
    alternateDummy,
  });
}

let holdoutsPromise: Promise<readonly Holdout[]> | undefined;
function holdouts(): Promise<readonly Holdout[]> {
  holdoutsPromise ??= Promise.all(ROOMS.map(loadHoldout));
  return holdoutsPromise;
}

async function gitBlobSha1(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

async function walk(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const descendants = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  }));
  return descendants.flat();
}

test("P2-S2B identity cards strictly freeze exact B/D EMPTY inputs", async () => {
  for (const room of await holdouts()) {
    const digest = createHash("sha256").update(room.bytes).digest("hex");
    const metadata = await sharp(room.bytes).metadata();
    assert.equal(room.identity.roomId, room.roomId);
    assert.equal(digest, room.identity.emptySha256);
    assert.deepEqual(
      { width: metadata.width, height: metadata.height },
      room.identity.emptyDimensions
    );
    assert.equal(room.manifest.roomId, room.roomId);
    assert.equal(
      room.manifest.emptyRoomAssist.sha256,
      room.identity.emptySha256
    );
    assert.equal(
      room.manifest.emptyRoomAssist.decodedWidth,
      room.identity.emptyDimensions.width
    );
    assert.equal(
      room.manifest.emptyRoomAssist.decodedHeight,
      room.identity.emptyDimensions.height
    );
    assert.equal(
      room.manifest.emptyRoomAssist.generatorId,
      room.identity.generatorId
    );
    assert.equal(
      room.manifest.emptyRoomAssist.generatedFromOriginalSha256,
      room.identity.originalSha256
    );
    assert.equal(room.manifest.original.sha256, room.identity.originalSha256);
    assert.equal(
      path.basename(room.manifest.emptyRoomAssist.filePath),
      path.basename(room.identity.sourceIdentity)
    );
    const identityText = JSON.stringify(room.identityValue);
    assert.doesNotMatch(
      identityText,
      /annotation|polyline|quad|collisionEligible|expected|boundaryState/
    );
  }
});

test("P2-S2B frozen reader rejects stale bytes for both identities", async () => {
  for (const room of await holdouts()) {
    const stale = Uint8Array.from(room.bytes);
    stale[Math.floor(stale.length / 2)] ^= 1;
    const result = await readP2S2BFrozenHoldout(stale, room.identity);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        result.reason === "fixture_identity_mismatch" ||
        result.reason === "decode_failed"
      );
    }
  }
});

test("P2-S2B binds the certified Git, module, version, and parameter identity", async () => {
  await execFileAsync(
    "git",
    ["merge-base", "--is-ancestor", P2_S2B_CERTIFIED_UI_GIT_SHA, "HEAD"],
    { cwd: process.cwd() }
  );
  const { stdout: baselineRegionBlob } = await execFileAsync(
    "git",
    [
      "rev-parse",
      `${P2_S2B_CERTIFIED_UI_GIT_SHA}:app/admin/3d-room-lab/research/empty-visible-floor-region.ts`,
    ],
    { cwd: process.cwd() }
  );
  const { stdout: baselineFragmentBlob } = await execFileAsync(
    "git",
    [
      "rev-parse",
      `${P2_S2B_CERTIFIED_UI_GIT_SHA}:app/admin/3d-room-lab/research/empty-region-boundary-fragments.ts`,
    ],
    { cwd: process.cwd() }
  );
  assert.equal(
    baselineRegionBlob.trim(),
    P2_S2B_CERTIFIED_REGION_MODULE_BLOB
  );
  assert.equal(
    baselineFragmentBlob.trim(),
    P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB
  );
  assert.equal(
    await gitBlobSha1(path.join(RESEARCH_ROOT, "empty-visible-floor-region.ts")),
    P2_S2B_CERTIFIED_REGION_MODULE_BLOB
  );
  assert.equal(
    await gitBlobSha1(path.join(
      RESEARCH_ROOT,
      "empty-region-boundary-fragments.ts"
    )),
    P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB
  );
  assert.equal(
    EMPTY_VISIBLE_FLOOR_REGION_VERSION,
    "p2-s2a-visible-floor-region/v1"
  );
  assert.equal(
    EMPTY_REGION_BOUNDARY_FRAGMENT_VERSION,
    "p2-s2a-region-boundary-fragments/v1"
  );
  assert.deepEqual(P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS, {
    blurSigma: 2,
    roiYMinNormalized: 0.5,
    seedXMinNormalized: 0.45,
    seedXMaxNormalized: 0.55,
    seedYMinNormalized: 0.88,
    seedYMaxNormalized: 0.94,
    seedModelYMinNormalized: 0.82,
    seedModelYMaxNormalized: 0.95,
    seedModelStridePx: 4,
    minimumWarmChroma: 10,
    seedWarmChromaFraction: 0.25,
    maximumLuma: 245,
    seedLumaHeadroom: 160,
    maximumAdjacentUpperPerimeterJumpPx: 3,
  });
  assert.deepEqual(P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS, {
    classificationWindowColumns: 48,
    minimumPhysicalSupportPx: 48,
    sampleStridePx: 4,
    patchRadiusPx: 2,
    insideOffsetPx: 8,
    outsideOffsetPx: 8,
    maximumLineResidualPx: 4,
    maximumInsideSeedRgbDistance: 55,
    minimumInsideFloorLikeFraction: 0.75,
    maximumOutsideFloorLikeFraction: 0.2,
    minimumOutsideSeedRgbDistance: 18,
    minimumMeanLumaDrop: 20,
    minimumMeanRgbDistance: 30,
    minimumMeanWarmChromaDrop: 3,
    minimumInsideRegionSupportFraction: 0.8,
    minimumOutsideRegionExclusionFraction: 0.8,
    imageBorderMarginPx: 2,
  });
  assert.equal(readP2S2BFrozenHoldout.length, 2);
  for (const room of await holdouts()) {
    assert.equal(room.persisted.detector.uiGitSha, P2_S2B_CERTIFIED_UI_GIT_SHA);
    assert.deepEqual(
      room.persisted.frozenParameters.region,
      P2_S2A_VISIBLE_FLOOR_REGION_PARAMETERS
    );
    assert.deepEqual(
      room.persisted.frozenParameters.fragments,
      P2_S2A_BOUNDARY_FRAGMENT_PARAMETERS
    );
  }
});

test("P2-S2B dummy annotation geometry is non-collision and prediction-invariant", async () => {
  for (const room of await holdouts()) {
    const adapterA = createP2S2BEphemeralIdentityAdapter(room.identity, "a");
    const adapterB = createP2S2BEphemeralIdentityAdapter(room.identity, "b");
    assert.notDeepEqual(
      adapterA.annotations[0].pointsSourceNormalized,
      adapterB.annotations[0].pointsSourceNormalized
    );
    for (const adapter of [adapterA, adapterB]) {
      assert.equal(adapter.annotations[0].collisionEligible, false);
      assert.equal(adapter.annotations[0].boundaryState, "unknown");
    }
    const [readA, readB] = await Promise.all([
      readP2S2BFrozenHoldout(room.bytes, room.identity, "a"),
      readP2S2BFrozenHoldout(room.bytes, room.identity, "b"),
    ]);
    assert.deepEqual(readB, readA);
    assert.deepEqual(room.alternateDummy, room.fresh);
  }
});

test("P2-S2B receipts strictly reproduce fresh deterministic predictions", async () => {
  const receiptHashes: string[] = [];
  for (const room of await holdouts()) {
    assert.deepEqual(room.repeated, room.fresh);
    assert.deepEqual(room.persisted, room.fresh);
    assert.deepEqual(room.persisted.input, room.identity);
    assert.equal(
      room.persisted.input.emptySha256,
      createHash("sha256").update(room.bytes).digest("hex")
    );
    const direct = await readP2S2BFrozenHoldout(room.bytes, room.identity);
    assert.equal(
      room.persisted.outcome.status,
      direct.ok ? "ok" : "failed_closed"
    );
    if (direct.ok && room.persisted.outcome.status === "ok") {
      assert.deepEqual(room.persisted.outcome.fragments, direct.fragments);
    }
    const hash = hashP2S2BPredictionReceipt(room.persisted);
    assert.equal(hash, room.sidecarHash);
    assert.match(hash, /^[a-f0-9]{64}$/);
    receiptHashes.push(hash);
    const reordered = {
      outcome: room.persisted.outcome,
      frozenParameters: room.persisted.frozenParameters,
      input: room.persisted.input,
      detector: room.persisted.detector,
      version: room.persisted.version,
    } as P2S2BFrozenPredictionReceipt;
    assert.equal(
      canonicalP2S2BPredictionReceiptJson(reordered),
      canonicalP2S2BPredictionReceiptJson(room.persisted)
    );
    assert.equal(
      parseP2S2BFrozenPredictionReceipt({
        ...room.persisted,
        unexpected: true,
      }).ok,
      false
    );
    assert.doesNotThrow(() => {
      assert.equal(parseP2S2BFrozenPredictionReceipt({
        ...room.persisted,
        frozenParameters: {
          ...room.persisted.frozenParameters,
          region: {
            ...room.persisted.frozenParameters.region,
            blurSigma: undefined,
          },
        },
      }).ok, false);
    });
    if (room.persisted.outcome.status === "ok") {
      const first = room.persisted.outcome.fragments[0];
      assert.ok(first);
      assert.equal(parseP2S2BFrozenPredictionReceipt({
        ...room.persisted,
        outcome: {
          ...room.persisted.outcome,
          fragments: [first, first],
        },
      }).ok, false);
      assert.equal(parseP2S2BFrozenPredictionReceipt({
        ...room.persisted,
        outcome: {
          ...room.persisted.outcome,
          fragments: [
            {
              ...first,
              startEndpoint: {
                ...first.startEndpoint,
                status: ["visible"],
              },
            },
            ...room.persisted.outcome.fragments.slice(1),
          ],
        },
      }).ok, false);
    }
  }
  assert.notEqual(receiptHashes[0], receiptHashes[1]);
});

test("P2-S2B Pass 1 has no holdout oracle, scorer, leakage, or product importer", async () => {
  const allFiles = (await Promise.all(
    ["app", "components", "lib"].map(directory =>
      walk(path.join(process.cwd(), directory))
    )
  )).flat();
  assert.equal(
    allFiles.some(filePath =>
      filePath.toLowerCase().includes("p2-s2b-holdout-oracle")
    ),
    false
  );
  const predictionSource = await readFile(path.join(
    RESEARCH_ROOT,
    "p2-s2b-holdout-prediction.ts"
  ), "utf8");
  assert.doesNotMatch(
    predictionSource,
    /evaluateEmptyRegionBoundaryFragments|interpretP2S2ARegionFirstExperiment/
  );
  assert.doesNotMatch(
    predictionSource,
    /TILED|calibration|perspective|worldXZ|camera|holdout-oracle/
  );
  const productImporters: string[] = [];
  for (const filePath of allFiles) {
    if (
      !/\.(ts|tsx)$/.test(filePath) ||
      filePath.startsWith(`${RESEARCH_ROOT}${path.sep}`)
    ) continue;
    const source = await readFile(filePath, "utf8");
    if (source.includes("p2-s2b-holdout-")) productImporters.push(filePath);
  }
  assert.deepEqual(productImporters, []);
  const p2s2bFixtures = (await walk(FIXTURE_ROOT)).filter(filePath =>
    filePath.includes("p2-s2b")
  );
  assert.equal(
    p2s2bFixtures.some(filePath =>
      /dummy|adapter|oracle|scor/i.test(path.basename(filePath))
    ),
    false
  );
});

test("P2-S2B raw blinded prediction facts remain reportable without interpretation", async () => {
  for (const room of await holdouts()) {
    const { persisted } = room;
    if (persisted.outcome.status !== "ok") {
      console.log("P2-S2B FROZEN HOLDOUT", JSON.stringify({
        roomId: room.roomId,
        status: persisted.outcome.status,
        reason: persisted.outcome.reason,
        receiptSha256: room.sidecarHash,
      }));
      continue;
    }
    const counts = persisted.outcome.fragments.reduce(
      (value, item) => {
        value[item.boundaryState] += 1;
        return value;
      },
      { physical_wall: 0, unknown: 0, frame_truncated: 0 }
    );
    console.log("P2-S2B FROZEN HOLDOUT", JSON.stringify({
      roomId: room.roomId,
      status: persisted.outcome.status,
      seed: {
        pointSourcePx: persisted.outcome.region.seed.pointSourcePx,
        patchMeanRgb: persisted.outcome.region.seed.patchMeanRgb,
        patchMeanLuma: persisted.outcome.region.seed.patchMeanLuma,
        patchMeanWarmChroma:
          persisted.outcome.region.seed.patchMeanWarmChroma,
        effectiveMinimumWarmChroma:
          persisted.outcome.region.seed.effectiveMinimumWarmChroma,
        effectiveMaximumLuma:
          persisted.outcome.region.seed.effectiveMaximumLuma,
        appearancePrototypeCount:
          persisted.outcome.region.seed.appearancePrototypes.length,
      },
      region: {
        componentPixelCount:
          persisted.outcome.region.componentPixelCount,
        componentFraction: persisted.outcome.region.componentFraction,
        componentBoundsSourcePx:
          persisted.outcome.region.componentBoundsSourcePx,
        boundaryPixelCount: persisted.outcome.region.boundaryPixelCount,
        upperPerimeterSpanCount:
          persisted.outcome.region.upperPerimeterSpanCount,
        frameContactSpanCount:
          persisted.outcome.region.frameContactSpanCount,
        componentMaskSha256:
          persisted.outcome.region.componentMaskSha256,
      },
      fragmentCounts: counts,
      physicalFragmentSourcePixelLengths: persisted.outcome.fragments
        .filter(item => item.boundaryState === "physical_wall")
        .map(item => item.verification.sourcePixelLength),
      receiptSha256: room.sidecarHash,
    }));
  }
});
