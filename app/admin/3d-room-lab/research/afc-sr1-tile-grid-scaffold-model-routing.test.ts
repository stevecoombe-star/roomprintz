import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { vibodeTileGridScaffoldAssist } from "./afc-sr1-tile-grid-scaffold";
import type { AfcSr1TileGridScaffoldEmptyInput } from "./afc-sr1-tile-grid-scaffold";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64",
);

function empty(): AfcSr1TileGridScaffoldEmptyInput {
  return {
    base64: PIXEL.toString("base64"),
    identity: {
      sha256: createHash("sha256").update(PIXEL).digest("hex"),
      byteCount: PIXEL.byteLength,
      decodedWidth: 1,
      decodedHeight: 1,
      mimeType: "image/png",
      orientation: 1,
    },
  };
}

const args = {
  empty: empty(),
  resultAllowedHosts: ["unused.example.test"],
  maxOutputBytes: 1024 * 1024,
  fetchTimeoutMs: 1000,
  allowLocalhostHttp: false,
};

test("TILED Nano Banana Pro still calls the compositor", async () => {
  const previous = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://offline-compositor.invalid";
  const requests: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    assert.equal(String(input), "https://offline-compositor.invalid/api/vibode/stage-run");
    return new Response(JSON.stringify({
      imageUrl: `data:image/png;base64,${PIXEL.toString("base64")}`,
      appliedAspectRatio: "1:1",
    }), { status: 200 });
  };
  try {
    const result = await vibodeTileGridScaffoldAssist({
      ...args,
      imageModel: "nano-banana-pro",
      dependencies: { createRunId: () => "nbp-tiled" },
    });
    assert.equal(result.status, "generated");
    if (result.status !== "generated") return;
    assert.equal(requests.length, 1);
    assert.equal((requests[0] as { modelVersion: string }).modelVersion, "NBP");
    assert.equal(result.provenance.requestedModelId, "NBP");
    assert.equal("imageChoice" in result.provenance, false);
    assert.equal("imageProvider" in result.provenance, false);
    assert.equal("imageQuality" in result.provenance, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = previous;
  }
});

test("TILED Sunburst does not fall back to the compositor", async () => {
  const previous = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://offline-compositor.invalid";
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("compositor fallback");
  };
  try {
    const failed = await vibodeTileGridScaffoldAssist({
      ...args,
      imageModel: "gpt-image-2.5-sunburst-high",
      dependencies: {
        createRunId: () => "sunburst-fail",
        editImage: async () => ({
          ok: false,
          reason: "GPT Image 2.5 Sunburst High rate limit was reached.",
        }),
      },
    });
    assert.equal(failed.status, "failure");
    if (failed.status !== "failure") return;
    assert.equal(failed.code, "sunburst_generation_failed");
    assert.match(failed.diagnostic?.message ?? "", /rate limit/);
    assert.equal(fetches, 0);

    let editedWidth = 0;
    let editedHeight = 0;
    let editedBytes = Buffer.alloc(0);
    const generated = await vibodeTileGridScaffoldAssist({
      ...args,
      imageModel: "gpt-image-2.5-sunburst-high",
      dependencies: {
        createRunId: () => "sunburst-ok",
        editImage: async (input) => {
          assert.equal(input.stage, "tiled");
          editedWidth = input.width;
          editedHeight = input.height;
          editedBytes = Buffer.from(input.imageBytes);
          return {
            ok: true,
            base64: PIXEL.toString("base64"),
            bytes: PIXEL,
            outputSize: "816x816",
            provenance: {
              stage: "tiled",
              choice: "gpt-image-2.5-sunburst-high",
              displayName: "GPT Image 2.5 Sunburst High",
              provider: "openai",
              modelId: "gpt-image-2.5-sunburst-2026-09-08",
              quality: "high",
            },
          };
        },
      },
    });
    assert.equal(fetches, 0);
    assert.equal(generated.status, "generated");
    if (generated.status !== "generated") return;
    assert.equal(generated.provenance.requestedModelId, "gpt-image-2.5-sunburst-2026-09-08");
    assert.equal(generated.provenance.imageChoice, "gpt-image-2.5-sunburst-high");
    assert.equal(generated.provenance.imageProvider, "openai");
    assert.equal(generated.provenance.imageQuality, "high");
    assert.equal(editedWidth, 1);
    assert.equal(editedHeight, 1);
    assert.ok(editedBytes.equals(PIXEL));
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = previous;
  }
});
