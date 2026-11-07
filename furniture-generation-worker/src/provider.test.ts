/**
 * Real-provider readiness. Fetch is injected. These tests do not call Meshy.
 */

import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";
import { emptyFurniturePhotoSet } from "@/lib/vibode-furniture/generator/images";
import { mapMeshyGenerationDraft } from "@/lib/vibode-furniture/generator/request";
import { defaultFurnitureGeneratorSettings } from "@/lib/vibode-furniture/generator/settings";
import { buildMeshyCreateRequest } from "@/lib/vibode-furniture/generation/payload";

import {
  createBoundedMeshyAssetDownloader,
  createFurnitureGenerationWorkerRuntime,
  resolveFurnitureGenerationProvider,
} from "./provider";

const TASK_ID = "018a210d-8ba4-705c-b111-1f1776f7f578";
const KEY = "msy_test_secret_value";

test("a credential does not select real mode", () => {
  const unset = resolveFurnitureGenerationProvider({ MESHY_API_KEY: KEY });
  assert.equal(unset.ok, true);
  if (unset.ok) assert.equal(unset.mode, "fake");
  const wrong = resolveFurnitureGenerationProvider({
    MESHY_API_KEY: KEY,
    VIBODE_FURNITURE_GENERATION_PROVIDER: "live",
    VIBODE_MESHY_GENERATION_ENABLED: "true",
  });
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.equal(wrong.missing, "provider_invalid");
  const upper = resolveFurnitureGenerationProvider({
    MESHY_API_KEY: KEY,
    VIBODE_FURNITURE_GENERATION_PROVIDER: "Meshy",
    VIBODE_MESHY_GENERATION_ENABLED: "true",
  });
  assert.equal(upper.ok, false);
  if (!upper.ok) assert.equal(upper.missing, "provider_invalid");
});

test("fake mode ignores a credential and does not call fetch", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live_fetch_refused");
  };
  let calls = 0;
  try {
    const runtime = createFurnitureGenerationWorkerRuntime({
      env: { MESHY_API_KEY: KEY, VIBODE_FURNITURE_GENERATION_PROVIDER: "fake" },
      fetchImpl: async () => {
        calls += 1;
        throw new Error("fetch_called");
      },
      log: () => undefined,
    });
    assert.equal(runtime.ok, true);
    if (!runtime.ok) return;
    assert.equal(runtime.runtime.mode, "fake");
    assert.equal(runtime.runtime.submitAllowed, false);
    assert.equal(JSON.stringify(runtime).includes(KEY), false);
    const request = await imageRequest();
    const created = await runtime.runtime.adapter.createTask(request);
    assert.equal(created.kind, "ambiguous");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previous;
  }
});

