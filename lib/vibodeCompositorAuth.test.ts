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
import { callCompositorJson, CompositorTransportError } from "./compositorTransportError";
import {
  VIBODE_COMPOSITOR_AUTH_HEADER,
  isVibodeCompositorAuthConfigError,
  mergeVibodeCompositorAuth,
} from "./vibodeCompositorAuth";

const FIXTURE = "sec20e2a-auth-fixture";
const USER_TOKEN = "user-access-token";
const LEGACY_KEY = "legacy-optional-key";
const SAFE_AUTH_MESSAGE = "VIBODE_COMPOSITOR_AUTH_SECRET is not configured.";
const SAFE_URL_MESSAGE =
  "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint).";

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

function assignEnv(name: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

function requireConfigError(error: unknown, label?: string) {
  assert.equal(isVibodeCompositorAuthConfigError(error), true, label);
  if (!isVibodeCompositorAuthConfigError(error)) {
    throw new Error(label ?? "expected compositor auth configuration error");
  }
  return error;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const own = Object.getOwnPropertyNames(error)
    .map((name) => `${name}=${String((error as unknown as Record<string, unknown>)[name])}`)
    .join("\n");
  return `${error.name}\n${error.message}\n${error.stack ?? ""}\n${own}`;
}

function assertNoSecretMaterial(text: string): void {
  assert.equal(text.includes(FIXTURE), false);
  assert.equal(text.includes("attacker-value"), false);
  assert.equal(text.includes("attacker-lower"), false);
  assert.equal(text.includes(USER_TOKEN), false);
  assert.equal(text.includes(LEGACY_KEY), false);
}

async function withFetch(
  run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>
): Promise<string> {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalCompositor = process.env.COMPOSITOR_URL;
  const originalPublic = process.env.NEXT_PUBLIC_COMPOSITOR_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines: string[] = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://compositor.example/stage-room";
  process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = LEGACY_KEY;
  process.env.VIBODE_COMPOSITOR_AUTH_SECRET = FIXTURE;
  process.env.COMPOSITOR_URL = "https://legacy-compositor.example";
  process.env.NEXT_PUBLIC_COMPOSITOR_URL = "https://public-compositor.example";
  assignEnv("NODE_ENV", "development");
  process.env.VERCEL_ENV = "preview";
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
  const restore = () => {
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
    if (originalPublic === undefined) delete process.env.NEXT_PUBLIC_COMPOSITOR_URL;
    else process.env.NEXT_PUBLIC_COMPOSITOR_URL = originalPublic;
    assignEnv("NODE_ENV", originalNodeEnv);
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  };
  try {
    await run(calls);
    return lines.join("\n");
  } finally {
    restore();
  }
}

function childPlacementArgs() {
  return {
    parentImageBytes: Uint8Array.from([1]),
    childImageBytes: Uint8Array.from([2]),
    policyVersion: "afc-sr1-ts0-child-projective-placement-policy/v1" as const,
    registrationExclusion: {
      coordinateSpace: "source-normalized/v1" as const,
      role: "registration_exclusion_support_only_not_placement_authority" as const,
      evidenceLabel: "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY" as const,
      polygon: [[0, 1], [1, 1], [0.5, 0.5]] as Array<readonly [number, number]>,
    },
    ts0Lineage: {
      parent: {
        sha256: "1".repeat(64),
        byteCount: 1,
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1 as const,
      },
      child: {
        sha256: "2".repeat(64),
        byteCount: 1,
        decodedWidth: 1,
        decodedHeight: 1,
        orientation: 1 as const,
      },
    },
  };
}

const hostileHeaders = {
  Authorization: `Bearer ${USER_TOKEN}`,
  "X-Vibode-Compositor-Auth": "attacker-value",
  "x-vibode-compositor-auth": "attacker-lower",
  "x-vibode-request-id": "corr-1",
};

async function compositorCallers(): Promise<Array<{ name: string; run: () => Promise<unknown> }>> {
  return [
    { name: "engine", run: () => callCompositorEngine({ imageBytes: Buffer.from("room"), headers: hostileHeaders }) },
    {
      name: "json",
      run: () => callCompositorJson({
        seam: "stage-run",
        path: "/api/vibode/stage-run",
        payload: { ok: true },
        headers: hostileHeaders,
      }),
    },
    { name: "stage-run", run: () => callCompositorVibodeStageRun({ payload: { ok: true }, headers: hostileHeaders }) },
    {
      name: "compose",
      run: () => callCompositorVibodeCompose({
        roomImageBytes: Buffer.from("room"),
        placements: [],
        headers: hostileHeaders,
      }),
    },
    { name: "remove", run: () => callCompositorVibodeRemove({ cleanBase64: "aaaa", marks: [] }) },
    {
      name: "rotate",
      run: () => callCompositorVibodeRotate({
        freezePayload: {} as never,
        baseImageUrl: "https://example.test/base.png",
      }),
    },
    { name: "full-vibe", run: () => callCompositorVibodeFullVibe({ payload: {} }) },
    { name: "vibe", run: () => callCompositorVibodeVibe({ roomImageBase64: "aaaa", eligibleSkus: [] }) },
    { name: "readiness", run: () => callCompositorAfcSr1Readiness() },
    { name: "tile-floor", run: () => callCompositorAfcSr1TileFloorReader({ payload: { imageBase64: "aaaa" } }) },
    { name: "ts0-placement", run: () => callCompositorAfcSr1Ts0ChildProjectivePlacement(childPlacementArgs()) },
    {
      name: "tiled-perspective",
      run: () => callCompositorAfcSr1TiledPerspectiveReader({
        imageBase64: "aaaa",
        claimedIdentity: {
          sha256: "a".repeat(64),
          byteCount: 1,
          decodedWidth: 1,
          decodedHeight: 1,
          mimeType: "image/png",
          orientation: 1,
        },
      }),
    },
  ];
}

test("merge keeps a user bearer and rejects a blank compositor secret", () => {
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  try {
    process.env.VIBODE_COMPOSITOR_AUTH_SECRET = `  ${FIXTURE}  `;
    const headers = mergeVibodeCompositorAuth({
      "Content-Type": "application/json",
      Authorization: `Bearer ${USER_TOKEN}`,
      "X-Vibode-Compositor-Auth": "attacker-value",
      "x-vibode-compositor-auth": "attacker-lower",
      "x-vibode-request-id": "corr-1",
    });
    assert.equal(headers.Authorization, `Bearer ${USER_TOKEN}`);
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["x-vibode-request-id"], "corr-1");
    assert.equal(sendsFixture(headers), true);
    assert.equal(
      Object.keys(headers).filter((name) => name.toLowerCase() === VIBODE_COMPOSITOR_AUTH_HEADER.toLowerCase()).length,
      1
    );
    const serialized = JSON.stringify(headers);
    assert.equal(serialized.includes("attacker-value"), false);
    assert.equal(serialized.includes("attacker-lower"), false);
    assert.equal(serialized.includes(`  ${FIXTURE}  `), false);

    for (const secret of [undefined, "", " \n\t ", "\t", "\n"]) {
      if (secret === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
      else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = secret;
      assert.throws(
        () => mergeVibodeCompositorAuth({
          Authorization: `Bearer ${USER_TOKEN}`,
          "X-Vibode-Compositor-Auth": "attacker-value",
          "x-vibode-request-id": "corr-1",
        }),
        (error: unknown) => {
          const configError = requireConfigError(error);
          assert.equal(configError.message, SAFE_AUTH_MESSAGE);
          assertNoSecretMaterial(errorText(configError));
          return true;
        }
      );
    }
  } finally {
    if (originalAuth === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
    else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = originalAuth;
  }
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
    await callCompositorAfcSr1Ts0ChildProjectivePlacement(childPlacementArgs());
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
      assert.equal(call.url.includes("legacy-compositor.example"), false);
      assert.equal(call.url.includes("public-compositor.example"), false);
      assert.equal(call.url.includes("localhost"), false);
      const headers = headerRecord(call.init?.headers);
      const alreadySentLegacyBearer =
        !call.url.endsWith("/vibode/vibe") && !call.url.endsWith("/vibode/compose");
      if (alreadySentLegacyBearer) {
        assert.equal(headers.Authorization === `Bearer ${LEGACY_KEY}`, true);
      } else {
        assert.equal("Authorization" in headers, false);
      }
    }
    const vibeCalls = calls.filter((call) => call.url.endsWith("/vibode/vibe"));
    assert.equal(vibeCalls.length, 1);
    assert.equal(vibeCalls[0]?.url, "https://compositor.example/vibode/vibe");
  });
  assertNoSecretMaterial(logs);
});

