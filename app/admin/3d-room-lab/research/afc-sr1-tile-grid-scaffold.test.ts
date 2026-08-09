import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  vibodeTileGridScaffoldAssist,
  type AfcSr1TileGridScaffoldEmptyInput,
} from "./afc-sr1-tile-grid-scaffold";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64"
);
const originalFetch = globalThis.fetch;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function empty(bytes = PIXEL): AfcSr1TileGridScaffoldEmptyInput {
  return {
    base64: bytes.toString("base64"),
    identity: {
      sha256: sha(bytes),
      byteCount: bytes.byteLength,
      decodedWidth: 1,
      decodedHeight: 1,
      mimeType: "image/png",
      orientation: 1,
    },
  };
}

async function withCompositor<T>(
  reply: () => { imageUrl: string; appliedAspectRatio?: string | null },
  fn: (requests: unknown[]) => Promise<T>
): Promise<T> {
  const previousUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const requests: unknown[] = [];
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://offline-compositor.invalid";
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://offline-compositor.invalid/api/vibode/stage-run");
    assert.equal(init?.method, "POST");
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply()), { status: 200 });
  };
  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = previousUrl;
  }
}

function args(input = empty()) {
  return {
    empty: input,
    resultAllowedHosts: ["unused.example.test"],
    maxOutputBytes: 1024 * 1024,
    fetchTimeoutMs: 1000,
    allowLocalhostHttp: false,
    generationTimeoutMs: 1000,
    dependencies: {
      now: () => new Date("2026-08-09T23:00:00.000Z"),
    },
  };
}

test("TS0 submits an exact EMPTY directly to compositor Stage 2 and records provenance", async () => {
  await withCompositor(
    () => ({ imageUrl: `data:image/png;base64,${PIXEL.toString("base64")}`, appliedAspectRatio: "4:3" }),
    async (requests) => {
      const result = await vibodeTileGridScaffoldAssist({
        ...args(),
        dependencies: { now: () => new Date("2026-08-09T23:00:00.000Z"), createRunId: () => "run-one" },
      });
      assert.equal(result.status, "generated");
      if (result.status !== "generated") return;
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0], {
        stage: 2,
        baseImageBase64: PIXEL.toString("base64"),
        modelVersion: "NBP",
        flooringPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
        researchProfile: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
        isContinuation: true,
        repairDamage: false,
        repaintWalls: false,
        heavyDeclutter: false,
        renovateRoom: false,
        aspectRatio: "auto",
      });
      assert.equal("vibodeRoomId" in (requests[0] as object), false);
      assert.equal(result.input.sha256, sha(PIXEL));
      assert.equal(result.tiled.identity.sha256, sha(PIXEL));
      assert.equal(result.tiled.identity.mimeType, "image/png");
      assert.equal(result.compatibility.tier, "exact_grid_compatible");
      assert.equal(result.compatibility.relativeAspectError, 0);
      assert.equal(result.provenance.runId, "run-one");
      assert.equal(result.provenance.appliedAspectRatio, "4:3");
      assert.equal(result.provenance.generationStatus, "generated");
    }
  );
});

test("TS0 requires a verified exact EMPTY and fails closed for unsupported or undecodable outputs", async () => {
  const badInput = {
    ...empty(),
    identity: { ...empty().identity, sha256: "a".repeat(64) },
  };
  const invalid = await vibodeTileGridScaffoldAssist({ ...args(badInput), dependencies: { createRunId: () => "bad-input" } });
  assert.deepEqual(invalid, { status: "failure", code: "invalid_empty_input", runId: "bad-input" });

  await withCompositor(
    () => ({ imageUrl: `data:image/jpeg;base64,${PIXEL.toString("base64")}` }),
    async () => {
      const result = await vibodeTileGridScaffoldAssist({ ...args(), dependencies: { createRunId: () => "wrong-mime" } });
      assert.equal(result.status, "failure");
      assert.equal(result.status === "failure" && result.code, "unsupported_output_mime");
    }
  );

  const corruptPng = Buffer.concat([PIXEL.subarray(0, 8), Buffer.from("not-a-real-png")]);
  await withCompositor(
    () => ({ imageUrl: `data:image/png;base64,${corruptPng.toString("base64")}` }),
    async () => {
      const result = await vibodeTileGridScaffoldAssist({ ...args(), dependencies: { createRunId: () => "decode-fail" } });
      assert.equal(result.status, "failure");
      assert.equal(result.status === "failure" && result.code, "output_decode_failed");
    }
  );
});

test("TS0 exposes aspect observability and rejects an incompatible generated basis", async () => {
  const sharp = (await import("sharp")).default;
  const wide = Buffer.from(
    await sharp({ create: { width: 2, height: 1, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .png()
      .toBuffer()
  );
  await withCompositor(
    () => ({ imageUrl: `data:image/png;base64,${wide.toString("base64")}` }),
    async () => {
      const result = await vibodeTileGridScaffoldAssist({ ...args(), dependencies: { createRunId: () => "incompatible" } });
      assert.equal(result.status, "failure");
      if (result.status !== "failure") return;
      assert.equal(result.code, "basis_incompatible");
      assert.equal(result.input?.decodedWidth, 1);
      assert.equal(result.tiled?.decodedWidth, 2);
      assert.equal(result.compatibility?.tier, "incompatible");
      assert.equal(result.compatibility?.relativeAspectError, 1);
    }
  );
});

test("TS0 intentionally has no cache: repeated calls create independent run identities and compositor requests", async () => {
  await withCompositor(
    () => ({ imageUrl: `data:image/png;base64,${PIXEL.toString("base64")}` }),
    async (requests) => {
      let serial = 0;
      const createRunId = () => `fresh-${++serial}`;
      const first = await vibodeTileGridScaffoldAssist({ ...args(), dependencies: { createRunId } });
      const second = await vibodeTileGridScaffoldAssist({ ...args(), dependencies: { createRunId } });
      assert.equal(first.status, "generated");
      assert.equal(second.status, "generated");
      if (first.status !== "generated" || second.status !== "generated") return;
      assert.equal(requests.length, 2);
      assert.notEqual(first.provenance.runId, second.provenance.runId);
    }
  );
});

test("TS0 containment imports only image transport, compatibility, and direct compositor execution", async () => {
  const source = await readFile(new URL("./afc-sr1-tile-grid-scaffold.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "ThreeRoomLab",
    "afc-verified-floor-apply",
    "afc-verified-camera",
    "gemini-floor-proposal",
    "afc-sr1-semantic-prior",
    "supabase",
    "vibodeGeminiUsageAccounting",
    "app/api/vibode/stage-run",
  ]) {
    assert.equal(new RegExp(`^import[^;]*${forbidden}`, "m").test(source), false, forbidden);
  }
  assert.equal(source.includes('from "@/lib/callCompositorVibodeStageRun"'), true);
  assert.equal(source.includes("isContinuation: true"), true);
});
