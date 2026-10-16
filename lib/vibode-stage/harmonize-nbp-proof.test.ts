import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { classifyNanoBananaProAspectRatio } from "@/lib/afc-image-models";

import {
  encodeRgbaPng,
  readPngSize,
  sha256HexBytes,
  zipStore,
} from "./harmonize-export";
import {
  HARMONIZE_NBP_ASPECT_RATIO,
  HARMONIZE_NBP_ENDPOINT,
  HARMONIZE_NBP_IMAGE_SIZE,
  HARMONIZE_NBP_MIN_2K_LONG_EDGE,
  HARMONIZE_NBP_MODEL_ID,
  HARMONIZE_NBP_OUTPUT_HEIGHT,
  HARMONIZE_NBP_OUTPUT_MAX_EDGE,
  HARMONIZE_NBP_OUTPUT_WIDTH,
  HARMONIZE_NBP_TIMEOUT_MS,
  HarmonizeNbpProofError,
  assessHarmonizeNbpFraming,
  buildHarmonizeNbpRequest,
  callHarmonizeNbpProof,
  describeHarmonizeNbpHttpError,
  readHarmonizeNbpApiKey,
  readHarmonizeNbpImageSize,
  readHarmonizeProofPackage,
} from "./harmonize-nbp-proof";
import { HARMONIZE_UNIVERSAL_PROMPT_V2 } from "./harmonize-universal-prompt-v2";

const PROMPT = `${HARMONIZE_UNIVERSAL_PROMPT_V2}\n\nPRODUCT MATERIAL / FINISH REFERENCE\n- Oak veneer\n`;

test("request sends the exact prompt, one PNG, and 2K 4:3", () => {
  const png = Buffer.from("png-bytes");
  const request = buildHarmonizeNbpRequest({
    prompt: PROMPT,
    pngBase64: png.toString("base64"),
    aspectRatio: HARMONIZE_NBP_ASPECT_RATIO,
  });
  const parsed = JSON.parse(JSON.stringify(request)) as {
    model: string;
    input: Array<{ type: string; text?: string; mime_type?: string; data?: string }>;
    response_format: { type: string; mime_type: string; aspect_ratio: string; image_size: string };
    tools?: unknown;
    generationConfig?: unknown;
  };
  assert.equal(parsed.model, HARMONIZE_NBP_MODEL_ID);
  assert.equal(parsed.input[0]?.text, PROMPT);
  assert.equal(parsed.input.filter((part) => part.type === "image").length, 1);
  assert.equal(parsed.input[1]?.mime_type, "image/png");
  assert.equal(parsed.input[1]?.data, png.toString("base64"));
  assert.deepEqual(parsed.response_format, {
    type: "image",
    mime_type: "image/jpeg",
    aspect_ratio: HARMONIZE_NBP_ASPECT_RATIO,
    image_size: HARMONIZE_NBP_IMAGE_SIZE,
  });
  assert.equal(Object.hasOwn(parsed.response_format, "delivery"), false);
  assert.equal(parsed.response_format.image_size, "2K");
  assert.equal(parsed.tools, undefined);
  assert.equal(parsed.generationConfig, undefined);
  assert.equal(HARMONIZE_NBP_TIMEOUT_MS, 120_000);
  assert.equal(HARMONIZE_NBP_ENDPOINT.endsWith("/interactions"), true);
});

const STANDARD_RATIOS = [
  ["1:1", 1024, 1024],
  ["3:2", 1264, 848],
  ["2:3", 848, 1264],
  ["4:3", 1200, 896],
  ["3:4", 896, 1200],
  ["5:4", 1152, 928],
  ["4:5", 928, 1152],
  ["16:9", 1376, 768],
  ["9:16", 768, 1376],
  ["21:9", 1584, 672],
] as const;

test("each standard family selects that ratio and keeps the 2K JPEG request", () => {
  const png = Buffer.from("png-bytes").toString("base64");
  for (const [ratio, width, height] of STANDARD_RATIOS) {
    const classified = classifyNanoBananaProAspectRatio(width, height);
    assert.equal(classified.ok, true);
    if (!classified.ok) continue;
    assert.equal(classified.ratio, ratio);
    assert.ok(Math.max(classified.gridWidth, classified.gridHeight) < HARMONIZE_NBP_MIN_2K_LONG_EDGE);
    const request = buildHarmonizeNbpRequest({
      prompt: PROMPT,
      pngBase64: png,
      aspectRatio: classified.ratio,
    });
    assert.equal(request.model, HARMONIZE_NBP_MODEL_ID);
    assert.equal(request.input.length, 2);
    assert.equal(request.input[1]?.data, png);
    assert.deepEqual(request.response_format, {
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: ratio,
      image_size: "2K",
    });
  }
  assert.equal(HARMONIZE_NBP_MIN_2K_LONG_EDGE, HARMONIZE_NBP_OUTPUT_HEIGHT);
  assert.equal(HARMONIZE_NBP_OUTPUT_MAX_EDGE, 4096);
});

