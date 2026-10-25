import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { getPasteToPlaceJobState } from "@/lib/pasteToPlaceJobRegistry";
import {
  VIBODE_COMPOSITOR_AUTH_HEADER,
  VibodeCompositorAuthConfigError,
} from "@/lib/vibodeCompositorAuth";

import { handlePasteToPlaceCancel, POST } from "./route";

const FIXTURE = "sec20e2a-auth-fixture";
const LEGACY_KEY = "legacy-optional-key";
const USER_TOKEN = "user-access-token";

type FetchCall = { url: string; init?: RequestInit };

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://127.0.0.1/api/vibode/paste-to-place/cancel", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers ?? {}) };
}

async function withOfflineFetch(
  run: (calls: FetchCall[]) => Promise<void>,
  env: {
    url?: string;
    secret?: string;
    apiKey?: string;
  } = {}
): Promise<void> {
  const originalUrl = process.env.ROOMPRINTZ_COMPOSITOR_URL;
  const originalAuth = process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  const originalKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const lines: string[] = [];
  const calls: FetchCall[] = [];
  if (env.url === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
  else process.env.ROOMPRINTZ_COMPOSITOR_URL = env.url;
  if (env.secret === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
  else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = env.secret;
  if (env.apiKey === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
  else process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = env.apiKey;
  const write = (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  };
  console.log = write;
  console.info = write;
  console.warn = write;
  console.error = write;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ ok: true });
  };
  try {
    await run(calls);
    const output = lines.join("\n");
    assert.equal(output.includes(FIXTURE), false);
    assert.equal(output.includes("attacker-value"), false);
    assert.equal(output.includes(USER_TOKEN), false);
    assert.equal(output.includes(LEGACY_KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    if (originalUrl === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_URL;
    else process.env.ROOMPRINTZ_COMPOSITOR_URL = originalUrl;
    if (originalAuth === undefined) delete process.env.VIBODE_COMPOSITOR_AUTH_SECRET;
    else process.env.VIBODE_COMPOSITOR_AUTH_SECRET = originalAuth;
    if (originalKey === undefined) delete process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    else process.env.ROOMPRINTZ_COMPOSITOR_API_KEY = originalKey;
  }
}

test("local validation and authorization failures are not masked when compositor auth is missing", async () => {
  await withOfflineFetch(async (calls) => {
    const missing = await POST(request({ scopeId: "scope-missing" }));
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: "Missing jobId/scopeId." });

    const unauthorized = await POST(request(
      { jobId: "job-unauth", scopeId: "scope-unauth" },
      { "x-vibode-compositor-auth": "attacker-value" }
    ));
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), { error: "Unauthorized" });
    assert.equal(getPasteToPlaceJobState("scope-unauth", "job-unauth"), "unknown");

    const invalid = await POST(request("{"));
    assert.equal(invalid.status, 500);
    assert.equal(((await invalid.json()) as { ok?: boolean }).ok, undefined);
    assert.equal(calls.length, 0);
  }, { url: "https://compositor.example/stage-room" });
});

