import assert from "node:assert/strict";
import test from "node:test";

import {
  runGeminiRoomReadFromImageBytes,
  runGeminiRoomReadFromImageUrl,
} from "./vibodeGeminiRoomRead";

const OFFLINE_KEY = "sec20c-offline-not-a-credential";
const IMAGE_URL = "https://cdn.example/room.jpg";

function jpeg(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[30] = 0xff;
  bytes[31] = 0xd9;
  return bytes;
}

function geminiPayload(label = "sofa"): Response {
  return Response.json({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify({ objects: [{ label, confidence: 0.91 }] }) }],
        },
      },
    ],
  });
}

test("bytes entry point calls only gemini-3-flash-preview and does not fetch an image URL", async () => {
  const previous = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"].map(
    (key) => [key, process.env[key]] as const,
  );
  const calls: Array<{ url: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    return geminiPayload();
  };
  try {
    process.env.GEMINI_API_KEY = OFFLINE_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    const bytes = jpeg();
    const objects = await runGeminiRoomReadFromImageBytes({
      imageBytes: bytes,
      mimeType: "image/jpeg",
      mode: "labels_only",
      ...({ modelVersion: "gemini-2.5-pro" } as object),
    } as Parameters<typeof runGeminiRoomReadFromImageBytes>[0]);
    assert.equal(objects[0]?.label, "sofa");
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call);
    assert.match(call.url, /\/models\/gemini-3-flash-preview:generateContent/);
    assert.equal(call.url.includes("gemini-2.5-pro"), false);
    assert.equal(call.url.includes(OFFLINE_KEY), true);
    assert.equal(call.url.includes(IMAGE_URL), false);
    assert.equal(call.body.includes("https://"), false);
    assert.equal(call.body.includes(Buffer.from(bytes).toString("base64")), true);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("bytes entry point rejects an invalid image before any provider request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("blocked-network");
  };
  try {
    await assert.rejects(() =>
      runGeminiRoomReadFromImageBytes({
        imageBytes: new TextEncoder().encode("not-an-image"),
        mimeType: "text/plain",
      }),
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("url entry point remains available and its provider error does not include the upstream body", async () => {
  const previous = ["GEMINI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"].map(
    (key) => [key, process.env[key]] as const,
  );
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  process.env.GEMINI_API_KEY = OFFLINE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : String(input);
    calls.push(url);
    if (url === IMAGE_URL) {
      return new Response(Buffer.from(jpeg()), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    return new Response("upstream-secret-token signed-url", { status: 500 });
  };
  try {
    await assert.rejects(
      () => runGeminiRoomReadFromImageUrl({ imageUrl: IMAGE_URL, modelVersion: "gemini-2.5-pro" }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.equal(message.includes("upstream-secret-token"), false);
        assert.equal(message.includes("signed-url"), false);
        return true;
      },
    );
    assert.equal(calls[0], IMAGE_URL);
    assert.match(calls[1] ?? "", /\/models\/gemini-2\.5-pro:generateContent/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