test("1264x848 requests 3:2 once and does not rewrite the PNG", async () => {
  const png = pngHeader(1264, 848);
  let calls = 0;
  let posted = "";
  await assert.rejects(
    () => callHarmonizeNbpProof({
      prompt: PROMPT,
      png,
      apiKey: "test-key",
      fetchImpl: (_url, init) => {
        calls += 1;
        posted = String(init?.body ?? "");
        return Promise.resolve(new Response("no", { status: 500 }));
      },
    }),
    (error: unknown) => error instanceof HarmonizeNbpProofError && error.code === "provider_http",
  );
  assert.equal(calls, 1);
  const body = JSON.parse(posted) as {
    input: Array<{ data?: string }>;
    response_format: { aspect_ratio: string; image_size: string; mime_type: string };
  };
  assert.equal(body.response_format.aspect_ratio, "3:2");
  assert.equal(body.response_format.image_size, "2K");
  assert.equal(body.response_format.mime_type, "image/jpeg");
  assert.deepEqual(Buffer.from(body.input[1]?.data ?? "", "base64"), Buffer.from(png));
});

test("1800x1600 is refused before a provider create", async () => {
  const png = pngHeader(1800, 1600);
  let calls = 0;
  await assert.rejects(
    () => callHarmonizeNbpProof({
      prompt: PROMPT,
      png,
      apiKey: "test-key",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response("no", { status: 500 }));
      },
    }),
    (error: unknown) => error instanceof HarmonizeNbpProofError && error.code === "invalid_package",
  );
  assert.equal(calls, 0);
  const classified = classifyNanoBananaProAspectRatio(1800, 1600);
  assert.equal(classified.ok, false);
});

test("2K 4:3 frame passes and the 1K grid does not", () => {
  const accepted = assessHarmonizeNbpFraming({
    width: HARMONIZE_NBP_OUTPUT_WIDTH,
    height: HARMONIZE_NBP_OUTPUT_HEIGHT,
    inputWidth: 1200,
    inputHeight: 896,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.aspectErrorVsInput, 0);
  assert.ok(accepted.aspectErrorVsFourThree < 0.015);

  const oneK = assessHarmonizeNbpFraming({
    width: 1200,
    height: 896,
    inputWidth: 1200,
    inputHeight: 896,
  });
  assert.equal(oneK.matches2kFourThree, false);
  assert.equal(oneK.accepted, false);

  const cropped = assessHarmonizeNbpFraming({
    width: 2400,
    height: 1600,
    inputWidth: 1200,
    inputHeight: 896,
  });
  assert.equal(cropped.withinToleranceOfInput, false);
  assert.equal(cropped.accepted, false);

  const originalFourThree = assessHarmonizeNbpFraming({
    width: 2400,
    height: 1792,
    inputWidth: 2048,
    inputHeight: 1536,
  });
  assert.equal(originalFourThree.requestedRatio, "4:3");
  assert.equal(originalFourThree.accepted, true);
});

test("3:2 accepts a 2K-class frame and rejects a 4:3 or 1K result", () => {
  const accepted = assessHarmonizeNbpFraming({
    width: 2528,
    height: 1696,
    inputWidth: 1264,
    inputHeight: 848,
  });
  assert.equal(accepted.requestedRatio, "3:2");
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.matches2kFourThree, false);

  const fourThree = assessHarmonizeNbpFraming({
    width: 2400,
    height: 1792,
    inputWidth: 1264,
    inputHeight: 848,
  });
  assert.equal(fourThree.accepted, false);
  assert.equal(fourThree.withinToleranceOfInput, false);

  const oneK = assessHarmonizeNbpFraming({
    width: 1264,
    height: 848,
    inputWidth: 1264,
    inputHeight: 848,
  });
  assert.equal(oneK.meets2kClass, false);
  assert.equal(oneK.accepted, false);

  const offGrid = assessHarmonizeNbpFraming({
    width: 2528,
    height: 1696,
    inputWidth: 1800,
    inputHeight: 1600,
  });
  assert.equal(offGrid.requestedRatio, null);
  assert.equal(offGrid.accepted, false);
});