test("local paste-to-place cancel succeeds when remote cancel cannot authenticate", async () => {
  for (const secret of [undefined, "", " \n\t "]) {
    await withOfflineFetch(async (calls) => {
      const scopeId = `scope-${secret === undefined ? "missing" : secret.trim() || "blank"}`;
      const jobId = "job-local";
      const response = await handlePasteToPlaceCancel(
        request(
          { jobId, scopeId },
          {
            authorization: `Bearer ${USER_TOKEN}`,
            "x-vibode-compositor-auth": "attacker-value",
          }
        ),
        async () => true
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(getPasteToPlaceJobState(scopeId, jobId), "cancelled");
      assert.equal(calls.length, 0);
    }, {
      url: "https://compositor.example/stage-room",
      secret,
      apiKey: LEGACY_KEY,
    });
  }
});

test("authenticated remote cancel forwards the server secret and ignores caller auth headers", async () => {
  await withOfflineFetch(async (calls) => {
    const response = await handlePasteToPlaceCancel(
      request(
        { jobId: "job-remote", scopeId: "scope-remote" },
        {
          authorization: `Bearer ${USER_TOKEN}`,
          "x-vibode-compositor-auth": "attacker-value",
        }
      ),
      async () => true
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      "https://compositor.example/api/vibode/paste-to-place/cancel"
    );
    const headers = headerRecord(calls[0]?.init?.headers);
    assert.equal(headers.Authorization, `Bearer ${LEGACY_KEY}`);
    assert.equal(headers[VIBODE_COMPOSITOR_AUTH_HEADER] === FIXTURE, true);
    assert.equal(JSON.stringify(headers).includes("attacker-value"), false);
    assert.equal(JSON.stringify(headers).includes(USER_TOKEN), false);
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      scopeId: "scope-remote",
      jobId: "job-remote",
    });
    assert.equal(getPasteToPlaceJobState("scope-remote", "job-remote"), "cancelled");
  }, {
    url: "https://compositor.example/stage-room",
    secret: FIXTURE,
    apiKey: LEGACY_KEY,
  });
});

test("remote transport failure stays best-effort after local cancel", async () => {
  await withOfflineFetch(async (calls) => {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      throw new TypeError("offline transport");
    };
    const asyncFailure = await handlePasteToPlaceCancel(
      request({ jobId: "job-transport", scopeId: "scope-transport" }),
      async () => true
    );
    assert.equal(asyncFailure.status, 200);
    assert.deepEqual(await asyncFailure.json(), { ok: true });

    globalThis.fetch = () => {
      calls.push({ url: "sync" });
      throw new TypeError("sync transport");
    };
    const syncFailure = await handlePasteToPlaceCancel(
      request({ jobId: "job-sync", scopeId: "scope-sync" }),
      async () => true
    );
    assert.equal(syncFailure.status, 200);
    assert.deepEqual(await syncFailure.json(), { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(getPasteToPlaceJobState("scope-transport", "job-transport"), "cancelled");
    assert.equal(getPasteToPlaceJobState("scope-sync", "job-sync"), "cancelled");
  }, {
    url: "https://compositor.example/stage-room",
    secret: FIXTURE,
  });
});

test("unrelated local failures are not treated as compositor configuration failures", async () => {
  await withOfflineFetch(async (calls) => {
    const denied = await handlePasteToPlaceCancel(
      request({ jobId: "job-denied", scopeId: "scope-denied" }),
      async () => false
    );
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: "Unauthorized" });
    assert.equal(getPasteToPlaceJobState("scope-denied", "job-denied"), "unknown");

    const broken = await handlePasteToPlaceCancel(
      request({ jobId: "job-broken", scopeId: "scope-broken" }),
      async () => {
        throw new Error("membership lookup failed");
      }
    );
    assert.equal(broken.status, 500);
    assert.deepEqual(await broken.json(), { error: "membership lookup failed" });
    assert.equal(getPasteToPlaceJobState("scope-broken", "job-broken"), "unknown");

    const configFromLocal = await handlePasteToPlaceCancel(
      request({ jobId: "job-local-config", scopeId: "scope-local-config" }),
      async () => {
        throw new VibodeCompositorAuthConfigError();
      }
    );
    assert.equal(configFromLocal.status, 500);
    assert.equal(((await configFromLocal.json()) as { ok?: boolean }).ok, undefined);
    assert.equal(getPasteToPlaceJobState("scope-local-config", "job-local-config"), "unknown");
    assert.equal(calls.length, 0);
  }, {
    url: "https://compositor.example/stage-room",
    secret: undefined,
  });
});

test("missing compositor URL skips the remote hop after local cancel", async () => {
  await withOfflineFetch(async (calls) => {
    const response = await handlePasteToPlaceCancel(
      request({ jobId: "job-nourl", scopeId: "scope-nourl" }),
      async () => true
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(getPasteToPlaceJobState("scope-nourl", "job-nourl"), "cancelled");
    assert.equal(calls.length, 0);
  });
});