test("real mode sends the documented image-to-3d request on an injected transport", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("live_fetch_refused");
  };
  const calls: { url: string; method: string; authorization: string | null; body: string; redirect: string | null }[] = [];
  const logs: string[] = [];
  const signed = `https://assets.meshy.ai/tasks/${TASK_ID}/output/model.glb?Expires=1700003600`;
  try {
    const missing = createFurnitureGenerationWorkerRuntime({
      env: {
        VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
        VIBODE_MESHY_GENERATION_ENABLED: "true",
      },
      fetchImpl: async () => {
        throw new Error("fetch_called");
      },
      log: () => undefined,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.missing, "meshy_credential_missing");

    const runtime = createFurnitureGenerationWorkerRuntime({
      env: {
        VIBODE_FURNITURE_GENERATION_PROVIDER: "meshy",
        VIBODE_MESHY_GENERATION_ENABLED: "true",
        MESHY_API_KEY: KEY,
      },
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method ?? "GET",
          authorization: headers.get("authorization"),
          body: typeof init?.body === "string" ? init.body : "",
          redirect: init?.redirect ?? null,
        });
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ result: TASK_ID }), {
            status: 202,
            headers: { "x-api-key": KEY },
          });
        }
        if (url.includes("page_size=")) {
          return new Response(JSON.stringify([{
            id: TASK_ID,
            name: "vibode-11111111-1111-4111-8111-111111111111",
            status: "SUCCEEDED",
            progress: 100,
            consumed_credits: 20,
            expires_at: 1_692_771_679_037,
            model_urls: { glb: signed },
          }]), { status: 200 });
        }
        return new Response(JSON.stringify({
          id: TASK_ID,
          status: "SUCCEEDED",
          progress: 100,
          consumed_credits: 20,
          expires_at: 1_692_771_679_037,
          model_urls: { glb: signed },
        }), { status: 200, headers: { "retry-after": "5" } });
      },
      log: (event, fields) => {
        logs.push(JSON.stringify({ event, fields }));
      },
    });
    assert.equal(runtime.ok, true);
    if (!runtime.ok) return;
    assert.equal(runtime.runtime.mode, "meshy");
    assert.equal(runtime.runtime.submitAllowed, true);
    assert.equal(JSON.stringify(runtime).includes(KEY), false);

    const request = await imageRequest();
    const created = await runtime.runtime.adapter.createTask(request);
    assert.equal(created.kind, "created");
    if (created.kind === "created") assert.equal(created.taskId, TASK_ID);
    const post = calls[0];
    assert.ok(post);
    assert.equal(post.url, "https://api.meshy.ai/openapi/v1/image-to-3d");
    assert.equal(post.method, "POST");
    assert.equal(post.authorization, `Bearer ${KEY}`);
    assert.equal(post.redirect, "manual");
    const body = JSON.parse(post.body) as Record<string, unknown>;
    assert.equal(body.ai_model, "meshy-7.1");
    assert.equal(body.model_type, "standard");
    assert.deepEqual(body.target_formats, ["glb"]);
    assert.equal(body.should_texture, false);
    assert.match(String(body.image_url), /^data:image\/png;base64,/);
    assert.equal(body.name, "vibode-11111111-1111-4111-8111-111111111111");
    assert.equal("input_task_id" in body, false);
    assert.equal("ultra_mode" in body, false);
    assert.equal("auto_size" in body, false);

    const task = await runtime.runtime.adapter.getTask("image-to-3d", TASK_ID);
    assert.equal(task.kind, "task");
    if (task.kind === "task") {
      assert.equal(task.task.status, "SUCCEEDED");
      assert.equal(task.task.consumedCredits, 20);
      assert.equal(task.task.expiresAtMs, 1_692_771_679_037);
      assert.equal(task.task.glbUrl, signed);
    }
    assert.equal(calls[1]?.url, `https://api.meshy.ai/openapi/v1/image-to-3d/${TASK_ID}`);
    assert.equal(calls[1]?.method, "GET");
    assert.equal(calls[1]?.authorization, `Bearer ${KEY}`);

    const page = await runtime.runtime.adapter.listRecentTasks("image-to-3d");
    assert.equal(page.kind, "page");
    if (page.kind === "page") assert.equal(page.tasks[0]?.consumedCredits, 20);
    assert.match(calls[2]?.url ?? "", /^https:\/\/api\.meshy\.ai\/openapi\/v1\/image-to-3d\?page_size=50&sort_by=-created_at$/);

    const logged = logs.join("\n");
    assert.equal(logged.includes(KEY), false);
    assert.equal(logged.includes("data:image"), false);
    assert.equal(logged.includes("https://assets"), false);
    assert.equal(logged.includes("Bearer"), false);
    assert.match(logged, /"path":"\/v1\/image-to-3d"/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("asset downloads stay on the Meshy host and remain bounded", async () => {
  let calls = 0;
  const refused = createBoundedMeshyAssetDownloader(async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  });
  assert.equal((await refused({
    url: "https://evil.example/model.glb",
    timeoutMs: 1_000,
    maxBytes: 100,
  })).kind, "network");
  assert.equal((await refused({
    url: "http://assets.meshy.ai/tasks/abc/model.glb",
    timeoutMs: 1_000,
    maxBytes: 100,
  })).kind, "network");
  assert.equal(calls, 0);

  const download = createBoundedMeshyAssetDownloader(async (_input, init) => {
    calls += 1;
    assert.equal(init?.redirect, "manual");
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": String(PERSONAL_FURNITURE_GLB_MAX_BYTES + 1) },
    });
  });
  assert.equal((await download({
    url: "https://assets.meshy.ai/tasks/abc/output/model.glb",
    timeoutMs: 1_000,
    maxBytes: PERSONAL_FURNITURE_GLB_MAX_BYTES,
  })).kind, "too_large");
  assert.equal(calls, 1);

  const redirect = createBoundedMeshyAssetDownloader(async () => new Response(null, {
    status: 302,
    headers: { location: "https://assets.meshy.ai/tasks/abc/output/model.glb" },
  }));
  const followed = await redirect({
    url: "https://assets.meshy.ai/tasks/abc/model.glb",
    timeoutMs: 1_000,
    maxBytes: 100,
  });
  assert.equal(followed.kind, "redirect");
  if (followed.kind === "redirect") {
    assert.equal(followed.location, "https://assets.meshy.ai/tasks/abc/output/model.glb");
  }
});

async function imageRequest() {
  const bytes = new Uint8Array(await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toBuffer());
  const photos = {
    ...emptyFurniturePhotoSet(),
    front: {
      slot: "front" as const,
      fileName: "front.png",
      mimeType: "image/png" as const,
      byteLength: bytes.byteLength,
      widthPx: 48,
      heightPx: 48,
    },
  };
  const mapped = mapMeshyGenerationDraft({
    photos,
    settings: { ...defaultFurnitureGeneratorSettings(), shouldTexture: false },
  });
  assert.equal(mapped.ok, true);
  if (!mapped.ok) throw new Error("draft");
  const built = buildMeshyCreateRequest({
    draft: mapped.draft,
    taskName: "vibode-11111111-1111-4111-8111-111111111111",
    images: [{
      slot: "front",
      mimeType: "image/png",
      byteLength: bytes.byteLength,
      widthPx: 48,
      heightPx: 48,
      sha256: "ab".repeat(32),
      bytes,
    }],
  });
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("request");
  return built.request;
}
