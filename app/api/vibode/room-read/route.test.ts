import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const ROUTE_PATH = "app/api/vibode/room-read/route.ts";
const ROUTE_TEST_PATH = "app/api/vibode/room-read/route.test.ts";
const HELPER_PATH = "lib/vibodeGeminiRoomRead.ts";
const OBJECTS_ROUTE_PATH = "app/api/vibode/room-image-objects/route.ts";
const ROUTE_URL = "http://127.0.0.1/api/vibode/room-read";
const HELPER_SYMBOL = "runGeminiRoomReadFromImageUrl";
const NOT_FOUND = { error: "Not found." };
const GEMINI_ENV_KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;
const OFFLINE_ENV_VALUE = "sec20b-offline-not-a-credential";
const SKIP_DIRS = new Set([
  ".git",
  ".local",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const EXTERNAL_IMAGE_URL = "https://hostile.example/room.jpg";
const DATA_IMAGE_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const LOOPBACK_AND_LINK_LOCAL_URLS = [
  "http://127.0.0.1/room.jpg",
  "http://localhost/room.jpg",
  "http://[::1]/room.jpg",
  "http://169.254.169.254/latest/meta-data/",
  "http://[fe80::1]/room.jpg",
];

const originalFetch = globalThis.fetch;
let fetchCalls = 0;

globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("blocked-network");
};

test.after(() => {
  globalThis.fetch = originalFetch;
});

test.beforeEach(() => {
  fetchCalls = 0;
});

type RoomReadPost = (request?: Request) => Promise<Response>;

let routeModulePromise: Promise<typeof import("./route")> | undefined;

function loadRoute(): Promise<typeof import("./route")> {
  routeModulePromise ??= import("./route");
  return routeModulePromise;
}

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitHead(relativePath: string): string {
  const result = spawnSync("git", ["show", `HEAD:${relativePath}`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  return result.stdout;
}

function assertUnchanged(relativePath: string): void {
  assert.equal(sha256(source(relativePath)), sha256(gitHead(relativePath)));
}

function relativePath(fullPath: string): string {
  return path.relative(ROOT, fullPath).split(path.sep).join("/");
}

function collectHelperReferences(dir: string, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectHelperReferences(path.join(dir, entry.name), hits);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(?:[cm]?ts|tsx)$/.test(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (!readFileSync(fullPath, "utf8").includes(HELPER_SYMBOL)) continue;
    hits.push(relativePath(fullPath));
  }
}

function jsonRequest(
  body: string | undefined,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request(ROUTE_URL, {
    method: "POST",
    headers,
    body,
  });
}

async function invoke(request: Request): Promise<Response> {
  const { POST } = await loadRoute();
  const handler: RoomReadPost = POST;
  return handler(request);
}

async function assertNotFound(request: Request): Promise<void> {
  fetchCalls = 0;
  const response = await invoke(request);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), NOT_FOUND);
  assert.equal(fetchCalls, 0);
}

function assertEnvPresent(name: (typeof GEMINI_ENV_KEYS)[number]): void {
  const value = process.env[name];
  assert.equal(typeof value, "string", name);
  assert.equal((value ?? "").length > 0, true, name);
}

async function withGeminiEnvPresent(run: () => Promise<void>): Promise<void> {
  const previous = GEMINI_ENV_KEYS.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of GEMINI_ENV_KEYS) {
      if (!process.env[key]) process.env[key] = OFFLINE_ENV_VALUE;
      assertEnvPresent(key);
    }
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("anonymous external HTTPS image URL and caller-selected model return not found", async () => {
  await assertNotFound(
    jsonRequest(
      JSON.stringify({
        imageUrl: EXTERNAL_IMAGE_URL,
        baseImageUrl: EXTERNAL_IMAGE_URL,
        workingImageUrl: EXTERNAL_IMAGE_URL,
        url: EXTERNAL_IMAGE_URL,
        imagePath: EXTERNAL_IMAGE_URL,
        modelVersion: "gemini-2.5-pro",
        mode: "geometry",
        purpose: "containment-probe",
      }),
    ),
  );
});

test("base64 data URL returns not found", async () => {
  await assertNotFound(
    jsonRequest(
      JSON.stringify({
        imageUrl: DATA_IMAGE_URL,
        modelVersion: "gemini-2.5-pro",
      }),
    ),
  );
});

test("loopback and link-local image URLs return not found", async () => {
  for (const imageUrl of LOOPBACK_AND_LINK_LOCAL_URLS) {
    await assertNotFound(
      jsonRequest(
        JSON.stringify({
          imageUrl,
          modelVersion: "gemini-2.5-pro",
        }),
      ),
    );
  }
});

test("authenticated-looking bearer token and cookies return not found", async () => {
  await assertNotFound(
    jsonRequest(JSON.stringify({ imageUrl: EXTERNAL_IMAGE_URL, modelVersion: "gemini-2.5-pro" }), {
      "content-type": "application/json",
      authorization: "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJzZWMyMGItb2ZmbGluZSJ9.sec20b-offline",
      cookie: "sb-access-token=sec20b-offline-access; sb-refresh-token=sec20b-offline-refresh",
    }),
  );
});

test("empty JSON, invalid body, and absent body return not found", async () => {
  await assertNotFound(jsonRequest("{}"));
  await assertNotFound(jsonRequest("{"));
  await assertNotFound(jsonRequest("not-json"));
  await assertNotFound(jsonRequest(""));
  await assertNotFound(new Request(ROUTE_URL, { method: "POST" }));
});

test("Gemini API key environment variables still return not found", async () => {
  await withGeminiEnvPresent(async () => {
    await assertNotFound(
      jsonRequest(
        JSON.stringify({
          imageUrl: EXTERNAL_IMAGE_URL,
          modelVersion: "gemini-2.5-pro",
          mode: "geometry",
        }),
      ),
    );
  });
});

test("room-read drops Gemini references while the helper and existing callers stay unchanged", async () => {
  const route = source(ROUTE_PATH);
  assert.equal(
    route,
    [
      'import { NextResponse } from "next/server";',
      "",
      'export const runtime = "nodejs";',
      "",
      "export async function POST() {",
      '  return NextResponse.json({ error: "Not found." }, { status: 404 });',
      "}",
      "",
    ].join("\n"),
  );
  assert.match(route, /export async function POST\(\)/);
  assert.match(route, /NextResponse\.json\(\{ error: "Not found\." \}, \{ status: 404 \}\)/);
  assert.doesNotMatch(route, /runGeminiRoomReadFromImageUrl/);
  assert.doesNotMatch(route, /vibodeGeminiRoomRead/);
  assert.doesNotMatch(route, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(route, /generateContent/);
  assert.doesNotMatch(route, /GEMINI_API_KEY|GOOGLE_API_KEY/);
  assert.doesNotMatch(route, /gemini/i);
  assert.doesNotMatch(route, /process\.env|\bfetch\s*\(|req\.json|request\.json|headers|cookies|authorization|console\./);

  const { POST, runtime } = await loadRoute();
  assert.equal(runtime, "nodejs");
  assert.equal(POST.length, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(POST.toString().includes(HELPER_SYMBOL), false);
  assert.equal(POST.toString().includes("fetch"), false);

  const helper = source(HELPER_PATH);
  assertUnchanged(HELPER_PATH);
  assert.match(helper, /export async function runGeminiRoomReadFromImageUrl/);
  assert.match(helper, /generativelanguage\.googleapis\.com/);

  const objectsRoute = source(OBJECTS_ROUTE_PATH);
  assertUnchanged(OBJECTS_ROUTE_PATH);
  assert.match(
    objectsRoute,
    /import \{ runGeminiRoomReadFromImageUrl \} from "@\/lib\/vibodeGeminiRoomRead"/,
  );
  assert.match(objectsRoute, /await runGeminiRoomReadFromImageUrl\(/);

  const references: string[] = [];
  collectHelperReferences(ROOT, references);
  references.sort();
  assert.equal(references.includes(ROUTE_PATH), false);
  assert.equal(references.includes(HELPER_PATH), true);
  assert.equal(references.includes(OBJECTS_ROUTE_PATH), true);
  assert.equal(references.includes(ROUTE_TEST_PATH), true);
  for (const reference of references) {
    if (reference === ROUTE_TEST_PATH) continue;
    assertUnchanged(reference);
  }
});
