import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_SR1_READINESS_PATH,
  callCompositorAfcSr1Readiness,
} from "./callCompositorAfcSr1Readiness";
import { CompositorTransportError } from "./compositorTransportError";

test("readiness client requires the exact diagnostic-only response", async () => {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalFetch = globalThis.fetch;
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "http://127.0.0.1:8000";
  try {
    let observedUrl = "";
    globalThis.fetch = async (input) => {
      observedUrl = String(input);
      return Response.json({
        schemaVersion: "afc-sr1-readiness/v2",
        readerEnabled: true,
        placementEnabled: false,
        ts0GeneratorReady: true,
        ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1",
        ts0RequestedModelId: "NBP",
      });
    };
    assert.deepEqual(await callCompositorAfcSr1Readiness(), {
      schemaVersion: "afc-sr1-readiness/v2",
      readerEnabled: true,
      placementEnabled: false,
      ts0GeneratorReady: true,
      ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1",
      ts0RequestedModelId: "NBP",
    });
    assert.equal(
      observedUrl,
      `http://127.0.0.1:8000${AFC_SR1_READINESS_PATH}`
    );

    globalThis.fetch = async () =>
      Response.json({
        schemaVersion: "afc-sr1-readiness/v2",
        readerEnabled: true,
        placementEnabled: true,
        ts0GeneratorReady: true,
        ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1",
        ts0RequestedModelId: "NBP",
        scientificResult: "forbidden",
      });
    await assert.rejects(
      callCompositorAfcSr1Readiness(),
      (error) =>
        error instanceof CompositorTransportError &&
        error.classification === "malformed_response"
    );
  } finally {
    if (originalUrl === undefined) {
      delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    } else {
      process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    }
    globalThis.fetch = originalFetch;
  }
});