test("twice a documented 1K grid passes, and only 4:3 requires those exact pixels", () => {
  for (const [ratio, width, height] of STANDARD_RATIOS) {
    const doubled = assessHarmonizeNbpFraming({
      width: width * 2,
      height: height * 2,
      inputWidth: width,
      inputHeight: height,
    });
    assert.equal(doubled.requestedRatio, ratio);
    assert.equal(doubled.accepted, true);
    const oneK = assessHarmonizeNbpFraming({
      width,
      height,
      inputWidth: width,
      inputHeight: height,
    });
    assert.equal(oneK.accepted, false);
    if (ratio === "4:3") {
      assert.equal(width * 2, HARMONIZE_NBP_OUTPUT_WIDTH);
      assert.equal(height * 2, HARMONIZE_NBP_OUTPUT_HEIGHT);
    } else {
      assert.equal(doubled.matches2kFourThree, false);
    }
  }
  const nearThreeTwo = assessHarmonizeNbpFraming({
    width: 2000,
    height: 1342,
    inputWidth: 1264,
    inputHeight: 848,
  });
  assert.equal(nearThreeTwo.requestedRatio, "3:2");
  assert.equal(nearThreeTwo.accepted, true);
  assert.equal(nearThreeTwo.matches2kFourThree, false);
});

test("portrait and ultrawide 2K-class frames pass and an oversized frame does not", () => {
  const portrait = assessHarmonizeNbpFraming({
    width: 1536,
    height: 2752,
    inputWidth: 768,
    inputHeight: 1376,
  });
  assert.equal(portrait.requestedRatio, "9:16");
  assert.equal(portrait.accepted, true);

  const ultrawide = assessHarmonizeNbpFraming({
    width: 3168,
    height: 1344,
    inputWidth: 1584,
    inputHeight: 672,
  });
  assert.equal(ultrawide.requestedRatio, "21:9");
  assert.equal(ultrawide.accepted, true);

  const tooWide = assessHarmonizeNbpFraming({
    width: 4200,
    height: 1800,
    inputWidth: 1584,
    inputHeight: 672,
  });
  assert.equal(tooWide.meets2kClass, false);
  assert.equal(tooWide.accepted, false);
});

test("missing credentials fail before any request", async () => {
  assert.equal(readHarmonizeNbpApiKey({}), null);
  assert.equal(readHarmonizeNbpApiKey({ GEMINI_API_KEY: "  ", GOOGLE_API_KEY: "server-key" }), "server-key");
  let calls = 0;
  await assert.rejects(
    () => callHarmonizeNbpProof({
      prompt: PROMPT,
      png: new Uint8Array([1, 2, 3]),
      apiKey: " ",
      fetchImpl: () => {
        calls += 1;
        return Promise.reject(new Error("should not be called"));
      },
    }),
    (error: unknown) => error instanceof HarmonizeNbpProofError && error.code === "missing_credentials",
  );
  assert.equal(calls, 0);
});

test("provider failure and timeout do not retry the create", async () => {
  const png = await tinyPng();
  let calls = 0;
  await assert.rejects(
    () => callHarmonizeNbpProof({
      prompt: PROMPT,
      png,
      apiKey: "test-key",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response(PROMPT, { status: 500 }));
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarmonizeNbpProofError);
      assert.equal(error.code, "provider_http");
      assert.equal(error.httpStatus, 500);
      assert.equal(error.message.includes(PROMPT), false);
      assert.equal(error.message.includes("test-key"), false);
      assert.equal(error.providerFields.length, 0);
      return true;
    },
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    () => callHarmonizeNbpProof({
      prompt: PROMPT,
      png,
      apiKey: "test-key",
      timeoutMs: 30,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        calls += 1;
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    }),
    (error: unknown) => error instanceof HarmonizeNbpProofError && error.code === "timeout",
  );
  assert.equal(calls, 1);
});

