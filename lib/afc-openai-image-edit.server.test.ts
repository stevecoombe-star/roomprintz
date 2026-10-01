import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  afcEmptyRoomImagePrompt,
  afcTiledScaffoldImagePrompt,
} from "./afc-image-generation-prompts";
import {
  AFC_OPENAI_IMAGE_EDIT_URL,
  editAfcImageWithOpenAi,
} from "./afc-openai-image-edit.server";

const silentLog = () => {};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64",
);
const SECRET = "sk-test-sunburst-do-not-log";

test("missing OPENAI_API_KEY fails before any request", async () => {
  let calls = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
  }, {
    apiKey: null,
    log: silentLog,
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /missing OPENAI_API_KEY/);
  assert.equal(calls, 0);
  assert.equal(result.reason.includes(SECRET), false);
});

test("Sunburst edit uses the pinned model, quality high, and decodes PNG base64", async () => {
  let authorization = "";
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
  }, {
    apiKey: SECRET,
    log: silentLog,
    fetchImpl: async (input, init) => {
      assert.equal(String(input), AFC_OPENAI_IMAGE_EDIT_URL);
      assert.equal(init?.method, "POST");
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      const form = init?.body as FormData;
      assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
      assert.equal(form.get("quality"), "high");
      assert.equal(form.get("size"), "1264x848");
      assert.equal(form.get("output_format"), "png");
      assert.equal(form.get("background"), "opaque");
      assert.match(String(form.get("prompt")), /movable furniture/);
      assert.equal(init?.headers instanceof Headers
        ? false
        : "Content-Type" in (init?.headers ?? {}), false);
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(authorization, `Bearer ${SECRET}`);
  assert.ok(result.bytes.subarray(0, 8).equals(PNG.subarray(0, 8)));
  assert.equal(result.provenance.provider, "openai");
  assert.equal(result.provenance.modelId, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(result.provenance.quality, "high");
  assert.equal(result.provenance.stage, "empty");
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("a 2048x1536 Sunburst EMPTY requests the live Nano Banana Pro 4:3 grid", async () => {
  let calls = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 2048,
    height: 1536,
  }, {
    apiKey: SECRET,
    log: silentLog,
    fetchImpl: async (_input, init) => {
      calls += 1;
      const form = init?.body as FormData;
      assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
      assert.equal(form.get("quality"), "high");
      assert.equal(form.get("size"), "1200x896");
      assert.equal(form.get("output_format"), "png");
      assert.equal(form.get("background"), "opaque");
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provenance.provider, "openai");
  assert.equal(result.provenance.modelId, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(result.provenance.quality, "high");
  assert.equal(result.provenance.stage, "empty");
  assert.equal(JSON.stringify(result).includes("Nano Banana"), false);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("Sunburst TILED on the canonical grid requests that same size", async () => {
  let size = "";
  const result = await editAfcImageWithOpenAi({
    stage: "tiled",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1200,
    height: 896,
  }, {
    apiKey: SECRET,
    log: silentLog,
    fetchImpl: async (_input, init) => {
      const form = init?.body as FormData;
      size = String(form.get("size"));
      assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
      assert.equal(form.get("quality"), "high");
      assert.match(String(form.get("prompt")), /orthogonal grid/);
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(size, "1200x896");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provenance.stage, "tiled");
  assert.equal(result.provenance.quality, "high");
  assert.equal(JSON.stringify(result).includes("Nano Banana"), false);
});

test("TILED Sunburst prompt is the scaffold instruction and does not fall back", async () => {
  let calls = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "tiled",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
  }, {
    apiKey: SECRET,
    log: silentLog,
    fetchImpl: async (_input, init) => {
      calls += 1;
      const form = init?.body as FormData;
      assert.match(String(form.get("prompt")), /orthogonal grid/);
      assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
      assert.equal(form.get("quality"), "high");
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /empty image result/);
  assert.equal(result.reason.includes("Nano Banana"), false);
});

test("malformed, empty, and non-PNG OpenAI results fail closed", async () => {
  const cases = [
    new Response("not-json", { status: 200 }),
    new Response(JSON.stringify({ data: [{}] }), { status: 200 }),
    new Response(JSON.stringify({ data: [{ b64_json: "" }] }), { status: 200 }),
    new Response(JSON.stringify({ data: [{ b64_json: "YQ==" }] }), { status: 200 }),
    new Response(JSON.stringify({ error: { message: SECRET } }), { status: 500 }),
    new Response("{}", { status: 401 }),
  ];
  for (const response of cases) {
    const result = await editAfcImageWithOpenAi({
      stage: "empty",
      imageBytes: PNG,
      mimeType: "image/png",
      width: 1264,
      height: 848,
    }, {
      apiKey: SECRET,
      log: silentLog,
      fetchImpl: async () => response,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason.includes(SECRET), false);
    assert.match(result.reason, /GPT Image 2\.5 Sunburst High/);
  }
});

test("OpenAI adapter is server-only and does not read a public key", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/afc-openai-image-edit.server.ts"),
    "utf8",
  );
  assert.match(source, /import "server-only"/);
  assert.match(source, /process\.env\.OPENAI_API_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_OPENAI/);
  assert.match(source, /console\.info/);
  assert.doesNotMatch(source, /console\.(log|debug|warn|error)\(/);
});

function promptSection(log: string): string {
  const start = log.indexOf("----------------------------------------\n");
  const end = log.lastIndexOf("\n----------------------------------------");
  assert.ok(start >= 0 && end > start);
  return log.slice(start + "----------------------------------------\n".length, end);
}

test("Sunburst EMPTY logs stage, model, quality, exact prompt, and result size", async () => {
  const lines: string[] = [];
  let sentPrompt = "";
  const stamps = [1_000, 13_340];
  let tick = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/jpeg",
    width: 2048,
    height: 1536,
  }, {
    apiKey: SECRET,
    logFullPrompt: true,
    now: () => stamps[Math.min(tick++, stamps.length - 1)] ?? 13_340,
    log: (message) => {
      lines.push(message);
    },
    fetchImpl: async (_input, init) => {
      const form = init?.body as FormData;
      sentPrompt = String(form.get("prompt"));
      assert.equal(form.get("model"), "gpt-image-2.5-sunburst-2026-09-08");
      assert.equal(form.get("quality"), "high");
      assert.equal(form.get("size"), "1200x896");
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  const log = lines.join("\n");
  const emptyPrompt = afcEmptyRoomImagePrompt();
  assert.equal(sentPrompt, emptyPrompt);
  assert.equal(promptSection(log), emptyPrompt);
  assert.match(log, /\[AFC SUNBURST EMPTY\]/);
  assert.match(log, /Stage: EMPTY/);
  assert.match(log, /Provider: openai/);
  assert.match(log, /Model: gpt-image-2\.5-sunburst-2026-09-08/);
  assert.match(log, /Quality: high/);
  assert.match(log, /Source:\n {2}dimensions: 2048x1536\n {2}bytes: \d+\n {2}mime: image\/jpeg/);
  assert.match(log, /Output request:\n {2}dimensions: 1200x896\n {2}format: png\n {2}background: opaque/);
  assert.match(log, /Request completed in 12\.34s/);
  assert.match(log, /Result:\n {2}dimensions: 1x1\n {2}bytes: \d+\n {2}format: png/);
  assert.match(log, new RegExp(`bytes: ${PNG.byteLength}`));
  assert.equal(log.includes(SECRET), false);
  assert.equal(log.includes("Bearer"), false);
  assert.equal(log.includes("Authorization"), false);
  assert.equal(log.includes(PNG.toString("base64")), false);
  assert.equal(log.includes("OPENAI_API_KEY"), false);
});

test("Sunburst TILED logs the exact scaffold prompt and stage identity", async () => {
  const lines: string[] = [];
  let sentPrompt = "";
  const result = await editAfcImageWithOpenAi({
    stage: "tiled",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1200,
    height: 896,
  }, {
    apiKey: SECRET,
    logFullPrompt: true,
    log: (message) => {
      lines.push(message);
    },
    fetchImpl: async (_input, init) => {
      sentPrompt = String((init?.body as FormData).get("prompt"));
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  const log = lines.join("\n");
  const tiledPrompt = afcTiledScaffoldImagePrompt();
  assert.equal(sentPrompt, tiledPrompt);
  assert.equal(promptSection(log), tiledPrompt);
  assert.match(log, /\[AFC SUNBURST TILED\]/);
  assert.match(log, /Stage: TILED/);
  assert.match(log, /Provider: openai/);
  assert.match(log, /Model: gpt-image-2\.5-sunburst-2026-09-08/);
  assert.match(log, /Quality: high/);
  assert.match(log, /dimensions: 1200x896/);
  assert.equal(log.includes("Stage: EMPTY"), false);
  assert.equal(log.includes(SECRET), false);
  assert.equal(log.includes(PNG.toString("base64")), false);
});

test("Sunburst failure logs sanitized provider errors and keeps the fail-closed reason", async () => {
  const lines: string[] = [];
  const stamps = [0, 1_500];
  let tick = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "tiled",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
  }, {
    apiKey: SECRET,
    now: () => stamps[Math.min(tick++, stamps.length - 1)] ?? 1_500,
    log: (message) => {
      lines.push(message);
    },
    fetchImpl: async () => new Response(JSON.stringify({
      error: {
        message: `rejected Bearer ${SECRET}`,
        type: "invalid_request_error",
        code: "invalid_request",
        param: PNG.toString("base64"),
      },
    }), {
      status: 400,
      headers: { Authorization: `Bearer ${SECRET}` },
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "GPT Image 2.5 Sunburst High rejected the image edit request.");
  const log = lines.join("\n");
  assert.match(log, /\[AFC SUNBURST TILED\] Request failed in 1\.50s/);
  assert.match(log, /Phase: http/);
  assert.match(log, /HTTP status: 400/);
  assert.match(log, /Requested dimensions: 1264x848/);
  assert.match(log, /Error type: invalid_request_error/);
  assert.match(log, /Error code: invalid_request/);
  assert.match(log, /Error message: rejected \[redacted\]/);
  assert.equal(log.includes(SECRET), false);
  assert.equal(log.includes("Bearer"), false);
  assert.equal(log.includes("Authorization"), false);
  assert.equal(log.includes(PNG.toString("base64")), false);
  assert.equal(log.includes("OPENAI_API_KEY"), false);
});

test("missing Sunburst configuration logs before request and does not print the prompt", async () => {
  const lines: string[] = [];
  let calls = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
  }, {
    apiKey: null,
    log: (message) => {
      lines.push(message);
    },
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /missing OPENAI_API_KEY/);
  assert.equal(calls, 0);
  const log = lines.join("\n");
  assert.match(log, /\[AFC SUNBURST EMPTY\] Request failed/);
  assert.match(log, /Phase: before request/);
  assert.match(log, /missing API key/);
  assert.equal(log.includes(afcEmptyRoomImagePrompt()), false);
  assert.equal(log.includes("OPENAI_API_KEY"), false);
  assert.equal(log.includes(SECRET), false);
});

test("malformed image data is logged as PNG validation without payload bytes", async () => {
  const lines: string[] = [];
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
  }, {
    apiKey: SECRET,
    log: (message) => {
      lines.push(message);
    },
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{ b64_json: "YQ==" }],
    }), { status: 200 }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /malformed image data/);
  const log = lines.join("\n");
  assert.match(log, /Phase: png validation/);
  assert.equal(log.includes("YQ=="), false);
  assert.equal(log.includes(SECRET), false);
});

test("a throwing diagnostic logger does not change the OpenAI request", async () => {
  let model = "";
  let prompt = "";
  let quality = "";
  let size = "";
  let calls = 0;
  const result = await editAfcImageWithOpenAi({
    stage: "empty",
    imageBytes: PNG,
    mimeType: "image/png",
    width: 1264,
    height: 848,
    prompt: "EXACT CUSTOM EMPTY PROMPT",
  }, {
    apiKey: SECRET,
    log: () => {
      throw new Error(`logger failed ${SECRET}`);
    },
    fetchImpl: async (_input, init) => {
      calls += 1;
      const form = init?.body as FormData;
      model = String(form.get("model"));
      prompt = String(form.get("prompt"));
      quality = String(form.get("quality"));
      size = String(form.get("size"));
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(model, "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(prompt, "EXACT CUSTOM EMPTY PROMPT");
  assert.equal(quality, "high");
  assert.equal(size, "1264x848");
});

test("the default server logger prints Sunburst diagnostics and redacts the API key", async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = ((message?: unknown) => {
    lines.push(String(message));
  }) as typeof console.info;
  try {
    const result = await editAfcImageWithOpenAi({
      stage: "tiled",
      imageBytes: PNG,
      mimeType: "image/png",
      width: 1200,
      height: 896,
    }, {
      apiKey: SECRET,
      fetchImpl: async () => new Response(JSON.stringify({
        error: { message: SECRET, type: "server_error", code: "server_error" },
      }), { status: 500 }),
    });
    assert.equal(result.ok, false);
  } finally {
    console.info = original;
  }
  const log = lines.join("\n");
  assert.match(log, /\[AFC SUNBURST TILED\]/);
  assert.match(log, /Quality: high/);
  assert.match(log, /Model: gpt-image-2\.5-sunburst-2026-09-08/);
  assert.match(log, /Error message: \[redacted\]/);
  assert.equal(log.includes(SECRET), false);
  assert.equal(log.includes("Bearer"), false);
  assert.equal(log.includes(PNG.toString("base64")), false);
});

const PROMPT_ENV = "VIBODE_LOG_AFC_IMAGE_PROMPTS";

function promptDigest(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 12);
}

function promptFirstLine(prompt: string): string {
  const first = prompt.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}

function assertPromptSummary(log: string, prompt: string, stage: "EMPTY" | "TILED"): void {
  assert.match(log, new RegExp(`\\[AFC SUNBURST ${stage}\\]`));
  assert.match(log, /Provider: openai/);
  assert.match(log, /Model: gpt-image-2\.5-sunburst-2026-09-08/);
  assert.match(log, /Quality: high/);
  assert.match(log, new RegExp(`length: ${prompt.length}`));
  assert.match(log, new RegExp(`hash: ${promptDigest(prompt)}`));
  assert.match(log, new RegExp(`first_line: ${promptFirstLine(prompt).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.equal(log.includes("----------------------------------------"), false);
  assert.equal(log.includes("Step 4 — Empty the room:"), false);
  assert.equal(log.includes("orthogonal grid"), false);
}

async function captureStagePromptLog(
  stage: "empty" | "tiled",
  logFullPrompt?: boolean,
): Promise<{ log: string; sentPrompt: string }> {
  const lines: string[] = [];
  let sentPrompt = "";
  const width = stage === "empty" ? 2048 : 1200;
  const height = stage === "empty" ? 1536 : 896;
  const result = await editAfcImageWithOpenAi({
    stage,
    imageBytes: PNG,
    mimeType: "image/png",
    width,
    height,
  }, {
    apiKey: SECRET,
    ...(logFullPrompt === undefined ? {} : { logFullPrompt }),
    log: (message) => {
      lines.push(message);
    },
    fetchImpl: async (_input, init) => {
      sentPrompt = String((init?.body as FormData).get("prompt"));
      return new Response(JSON.stringify({
        data: [{ b64_json: PNG.toString("base64") }],
      }), { status: 200 });
    },
  });
  assert.equal(result.ok, true);
  return { log: lines.join("\n"), sentPrompt };
}

test("disabled prompt logging summarizes EMPTY and TILED without changing the request", async () => {
  for (const stage of ["empty", "tiled"] as const) {
    const expected = stage === "empty" ? afcEmptyRoomImagePrompt() : afcTiledScaffoldImagePrompt();
    const captured = await captureStagePromptLog(stage, false);
    assert.equal(captured.sentPrompt, expected);
    assertPromptSummary(captured.log, expected, stage === "empty" ? "EMPTY" : "TILED");
    assert.match(captured.log, /Request completed in /);
    assert.match(captured.log, /Result:\n {2}dimensions: 1x1/);
    if (stage === "empty") {
      assert.match(captured.log, /dimensions: 1200x896/);
    }
  }
});

test("VIBODE_LOG_AFC_IMAGE_PROMPTS gates the full EMPTY and TILED prompt", async () => {
  const previous = process.env[PROMPT_ENV];
  try {
    for (const value of [undefined, "0", "true", ""] as const) {
      if (value === undefined) delete process.env[PROMPT_ENV];
      else process.env[PROMPT_ENV] = value;
      for (const stage of ["empty", "tiled"] as const) {
        const expected = stage === "empty" ? afcEmptyRoomImagePrompt() : afcTiledScaffoldImagePrompt();
        const captured = await captureStagePromptLog(stage);
        assert.equal(captured.sentPrompt, expected);
        assertPromptSummary(captured.log, expected, stage === "empty" ? "EMPTY" : "TILED");
      }
    }
    process.env[PROMPT_ENV] = "1";
    for (const stage of ["empty", "tiled"] as const) {
      const expected = stage === "empty" ? afcEmptyRoomImagePrompt() : afcTiledScaffoldImagePrompt();
      const captured = await captureStagePromptLog(stage);
      assert.equal(captured.sentPrompt, expected);
      assert.equal(promptSection(captured.log), expected);
      assert.match(captured.log, stage === "empty" ? /Stage: EMPTY/ : /Stage: TILED/);
      assert.match(captured.log, /Quality: high/);
      assert.match(captured.log, /Model: gpt-image-2\.5-sunburst-2026-09-08/);
    }
  } finally {
    if (previous === undefined) delete process.env[PROMPT_ENV];
    else process.env[PROMPT_ENV] = previous;
  }
});
