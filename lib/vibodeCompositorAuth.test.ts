import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { callCompositorAfcSr1Readiness } from "./callCompositorAfcSr1Readiness";
import { callCompositorAfcSr1TileFloorReader } from "./callCompositorAfcSr1TileFloorReader";
import { callCompositorAfcSr1TiledPerspectiveReader } from "./callCompositorAfcSr1TiledPerspectiveReader";
import { callCompositorAfcSr1Ts0ChildProjectivePlacement } from "./callCompositorAfcSr1Ts0ChildProjectivePlacement";
import { callCompositorEngine } from "./callCompositorEngine";
import { callCompositorVibodeCompose } from "./callCompositorVibodeCompose";
import { callCompositorVibodeFullVibe } from "./callCompositorVibodeFullVibe";
import { callCompositorVibodeRemove } from "./callCompositorVibodeRemove";
import { callCompositorVibodeRotate } from "./callCompositorVibodeRotate";
import { callCompositorVibodeStageRun } from "./callCompositorVibodeStageRun";
import { callCompositorVibodeVibe } from "./callCompositorVibodeVibe";
import { callCompositorJson } from "./compositorTransportError";
import {
  VIBODE_COMPOSITOR_AUTH_HEADER,
  mergeVibodeCompositorAuth,
} from "./vibodeCompositorAuth";

const FIXTURE = "sec19b-ui-fixture";
const USER_TOKEN = "user-access-token";

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...(headers ?? {}) };
}

function sendsFixture(headers: HeadersInit | undefined): boolean {
  return headerRecord(headers)[VIBODE_COMPOSITOR_AUTH_HEADER] === FIXTURE;
}

