/**
 * Platform body limit for generation intake. These tests do not call Meshy
 * or create a hosted object.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MESHY_IMAGE_MAX_BYTES } from "@/lib/vibode-furniture/generator/images";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";

import { estimateMeshy71Credits } from "./credits";
import { createGenerationDatabase } from "./engine";
import type { GenerationHttpDeps } from "./http";
import { postFurnitureGeneration } from "./http";
import { createMemoryGenerationCommands } from "./memory-commands";
import { createMemoryBucketStore } from "./objects";
import {
  betaFrontPhotoBytesAllowed,
  FIRST_GENERATION_JPEG_MAX_BYTES,
  GENERATION_REQUEST_BODY_MAX_BYTES,
  generationRequestBodyLimit,
  imagesFitGenerationTransport,
} from "./transport";

test("the first production JPEG fits the platform body and reserves 30 credits", () => {
  assert.equal(FIRST_GENERATION_JPEG_MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(betaFrontPhotoBytesAllowed(FIRST_GENERATION_JPEG_MAX_BYTES), true);
  assert.equal(betaFrontPhotoBytesAllowed(FIRST_GENERATION_JPEG_MAX_BYTES + 1), false);
  assert.equal(betaFrontPhotoBytesAllowed(0), false);
  assert.equal(imagesFitGenerationTransport([FIRST_GENERATION_JPEG_MAX_BYTES]), true);
  assert.equal(imagesFitGenerationTransport([4 * 1024 * 1024]), false);
  assert.equal(imagesFitGenerationTransport([MESHY_IMAGE_MAX_BYTES]), false);
  assert.equal(MESHY_IMAGE_MAX_BYTES, 20 * 1024 * 1024);
  const settings = defaultFurnitureGeneratorSettings();
  assert.equal(settings.geometryResolution, "standard");
  assert.equal(settings.shouldTexture, true);
  assert.equal(settings.textureResolution, "2k");
  assert.equal(estimateMeshy71Credits(settings, "image-to-3d"), 30);
});

test("a declared body over 4.5 MB is too large and a missing length is unchecked", () => {
  assert.equal(generationRequestBodyLimit(null), "ok");
  assert.equal(generationRequestBodyLimit(String(GENERATION_REQUEST_BODY_MAX_BYTES)), "ok");
  assert.equal(generationRequestBodyLimit(String(GENERATION_REQUEST_BODY_MAX_BYTES + 1)), "too_large");
  assert.equal(generationRequestBodyLimit("nope"), "unreadable");
});

test("an oversized generation body is refused before a job or object exists", async () => {
  const db = createGenerationDatabase();
  db.controls.liveEnabled = true;
  const commands = createMemoryGenerationCommands(db, { nowMs: 1_700_000_000_000 });
  const objects = createMemoryBucketStore();
  let puts = 0;
  const deps: GenerationHttpDeps = {
    authorize: async () => ({ ok: true, userId: "11111111-1111-4111-8111-111111111111", email: "admin@example.com" }),
    commands,
    objects: {
      ...objects,
      put: async (input) => {
        puts += 1;
        return objects.put(input);
      },
    },
    env: { VIBODE_MESHY_GENERATION_ENABLED: "true" },
    isAdmin: () => true,
    nowMs: () => 1_700_000_000_000,
  };
  await commands.grantPaidSubmission(true);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(GENERATION_REQUEST_BODY_MAX_BYTES + 1));
      controller.close();
    },
  });
  const result = await postFurnitureGeneration(new Request("https://vibode.local/generation", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit), deps);
  assert.equal(result.status, 413);
  assert.equal((result.body as { error: string }).error, "The photo is too large to send.");
  assert.equal(db.jobs.length, 0);
  assert.equal(puts, 0);
  assert.equal(readFileSync("app/api/vibode/furniture-generations/route.ts", "utf8").includes("maxDuration = 60"), true);
});
