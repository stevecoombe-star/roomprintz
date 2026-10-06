import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { resolveAfcSr1LiveEmptyDefault } from "./afc-sr1-live-product";
import type { AfcSr1QualifiedOriginal } from "./afc-sr1-live-product";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64",
);

function original(bytes: Buffer, url: string): AfcSr1QualifiedOriginal {
  return {
    sourceImageUrl: url,
    basis: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.byteLength,
      decodedWidth: 1,
      decodedHeight: 1,
      mimeType: "image/png",
      orientation: 1,
    },
  };
}

test("EMPTY Nano Banana Pro does not call OpenAI", async () => {
  const previous = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
  let edits = 0;
  try {
    const result = await resolveAfcSr1LiveEmptyDefault(
      original(PNG, "https://images.example.test/nbp-empty.png"),
      {
        imageModel: "nano-banana-pro",
        editImage: async () => {
          edits += 1;
          return { ok: false, reason: "OpenAI must not run" };
        },
      },
    );
    assert.equal(result, null);
    assert.equal(edits, 0);
  } finally {
    if (previous === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = previous;
  }
});

test("EMPTY Sunburst uses the injected edit and does not fall back", async () => {
  const source = Buffer.from("sunburst-empty-failure-source");
  await assert.rejects(
    () => resolveAfcSr1LiveEmptyDefault(
      original(source, "https://images.example.test/sunburst-fail.png"),
      {
        imageModel: "gpt-image-2.5-sunburst-high",
        loadSourceBytes: async () => ({ bytes: source, mimeType: "image/png" }),
        editImage: async () => ({
          ok: false,
          reason: "GPT Image 2.5 Sunburst High authentication failed.",
        }),
      },
    ),
    /GPT Image 2\.5 Sunburst High authentication failed/,
  );

  const generated = await resolveAfcSr1LiveEmptyDefault(
    original(PNG, "https://images.example.test/sunburst-empty.png"),
    {
      imageModel: "gpt-image-2.5-sunburst-high",
      loadSourceBytes: async () => ({ bytes: PNG, mimeType: "image/png" }),
      editImage: async (input) => {
        assert.equal(input.stage, "empty");
        assert.equal(input.width, 1);
        assert.equal(input.height, 1);
        return {
          ok: true,
          base64: PNG.toString("base64"),
          bytes: PNG,
          outputSize: "816x816",
          provenance: {
            stage: "empty",
            choice: "gpt-image-2.5-sunburst-high",
            displayName: "GPT Image 2.5 Sunburst High",
            provider: "openai",
            modelId: "gpt-image-2.5-sunburst-2026-09-08",
            quality: "high",
          },
        };
      },
    },
  );
  assert.ok(generated);
  assert.equal(generated?.generated, true);
  assert.equal(generated?.basis.mimeType, "image/png");
  assert.equal(generated?.basis.sha256, createHash("sha256").update(PNG).digest("hex"));
});