test("blank compositor auth fails before fetch for every shared caller", async () => {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalPublic = process.env.NEXT_PUBLIC_COMPOSITOR_URL;
  const originalCompositor = process.env.COMPOSITOR_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines: string[] = [];
  const write = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://compositor.example/stage-room";
  process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = LEGACY_KEY;
  process.env.NEXT_PUBLIC_COMPOSITOR_URL = "https://public-compositor.example";
  process.env.COMPOSITOR_URL = "https://legacy-compositor.example";
  assignEnv("NODE_ENV", "development");
  process.env.VERCEL_ENV = "preview";
  try {
    for (const secret of [undefined, "", " \n\t "]) {
      if (secret === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
      else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = secret;
      for (const caller of await compositorCallers()) {
        let called = false;
        globalThis.fetch = async () => {
          called = true;
          throw new Error("fetch was invoked");
        };
        await assert.rejects(caller.run(), (error: unknown) => {
          const configError = requireConfigError(error, caller.name);
          assert.equal(error instanceof CompositorTransportError, false, caller.name);
          assert.equal(configError.message, SAFE_AUTH_MESSAGE);
          assertNoSecretMaterial(errorText(configError));
          return true;
        }, caller.name);
        assert.equal(called, false, caller.name);
      }
    }
    assertNoSecretMaterial(lines.join("\n"));
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
    if (originalPublic === undefined) delete process.env.NEXT_PUBLIC_COMPOSITOR_URL;
    else process.env.NEXT_PUBLIC_COMPOSITOR_URL = originalPublic;
    if (originalCompositor === undefined) delete process.env.COMPOSITOR_URL;
    else process.env.COMPOSITOR_URL = originalCompositor;
    assignEnv("NODE_ENV", originalNodeEnv);
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});

test("vibe caller uses only the server compositor URL and fails before fetch without it", async () => {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalPublic = process.env.NEXT_PUBLIC_COMPOSITOR_URL;
  const originalCompositor = process.env.COMPOSITOR_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  process.env.VIBODE_COMPOSITOR_AUTH_SECRET = FIXTURE;
  process.env.NEXT_PUBLIC_COMPOSITOR_URL = "https://public-compositor.example";
  process.env.COMPOSITOR_URL = "https://legacy-compositor.example";
  assignEnv("NODE_ENV", "development");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ imageUrl: "https://example.test/out.png" });
  };
  try {
    for (const url of [undefined, "", "   "]) {
      if (url === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
      else process.env.ROOMPRINTZ_COMPOSITOR_URL = url;
      const before = calls.length;
      await assert.rejects(
        callCompositorVibodeVibe({ roomImageBase64: "aaaa", eligibleSkus: [] }),
        (error) => {
          assert.equal(error instanceof Error, true);
          assert.equal(isVibodeCompositorAuthConfigError(error), false);
          assert.equal((error as Error).message, SAFE_URL_MESSAGE);
          assert.equal((error as Error).message.includes("NEXT_PUBLIC"), false);
          assert.equal((error as Error).message.includes("localhost"), false);
          assertNoSecretMaterial(errorText(error));
          return true;
        }
      );
      assert.equal(calls.length, before);
    }

    process.env.ROOMPRINTZ_COMPOSITOR_URL = "https://compositor.example/vibode/vibe/";
    const response = await callCompositorVibodeVibe({
      roomImageBase64: "aaaa",
      eligibleSkus: [],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://compositor.example/vibode/vibe");
    assert.equal(sendsFixture(calls[0]?.init?.headers), true);
    assert.equal(calls[0]?.url.includes("public-compositor.example"), false);
    assert.equal(calls[0]?.url.includes("legacy-compositor.example"), false);
    assert.deepEqual(response, { imageUrl: "https://example.test/out.png" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    if (originalAuth === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
    else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = originalAuth;
    if (originalPublic === undefined) delete process.env.NEXT_PUBLIC_COMPOSITOR_URL;
    else process.env.NEXT_PUBLIC_COMPOSITOR_URL = originalPublic;
    if (originalCompositor === undefined) delete process.env.COMPOSITOR_URL;
    else process.env.COMPOSITOR_URL = originalCompositor;
    assignEnv("NODE_ENV", originalNodeEnv);
  }
});

test("missing compositor URL stays a construction failure and does not fetch", async () => {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalFetch = globalThis.fetch;
  delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
  delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("fetch was invoked");
  };
  try {
    await assert.rejects(
      callCompositorJson({
        seam: "readiness",
        path: "/api/research/afc-sr1/readiness",
      }),
      (error) =>
        error instanceof CompositorTransportError &&
        error.classification === "client_construction_failure" &&
        error.message === "Compositor client request could not be constructed."
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    if (originalAuth === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
    else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = originalAuth;
  }
});

test("inline compositor callers keep the user bearer and attach the header before fetch", () => {
  const files = {
    "app/api/vibode/user-skus/ingest/route.ts":
      /const headers = mergeVibodeCompositorAuth\(\{[\s\S]*Authorization: `Bearer \$\{accessToken\}`/,
    "app/api/vibode/generate/route.ts":
      /const headers = mergeVibodeCompositorAuth\(\{[\s\S]*Authorization: `Bearer \$\{apiKey\}`/,
    "app/api/vibode/edit-run/route.ts": /mergeVibodeCompositorAuth\(\{\}\)/,
    "app/api/vibode/paste-to-place/cancel/route.ts":
      /mergeVibodeCompositorAuth\(\{[\s\S]*Authorization: `Bearer \$\{apiKey\}`/,
    "lib/callCompositorEngine.ts": /mergeVibodeCompositorAuth\(/,
    "lib/callCompositorVibodeCompose.ts": /mergeVibodeCompositorAuth\(/,
    "lib/callCompositorVibodeRemove.ts": /mergeVibodeCompositorAuth\(/,
    "lib/callCompositorVibodeRotate.ts": /mergeVibodeCompositorAuth\(/,
    "lib/callCompositorVibodeFullVibe.ts": /mergeVibodeCompositorAuth\(/,
    "lib/callCompositorVibodeVibe.ts": /mergeVibodeCompositorAuth\(/,
    "lib/compositorTransportError.ts": /mergeVibodeCompositorAuth\(/,
  };
  for (const [file, pattern] of Object.entries(files)) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, pattern);
    const authAt = source.indexOf("mergeVibodeCompositorAuth(");
    const fetchAt = source.indexOf("fetch(", authAt);
    assert.equal(authAt >= 0 && fetchAt > authAt, true, file);
    assert.equal(source.includes("COMPOSITOR_SHARED_SECRET"), false);
  }
  const helper = readFileSync(new URL("./vibodeCompositorAuth.ts", import.meta.url), "utf8");
  assert.equal(helper.includes("ROOMPRINTZ_COMPOSITOR_API_KEY"), false);
  assert.equal(helper.includes("COMPOSITOR_SHARED_SECRET"), false);
  assert.equal(helper.includes("NEXT_PUBLIC_"), false);
  assert.equal(helper.includes("NODE_ENV"), false);
  assert.equal(helper.includes("VERCEL_ENV"), false);
  assert.equal(helper.includes("localhost"), false);
  const vibe = readFileSync(new URL("./callCompositorVibodeVibe.ts", import.meta.url), "utf8");
  assert.match(vibe, /ROOMPRINTZ_COMPOSITOR_URL/);
  assert.doesNotMatch(vibe, /NEXT_PUBLIC_COMPOSITOR_URL|localhost:8000/);
  assert.doesNotMatch(vibe, /(?<!ROOMPRINTZ_)COMPOSITOR_URL/);
  const cancel = readFileSync(
    new URL("../app/api/vibode/paste-to-place/cancel/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(cancel, /if \(!isVibodeCompositorAuthConfigError\(error\)\) throw error;/);
});