async function withFetch(
  run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>
): Promise<string> {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalCompositor = process.env.COMPOSITOR_URL;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines: string[] = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://compositor.example/stage-room";
  process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = "legacy-optional-key";
  process.env.VIBODE_COMPOSITOR_AUTH_SECRET = FIXTURE;
  process.env.COMPOSITOR_URL = "https://compositor.example";
  const write = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const path = String(input);
    if (path.endsWith("/api/research/afc-sr1/readiness")) {
      return Response.json({
        schemaVersion: "afc-sr1-readiness/v2",
        readerEnabled: false,
        placementEnabled: false,
        ts0GeneratorReady: false,
        ts0GeneratorProfile: "afc-sr1-tile-grid-scaffold/v1",
        ts0RequestedModelId: "NBP",
      });
    }
    return Response.json({ imageUrl: "https://example.test/out.png", status: "ok" });
  };
  try {
    await run(calls);
    return lines.join("\n");
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    if (originalUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    if (originalKey === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    else process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = originalKey;
    if (originalAuth === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
    else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = originalAuth;
    if (originalCompositor === undefined) delete process.env.COMPOSITOR_URL;
    else process.env.COMPOSITOR_URL = originalCompositor;
  }
}

test("merge keeps a user bearer and adds the compositor header", () => {
  process.env.VIBODE_COMPOSITOR_AUTH_SECRET = FIXTURE;
  const headers = mergeVibodeCompositorAuth({
    "Content-Type": "application/json",
    Authorization: `Bearer ${USER_TOKEN}`,
  });
  assert.equal(headers.Authorization, `Bearer ${USER_TOKEN}`);
  assert.equal(sendsFixture(headers), true);
  delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const omitted = mergeVibodeCompositorAuth({
    Authorization: `Bearer ${USER_TOKEN}`,
  });
  assert.equal(omitted.Authorization, `Bearer ${USER_TOKEN}`);
  assert.equal(VIBODE_COMPOSITOR_AUTH_HEADER in omitted, false);
});

test("server wrappers send the dedicated header and keep the legacy bearer", async () => {
  const logs = await withFetch(async (calls) => {
    await callCompositorEngine({ imageBytes: Buffer.from("room") });
    await callCompositorJson({
      seam: "stage-run",
      path: "/api/vibode/stage-run",
      payload: { ok: true },
    });
    await callCompositorVibodeStageRun({ payload: { ok: true } });
    await callCompositorVibodeCompose({
      roomImageBytes: Buffer.from("room"),
      placements: [],
    });
    await callCompositorVibodeRemove({ cleanBase64: "aaaa", marks: [] });
    await callCompositorVibodeRotate({
      freezePayload: {} as never,
      baseImageUrl: "https://example.test/base.png",
    });
    await callCompositorVibodeFullVibe({ payload: {} });
    await callCompositorVibodeVibe({
      roomImageBase64: "aaaa",
      eligibleSkus: [],
    });
    await callCompositorAfcSr1Readiness();
    await callCompositorAfcSr1TileFloorReader({ payload: { imageBase64: "aaaa" } });
    await callCompositorAfcSr1Ts0ChildProjectivePlacement({
      parentImageBytes: Uint8Array.from([1]),
      childImageBytes: Uint8Array.from([2]),
      policyVersion: "afc-sr1-ts0-child-projective-placement-policy/v1",
      registrationExclusion: {
        coordinateSpace: "source-normalized/v1",
        role: "registration_exclusion_support_only_not_placement_authority",
        evidenceLabel: "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY",
        polygon: [[0, 1], [1, 1], [0.5, 0.5]],
      },
      ts0Lineage: {
        parent: {
          sha256: "1".repeat(64),
          byteCount: 1,
          decodedWidth: 1,
          decodedHeight: 1,
          orientation: 1,
        },
        child: {
          sha256: "2".repeat(64),
          byteCount: 1,
          decodedWidth: 1,
          decodedHeight: 1,
          orientation: 1,
        },
      },
    });
    try {
      await callCompositorAfcSr1TiledPerspectiveReader({
        imageBase64: "aaaa",
        claimedIdentity: {
          sha256: "a".repeat(64),
          byteCount: 1,
          decodedWidth: 1,
          decodedHeight: 1,
          mimeType: "image/png",
          orientation: 1,
        },
      });
    } catch {
      // The mocked body is only there to capture the outbound header.
    }
    assert.equal(calls.length, 12);
    for (const call of calls) {
      assert.equal(sendsFixture(call.init?.headers), true);
      const headers = headerRecord(call.init?.headers);
      const alreadySentLegacyBearer =
        !call.url.endsWith("/vibode/vibe") && !call.url.endsWith("/vibode/compose");
      if (alreadySentLegacyBearer) {
        assert.equal(headers.Authorization === "Bearer legacy-optional-key", true);
      }
    }
  });
  assert.equal(logs.includes(FIXTURE), false);
});

test("inline compositor callers keep the user bearer and attach the header", () => {
  const files = {
    "app/api/vibode/user-skus/ingest/route.ts":
      /headers: mergeVibodeCompositorAuth\(\{[\s\S]*Authorization: `Bearer \$\{accessToken\}`/,
    "app/api/vibode/generate/route.ts":
      /const headers = mergeVibodeCompositorAuth\(\{[\s\S]*Authorization: `Bearer \$\{apiKey\}`/,
    "app/api/vibode/edit-run/route.ts": /mergeVibodeCompositorAuth\(\{\}\)/,
    "app/api/vibode/paste-to-place/cancel/route.ts":
      /mergeVibodeCompositorAuth\(\{[\s\S]*Authorization: `Bearer \$\{apiKey\}`/,
  };
  for (const [file, pattern] of Object.entries(files)) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, pattern);
    assert.equal(source.includes("COMPOSITOR_SHARED_SECRET"), false);
  }
  const helper = readFileSync(new URL("./vibodeCompositorAuth.ts", import.meta.url), "utf8");
  assert.equal(helper.includes("ROOMPRINTZ_COMPOSITOR_API_KEY"), false);
  assert.equal(helper.includes("COMPOSITOR_SHARED_SECRET"), false);
});
