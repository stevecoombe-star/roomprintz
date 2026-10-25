import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_SR1_TR2_TILE_FLOOR_READER_PATH,
  callCompositorAfcSr1TileFloorReader,
} from "./callCompositorAfcSr1TileFloorReader";
import { CompositorTransportError } from "./compositorTransportError";
import { isVibodeCompositorAuthConfigError } from "./vibodeCompositorAuth";

function withEnvironment(callback: () => Promise<void>): Promise<void> {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalFetch = globalThis.fetch;
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://compositor.example/stage-room";
  process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = "secret";
  process.env.VIBODE_COMPOSITOR_AUTH_SECRET = "offline-dedicated-auth";
  return callback().finally(() => {
    if (originalUrl === undefined) {
      delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    } else {
      process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    }
    if (originalKey === undefined) {
      delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    } else {
      process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = originalKey;
    }
    globalThis.fetch = originalFetch;
    if (originalAuth === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
    else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = originalAuth;
  });
}

test("Reader client preserves request payload and auth convention", async () => {
  await withEnvironment(async () => {
    const payload = {
      researchProfile: "afc-sr1-tr2-tile-floor-reader/v3",
      imageBase64: "control-only",
    };
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return Response.json({ status: "rejected", reason: "insufficient_segments" });
    };
    const result = await callCompositorAfcSr1TileFloorReader({ payload });
    assert.deepEqual(result, {
      status: "rejected",
      reason: "insufficient_segments",
    });
    assert.equal(
      observedUrl,
      `https://compositor.example${AFC_SR1_TR2_TILE_FLOOR_READER_PATH}`
    );
    assert.deepEqual(observedInit?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
      "X-Vibode-Compositor-Auth": "offline-dedicated-auth",
    });
    assert.deepEqual(JSON.parse(String(observedInit?.body)), payload);
  });
});

test("Reader gate-off response is typed and sanitized", async () => {
  await withEnvironment(async () => {
    globalThis.fetch = async () =>
      new Response("Bearer secret imageBase64=control-only", { status: 404 });
    await assert.rejects(
      callCompositorAfcSr1TileFloorReader({ payload: { imageBase64: "control-only" } }),
      (error) => {
        assert.ok(error instanceof CompositorTransportError);
        assert.equal(error.classification, "http_404");
        assert.equal(error.httpStatus, 404);
        assert.equal(error.message, "Compositor returned HTTP 404.");
        assert.doesNotMatch(error.message, /secret|imageBase64|control-only|offline-dedicated-auth/);
        return true;
      }
    );
  });
});

test("Reader client fails before fetch when compositor auth is blank", async () => {
  await withEnvironment(async () => {
    for (const secret of [undefined, "", " \n\t "]) {
      if (secret === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
      else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = secret;
      let called = false;
      globalThis.fetch = async () => {
        called = true;
        return Response.json({ status: "rejected" });
      };
      await assert.rejects(
        callCompositorAfcSr1TileFloorReader({ payload: { imageBase64: "control-only" } }),
        (error: unknown) => {
          assert.equal(isVibodeCompositorAuthConfigError(error), true);
          if (!isVibodeCompositorAuthConfigError(error)) return false;
          assert.equal(error.message, "VIBODE_COMPOSITOR_AUTH_SECRET is not configured.");
          assert.equal(error.message.includes("offline-dedicated-auth"), false);
          assert.equal(error.message.includes("control-only"), false);
          return true;
        }
      );
      assert.equal(called, false);
    }
  });
});
