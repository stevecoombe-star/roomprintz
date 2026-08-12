import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_PATH,
  callCompositorAfcSr1Ts0ChildProjectivePlacement,
  type CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs,
} from "./callCompositorAfcSr1Ts0ChildProjectivePlacement";
import { CompositorTransportError } from "./compositorTransportError";

const parentBytes = Uint8Array.from([1, 2, 3]);
const childBytes = Uint8Array.from([4, 5, 6]);
const args: CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs = {
  parentImageBytes: parentBytes,
  childImageBytes: childBytes,
  policyVersion: "afc-sr1-ts0-child-projective-placement-policy/v1",
  registrationExclusion: {
    coordinateSpace: "source-normalized/v1",
    role: "registration_exclusion_support_only_not_placement_authority",
    evidenceLabel:
      "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY",
    polygon: [[0, 1], [1, 1], [0.5, 0.5]],
  },
  ts0Lineage: {
    parent: {
      sha256: "1".repeat(64),
      byteCount: 3,
      decodedWidth: 2,
      decodedHeight: 2,
      orientation: 1,
    },
    child: {
      sha256: "2".repeat(64),
      byteCount: 3,
      decodedWidth: 2,
      decodedHeight: 2,
      orientation: 1,
    },
  },
};

function withEnvironment(
  callback: () => Promise<void>
): Promise<void> {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ROOMPRINTZ_COMPOSITOR_URL =
    "https://compositor.example/vibode/compose";
  process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = "secret";
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
  });
}

test("placement client sends only the frozen endpoint payload and auth convention", async () => {
  await withEnvironment(async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await callCompositorAfcSr1Ts0ChildProjectivePlacement(args);
    assert.deepEqual(result, { status: "ok" });
    assert.equal(
      capturedUrl,
      `https://compositor.example${AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_PATH}`
    );
    assert.equal(capturedInit?.method, "POST");
    assert.deepEqual(capturedInit?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
    });
    const payload = JSON.parse(String(capturedInit?.body));
    assert.deepEqual(Object.keys(payload).sort(), [
      "childImageBase64",
      "parentImageBase64",
      "policyVersion",
      "registrationExclusion",
      "ts0Lineage",
    ]);
    assert.equal(payload.parentImageBase64, Buffer.from(parentBytes).toString("base64"));
    assert.equal(payload.childImageBase64, Buffer.from(childBytes).toString("base64"));
    assert.deepEqual(payload.registrationExclusion, args.registrationExclusion);
    assert.deepEqual(payload.ts0Lineage, args.ts0Lineage);
    for (const forbidden of [
      "floorVanishingLine",
      "seamT",
      "GT0",
      "anchor",
      "fov",
      "roomWidth",
      "roomDepth",
      "track1a",
    ]) {
      assert.equal(Object.hasOwn(payload, forbidden), false);
    }
  });
});

test("placement client rejects non-OK and malformed JSON responses", async () => {
  await withEnvironment(async () => {
    globalThis.fetch = async () => new Response("disabled", { status: 404 });
    await assert.rejects(
      callCompositorAfcSr1Ts0ChildProjectivePlacement(args),
      (error) =>
        error instanceof CompositorTransportError &&
        error.classification === "http_404" &&
        error.httpStatus === 404
    );

    globalThis.fetch = async () => new Response("{", { status: 200 });
    await assert.rejects(
      callCompositorAfcSr1Ts0ChildProjectivePlacement(args),
      (error) =>
        error instanceof CompositorTransportError &&
        error.classification === "malformed_response"
    );
  });
});

test("placement client forwards AbortSignal and omits auth when unconfigured", async () => {
  await withEnvironment(async () => {
    delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.signal, controller.signal);
      assert.deepEqual(init?.headers, { "Content-Type": "application/json" });
      throw new DOMException("aborted", "AbortError");
    };
    await assert.rejects(
      callCompositorAfcSr1Ts0ChildProjectivePlacement({
        ...args,
        signal: controller.signal,
      }),
      (error) =>
        error instanceof CompositorTransportError &&
        error.classification === "timeout"
    );
  });
});