test("a waiting interaction is read once and not created again", async () => {
  const png = await tinyPng();
  const encoded = Buffer.from(png).toString("base64");
  const calls: string[] = [];
  const result = await callHarmonizeNbpProof({
    prompt: PROMPT,
    png,
    apiKey: "test-key",
    pollIntervalMs: 0,
    timeoutMs: 5_000,
    fetchImpl: (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { input: Array<{ text?: string }> };
        assert.equal(body.input[0]?.text, PROMPT);
        assert.equal(JSON.stringify(body).includes("NANOBANANA_PRO_URL"), false);
        return Promise.resolve(jsonResponse({ id: "interaction-1", status: "in_progress", model: HARMONIZE_NBP_MODEL_ID }));
      }
      return Promise.resolve(jsonResponse({
        id: "interaction-1",
        status: "completed",
        model: "gemini-3-pro-image",
        output_image: { type: "image", mime_type: "image/png", data: encoded },
        usage: { total_input_tokens: 10, total_output_tokens: 1120, total_thought_tokens: 4 },
      }));
    },
  });
  assert.deepEqual(calls, [
    `POST ${HARMONIZE_NBP_ENDPOINT}`,
    `GET ${HARMONIZE_NBP_ENDPOINT}/interaction-1`,
  ]);
  assert.equal(result.postCount, 1);
  assert.equal(result.getCount, 1);
  assert.equal(result.returnedModel, HARMONIZE_NBP_MODEL_ID);
  assert.equal(result.usage?.total_output_tokens, 1120);
  assert.deepEqual(result.output, png);
});

test("HTTP 400 reports the provider status and field without the prompt or key", async () => {
  const secret = `AIza${"S".repeat(24)}`;
  const body = JSON.stringify({
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: `Invalid value image/png for response_format.mime_type. ${secret} ${PROMPT}`,
      details: [{
        fieldViolations: [{
          field: "response_format.mime_type",
          description: PROMPT,
        }],
      }],
    },
  });
  const described = describeHarmonizeNbpHttpError(400, body);
  assert.equal(described.providerStatus, "INVALID_ARGUMENT");
  assert.deepEqual(described.providerFields, ["response_format.mime_type"]);
  assert.match(described.message, /HTTP 400 INVALID_ARGUMENT at response_format\.mime_type: Invalid value image\/png/);
  assert.equal(described.message.includes(secret), false);
  assert.equal(described.message.includes("Oak veneer"), false);
  assert.equal(described.message.includes(PROMPT), false);

  const png = await tinyPng();
  let calls = 0;
  await assert.rejects(
    () => callHarmonizeNbpProof({
      prompt: PROMPT,
      png,
      apiKey: "test-key",
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(new Response(body, { status: 400 }));
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarmonizeNbpProofError);
      assert.equal(error.code, "provider_http");
      assert.equal(error.httpStatus, 400);
      assert.equal(error.providerStatus, "INVALID_ARGUMENT");
      assert.deepEqual(error.providerFields, ["response_format.mime_type"]);
      assert.equal(error.message.includes(PROMPT), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("documented image data and image URI responses keep the full bytes", async () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x07, 0x00, 0x09, 0x60, 0x01, 0x00, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  const encoded = Buffer.from(jpeg).toString("base64");
  const documented = {
    id: "interaction-image",
    status: "completed",
    model: HARMONIZE_NBP_MODEL_ID,
    steps: [{
      type: "model_output",
      content: [{ type: "image", mime_type: "image/jpeg", data: encoded }],
    }],
  };
  let posts = 0;
  const inline = await callHarmonizeNbpProof({
    prompt: PROMPT,
    png: await tinyPng(),
    apiKey: "test-key",
    fetchImpl: (_url, init) => {
      assert.equal(init?.method, "POST");
      posts += 1;
      const body = JSON.parse(String(init?.body)) as { response_format: { delivery?: string } };
      assert.equal(body.response_format.delivery, undefined);
      return Promise.resolve(jsonResponse(documented));
    },
  });
  assert.equal(posts, 1);
  assert.equal(inline.output.byteLength, jpeg.byteLength);
  assert.deepEqual(inline.output, jpeg);
  assert.equal(inline.outputMime, "image/jpeg");

  const calls: string[] = [];
  const located = await callHarmonizeNbpProof({
    prompt: PROMPT,
    png: await tinyPng(),
    apiKey: "test-key",
    fetchImpl: (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse({
          status: "completed",
          steps: [{
            type: "model_output",
            content: [{ type: "image", mime_type: "image/jpeg", uri: "https://example.test/harmonize.jpg" }],
          }],
        }));
      }
      assert.equal(init?.method, "GET");
      assert.equal(url, "https://example.test/harmonize.jpg");
      assert.equal(new Headers(init?.headers).has("x-goog-api-key"), false);
      return Promise.resolve(new Response(jpeg, { status: 200 }));
    },
  });
  assert.deepEqual(calls, [
    `POST ${HARMONIZE_NBP_ENDPOINT}`,
    "GET https://example.test/harmonize.jpg",
  ]);
  assert.equal(located.postCount, 1);
  assert.deepEqual(located.output, jpeg);
});

test("a JPEG result is accepted and measured", () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x00, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  const size = readHarmonizeNbpImageSize(jpeg);
  assert.deepEqual(size, { width: 32, height: 16, mime: "image/jpeg" });
});

