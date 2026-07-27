/**
 * Empty-Room ingress MIME truthfulness. All compositor/result fetches are
 * injected through a global fetch trap; no network request can escape.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  detectEmptyRoomImageMime,
  getCachedEmptyRoomImage,
  getOrGenerateEmptyRoomImage,
} from "./vibodeEmptyRoomAssist";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64"
);
const originalFetch = globalThis.fetch;
let requestSequence = 0;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function imageBytes(format: "jpeg" | "webp"): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const image = sharp({ create: { width: 2, height: 3, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } });
  return format === "jpeg" ? Buffer.from(await image.jpeg().toBuffer()) : Buffer.from(await image.webp().toBuffer());
}

async function withCompositorFetch<T>(
  imageUrl: string,
  fetchImpl: typeof globalThis.fetch,
  fn: (originalHash: string) => Promise<T>
): Promise<T> {
  const previousUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://offline-compositor.invalid";
  globalThis.fetch = fetchImpl;
  try {
    requestSequence += 1;
    return await fn(digest(`${imageUrl}-${requestSequence}`));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = previousUrl;
  }
}

function stageRunArgs(originalHash: string) {
  return {
    originalHash,
    baseImageUrl: "https://original.example.test/room.png",
    resultAllowedHosts: ["ignored.invalid"],
    maxBytes: 1024 * 1024,
    fetchTimeoutMs: 1000,
    allowLocalhostHttp: true,
    generationTimeoutMs: 1000,
  };
}

test("data URLs admit only matching PNG, JPEG, and WebP bytes", async () => {
  const fixtures: Array<[string, Buffer]> = [
    ["image/png", PNG],
    ["image/jpeg", await imageBytes("jpeg")],
    ["image/webp", await imageBytes("webp")],
  ];
  for (const [mime, bytes] of fixtures) {
    const url = `data:${mime};base64,${bytes.toString("base64")}`;
    let originalHash = "";
    const result = await withCompositorFetch(
      url,
      async () => new Response(JSON.stringify({ imageUrl: url }), { status: 200 }),
      async (hash) => {
        originalHash = hash;
        return getOrGenerateEmptyRoomImage(stageRunArgs(hash));
      }
    );
    assert.equal(result.ok, true, mime);
    if (!result.ok) continue;
    assert.equal(result.image.mime, mime);
    assert.deepEqual(Buffer.from(result.image.base64, "base64"), bytes);
    assert.equal(result.image.byteCount, bytes.byteLength);
    assert.equal(result.image.provenance.imageTransport, "data_url");
    assert.equal(getCachedEmptyRoomImage(originalHash), result.image);
  }
});

test("data URL MIME mismatches and unsupported bytes fail without cache admission", async () => {
  const jpeg = await imageBytes("jpeg");
  const cases: Array<[string, string]> = [
    [`data:image/png;base64,${jpeg.toString("base64")}`, "mime_mismatch"],
    [`data:image/jpeg;base64,${PNG.toString("base64")}`, "mime_mismatch"],
    [`data:image/webp;base64,${PNG.toString("base64")}`, "mime_mismatch"],
    [`data:image/png;base64,${Buffer.from("not-an-image").toString("base64")}`, "decode"],
  ];
  for (const [url, stage] of cases) {
    let originalHash = "";
    const result = await withCompositorFetch(
      url,
      async () => new Response(JSON.stringify({ imageUrl: url }), { status: 200 }),
      async (hash) => {
        originalHash = hash;
        return getOrGenerateEmptyRoomImage(stageRunArgs(hash));
      }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.stage, stage);
      assert.equal(result.reason, stage === "mime_mismatch"
        ? "Empty-room result MIME did not match the image bytes."
        : "Empty-room result type is not supported (allowed: jpeg, png, webp).");
    }
    assert.equal(getCachedEmptyRoomImage(originalHash), null);
  }
});

test("HTTP results require Content-Type MIME to match exact result bytes", async () => {
  const jpeg = await imageBytes("jpeg");
  const rows: Array<[string, Buffer, string, boolean]> = [
    ["image/png", PNG, "image/png", true],
    ["image/jpeg", jpeg, "image/jpeg", true],
    ["image/jpeg", PNG, "image/jpeg", false],
    ["image/png", jpeg, "image/png", false],
  ];
  for (const [declaredMime, bytes, expectedMime, shouldPass] of rows) {
    let originalHash = "";
    const result = await withCompositorFetch(
      "http://localhost:3000/offline-empty",
      async (input) => {
        const url = String(input);
        if (url.includes("offline-compositor.invalid")) {
          return new Response(JSON.stringify({ imageUrl: "http://localhost:3000/offline-empty" }), { status: 200 });
        }
        return new Response(Uint8Array.from(bytes), { status: 200, headers: { "content-type": declaredMime } });
      },
      async (hash) => {
        originalHash = hash;
        return getOrGenerateEmptyRoomImage(stageRunArgs(hash));
      }
    );
    assert.equal(result.ok, shouldPass, `${declaredMime}/${expectedMime}`);
    if (shouldPass && result.ok) {
      assert.equal(result.image.mime, expectedMime);
      assert.deepEqual(Buffer.from(result.image.base64, "base64"), bytes);
      assert.equal(result.image.provenance.imageTransport, "http_url");
      assert.equal(getCachedEmptyRoomImage(originalHash), result.image);
    } else if (!result.ok) {
      assert.equal(result.stage, "mime_mismatch");
      assert.equal(result.reason, "Empty-room result MIME did not match the image bytes.");
      assert.equal(getCachedEmptyRoomImage(originalHash), null);
    }
  }
});

test("HTTP redirects cannot bypass MIME verification", async () => {
  let originalHash = "";
  const result = await withCompositorFetch(
    "http://localhost:3000/redirect",
    async (input) => {
      const url = String(input);
      if (url.includes("offline-compositor.invalid")) {
        return new Response(JSON.stringify({ imageUrl: "http://localhost:3000/redirect" }), { status: 200 });
      }
      if (url.endsWith("/redirect")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://localhost:3000/final" },
        });
      }
      return new Response(PNG, { status: 200, headers: { "content-type": "image/jpeg" } });
    },
    async (hash) => {
      originalHash = hash;
      return getOrGenerateEmptyRoomImage(stageRunArgs(hash));
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.stage, "mime_mismatch");
  assert.equal(getCachedEmptyRoomImage(originalHash), null);
});

test("magic-byte detector recognizes only supported signatures", async () => {
  assert.equal(detectEmptyRoomImageMime(PNG), "image/png");
  assert.equal(detectEmptyRoomImageMime(await imageBytes("jpeg")), "image/jpeg");
  assert.equal(detectEmptyRoomImageMime(await imageBytes("webp")), "image/webp");
  assert.equal(detectEmptyRoomImageMime(Buffer.from("unsupported")), null);
});