test("malformed, empty, and multi-image responses are rejected", async () => {
  const png = await tinyPng();
  const encoded = Buffer.from(png).toString("base64");
  const other = Buffer.from(await encodeRgbaPng(new Uint8Array([9, 9, 9, 255]), 1, 1)).toString("base64");
  const cases: unknown[] = [
    { status: "completed" },
    { status: "completed", output_image: { type: "image", mime_type: "image/png", data: "!!!!" } },
    {
      status: "completed",
      output_image: { type: "image", mime_type: "image/jpeg", data: encoded },
    },
    {
      status: "completed",
      output_image: { type: "image", mime_type: "image/png", data: encoded },
      steps: [{
        type: "model_output",
        content: [{ type: "image", mime_type: "image/png", data: other }],
      }],
    },
    { status: "failed", id: "interaction-2" },
  ];
  for (const body of cases) {
    await assert.rejects(
      () => callHarmonizeNbpProof({
        prompt: PROMPT,
        png,
        apiKey: "test-key",
        fetchImpl: () => Promise.resolve(jsonResponse(body)),
      }),
      (error: unknown) => error instanceof HarmonizeNbpProofError
        && (error.code === "unexpected_output" || error.code === "provider_incomplete"),
    );
  }
});

test("package verification keeps the prompt bytes and rejects a hash mismatch", async () => {
  const png = await tinyPng();
  const size = readPngSize(png);
  assert.ok(size);
  const promptBytes = new TextEncoder().encode(PROMPT);
  const zip = zipStore([
    { name: "B-stage-composite.png", data: png },
    { name: "F-harmonize-prompt.txt", data: promptBytes },
    {
      name: "manifest.json",
      data: new TextEncoder().encode(JSON.stringify({
        harmonizePrompt: {
          coreVersion: "harmonize-universal-prompt/2.0",
          sha256: await sha256HexBytes(promptBytes),
          materialGuidanceIncluded: true,
        },
        images: {
          "B-stage-composite.png": {
            role: "stage-composite",
            sha256: await sha256HexBytes(png),
            width: size.width,
            height: size.height,
          },
        },
      })),
    },
  ]);
  const proof = await readHarmonizeProofPackage(zip);
  assert.equal(proof.prompt, PROMPT);
  assert.equal(proof.promptCorePresent, true);
  assert.equal(proof.inputWidth, size.width);

  const brokenPrompt = new Uint8Array(promptBytes);
  brokenPrompt[brokenPrompt.length - 2] = 65;
  const broken = zipStore([
    { name: "B-stage-composite.png", data: png },
    { name: "F-harmonize-prompt.txt", data: brokenPrompt },
    {
      name: "manifest.json",
      data: new TextEncoder().encode(JSON.stringify({
        harmonizePrompt: {
          coreVersion: "harmonize-universal-prompt/2.0",
          sha256: await sha256HexBytes(promptBytes),
          materialGuidanceIncluded: true,
        },
        images: {
          "B-stage-composite.png": {
            role: "stage-composite",
            sha256: await sha256HexBytes(png),
            width: size.width,
            height: size.height,
          },
        },
      })),
    },
  ]);
  await assert.rejects(
    () => readHarmonizeProofPackage(broken),
    (error: unknown) => error instanceof HarmonizeNbpProofError && error.code === "invalid_package",
  );
});

test("proof modules do not use the compositor or legacy Nano Banana proxy", () => {
  const source = [
    readFileSync(new URL("./harmonize-nbp-proof.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../scripts/harmonize-nbp-proof.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(source.includes("NANOBANANA_PRO_URL"), false);
  assert.equal(source.includes("callCompositor"), false);
  assert.equal(source.includes("enhancePhoto"), false);
  assert.equal(source.includes("gemini-3-pro-image-preview"), false);
  assert.equal(source.includes(".resize("), false);
  assert.equal(source.includes(".extract("), false);
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function tinyPng(): Promise<Uint8Array> {
  return encodeRgbaPng(new Uint8Array([10, 20, 30, 255]), 1, 1);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
