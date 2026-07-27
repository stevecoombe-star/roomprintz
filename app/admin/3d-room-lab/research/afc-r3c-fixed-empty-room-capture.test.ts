/**
 * AFC-R3C fixed Empty-Room capture matrix. Provider and network paths are
 * injected; the global trap makes accidental live requests fail immediately.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION,
  AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_RECEIPT_VERSION,
  captureAfcR3cFixedEmptyRoom,
  parseAfcR3cFixedEmptyRoomCaptureRequest,
  type AfcR3cFixedEmptyRoomCaptureDependencies,
} from "./afc-r3c-fixed-empty-room-capture";
import {
  EMPTY_ROOM_ASSIST_GENERATOR_ID,
  EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID,
  sanitizeEmptyRoomAppliedAspectRatio,
  type EmptyRoomImageBytes,
} from "@/lib/vibodeEmptyRoomAssist";
import type { SafeImageResult } from "@/lib/vibodeAutoFloorImageFetch";
import { writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL5WQAAAABJRU5ErkJggg==",
  "base64"
);
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const originalFetch = globalThis.fetch;

globalThis.fetch = async () => {
  throw new Error("Fixed capture tests block un-injected network requests.");
};
test.after(() => {
  globalThis.fetch = originalFetch;
});

async function withTemp<T>(fn: (args: { root: string; repo: string; out: string; original: string }) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "afc-r3c-fixed-capture-"));
  const repo = path.join(root, "repo");
  const out = path.join(root, "outside-output");
  const original = path.join(root, "original.png");
  try {
    await mkdir(repo);
    await writeFile(original, PIXEL);
    return await fn({ root, repo, out, original });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function request(args: { original: string; out: string; requestId?: string; overrides?: Record<string, unknown> }) {
  return {
    contractVersion: AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION,
    roomId: "room-fixture",
    requestId: args.requestId ?? "capture-1",
    originalFilePath: args.original,
    originalImageUrl: "https://images.example.test/original.png",
    expectedOriginalSha256: sha(PIXEL),
    outputDir: args.out,
    executeCapture: true,
    ...args.overrides,
  };
}

function emptyImage(overrides: Partial<EmptyRoomImageBytes> = {}): EmptyRoomImageBytes {
  return {
    base64: PIXEL.toString("base64"),
    mime: "image/png",
    byteCount: PIXEL.byteLength,
    provenance: {
      generatorId: EMPTY_ROOM_ASSIST_GENERATOR_ID,
      requestedModelId: EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID,
      resolvedModelId: null,
      resolvedModelStatus: "not_reported_by_compositor",
      appliedAspectRatio: "auto",
      imageTransport: "data_url",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function fetched(bytes = PIXEL): SafeImageResult {
  return {
    ok: true,
    base64: bytes.toString("base64"),
    buffer: bytes,
    mime: "image/png",
    byteCount: bytes.byteLength,
    host: "images.example.test",
  };
}

function dependencies(args: {
  repo: string;
  cached?: EmptyRoomImageBytes | null;
  generate?: AfcR3cFixedEmptyRoomCaptureDependencies["getOrGenerateEmptyRoomImage"];
  fetchOriginal?: AfcR3cFixedEmptyRoomCaptureDependencies["fetchOriginalImage"];
}): AfcR3cFixedEmptyRoomCaptureDependencies {
  return {
    repositoryRoot: args.repo,
    getCachedEmptyRoomImage: () => args.cached ?? null,
    getOrGenerateEmptyRoomImage: args.generate,
    fetchOriginalImage: args.fetchOriginal,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function assertNoReservationOrTemp(outputDir: string): Promise<void> {
  const entries = await readdir(outputDir);
  assert.equal(entries.some((name) => name.endsWith(".reservation")), false);
  assert.equal(entries.some((name) => name.includes(".tmp")), false);
}

test("A closed request parsing accepts only the fixed v1 shape", async () => withTemp(async ({ original, out }) => {
  assert.equal(parseAfcR3cFixedEmptyRoomCaptureRequest(request({ original, out })).ok, true);
  const rows: Array<[string, Record<string, unknown>]> = [
    ["unknown", { unknown: true }],
    ["version", { contractVersion: "bad" }],
    ["unsafe room", { roomId: "../room" }],
    ["unsafe request", { requestId: "../request" }],
    ["upper SHA", { expectedOriginalSha256: "A".repeat(64) }],
    ["relative original", { originalFilePath: "original.png" }],
    ["relative output", { outputDir: "out" }],
    ["non boolean generation", { executeEmptyRoomGeneration: "true" }],
  ];
  for (const [label, overrides] of rows) {
    assert.equal(parseAfcR3cFixedEmptyRoomCaptureRequest(request({ original, out, overrides })).ok, false, label);
  }
}));

test("B only primitive true authorizes capture before cache, generation, or writes", async () => withTemp(async ({ original, out, repo }) => {
  const values: unknown[] = [undefined, false, "true", 1, {}, [], new Boolean(true)];
  for (const value of values) {
    let cacheCalls = 0;
    let generationCalls = 0;
    const raw = request({ original, out: `${out}-${String(value)}`, overrides: { executeCapture: value } });
    const result = await captureAfcR3cFixedEmptyRoom(raw, {
      repositoryRoot: repo,
      getCachedEmptyRoomImage: () => {
        cacheCalls += 1;
        return null;
      },
      getOrGenerateEmptyRoomImage: async () => {
        generationCalls += 1;
        throw new Error("must not generate");
      },
    });
    assert.equal(result.status, "failure");
    assert.equal(result.status === "failure" && result.failureCode, "capture_not_authorized");
    assert.equal(cacheCalls, 0);
    assert.equal(generationCalls, 0);
    await assert.rejects(stat(`${out}-${String(value)}`), /ENOENT/);
  }
}));

test("C cache miss accepts only primitive true for generation and writes nothing otherwise", async () => withTemp(async ({ original, out, repo }) => {
  const values: unknown[] = [undefined, false, "true", 1, {}, [], new Boolean(true)];
  for (let index = 0; index < values.length; index += 1) {
    let generationCalls = 0;
    const target = `${out}-${index}`;
    const result = await captureAfcR3cFixedEmptyRoom(
      request({ original, out: target, overrides: { ...(values[index] === undefined ? {} : { executeEmptyRoomGeneration: values[index] }) } }),
      {
        repositoryRoot: repo,
        getCachedEmptyRoomImage: () => null,
        getOrGenerateEmptyRoomImage: async () => {
          generationCalls += 1;
          throw new Error("must not generate");
        },
      }
    );
    assert.equal(result.status === "cache_miss" || (result.status === "failure" && result.failureCode === "invalid_request"), true);
    assert.equal(generationCalls, 0);
    await assert.rejects(stat(target), /ENOENT/);
  }
}));

test("D exact Original verification rejects bad evidence and preserves exact output bytes", async () => withTemp(async ({ original, out, repo }) => {
  const badHash = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, overrides: { expectedOriginalSha256: "a".repeat(64) } }),
    dependencies({ repo, cached: emptyImage() })
  );
  assert.equal(badHash.status === "failure" && badHash.failureCode, "original_hash_mismatch");
  await writeFile(original, Buffer.from("not an image"));
  const badMime = await captureAfcR3cFixedEmptyRoom(request({ original, out }), dependencies({ repo, cached: emptyImage() }));
  assert.equal(badMime.status === "failure" && badMime.failureCode, "original_mime_unsupported");
  await writeFile(original, PIXEL);
  const oversized = await captureAfcR3cFixedEmptyRoom(
    request({ original, out }),
    { ...dependencies({ repo, cached: emptyImage() }), maxImageBytes: 1 }
  );
  assert.equal(oversized.status === "failure" && oversized.failureCode, "original_oversized");
  const sharp = (await import("sharp")).default;
  const rotated = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .jpeg()
    .withMetadata({ orientation: 2 })
    .toBuffer();
  await writeFile(original, rotated);
  const orientation = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, overrides: { expectedOriginalSha256: sha(rotated) } }),
    dependencies({ repo, cached: emptyImage() })
  );
  assert.equal(orientation.status === "failure" && orientation.failureCode, "original_orientation_unsupported");
  await writeFile(original, PIXEL);
  const exactAfterRestore = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "exact" }),
    dependencies({ repo, cached: emptyImage() })
  );
  assert.equal(exactAfterRestore.status, "captured");
  if (exactAfterRestore.status === "captured") assert.deepEqual(await readFile(exactAfterRestore.originalPath), PIXEL);
}));

test("E cache hit is URL-free, provider-free, byte-exact, and records provenance", async () => withTemp(async ({ original, out, repo }) => {
  let fetchCalls = 0;
  let generationCalls = 0;
  const result = await captureAfcR3cFixedEmptyRoom(
    request({ original, out }),
    dependencies({
      repo,
      cached: emptyImage(),
      fetchOriginal: async () => {
        fetchCalls += 1;
        return fetched();
      },
      generate: async () => {
        generationCalls += 1;
        throw new Error("must not generate");
      },
    })
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(result.captureSource, "cache_hit");
  assert.equal(result.emptyRoomGenerationCall, false);
  assert.equal(fetchCalls, 0);
  assert.equal(generationCalls, 0);
  assert.deepEqual(await readFile(result.emptyPath), PIXEL);
  const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
  assert.equal(receipt.receiptContractVersion, AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_RECEIPT_VERSION);
  assert.equal(receipt.generation.cacheStatus, "hit");
  assert.equal(receipt.generation.generatorId, EMPTY_ROOM_ASSIST_GENERATOR_ID);
  assert.equal(receipt.generation.requestedModelId, "NBP");
  assert.equal(receipt.generation.resolvedModelId, null);
  assert.equal(receipt.generation.resolvedModelStatus, "not_reported_by_compositor");
  assert.equal(receipt.generation.appliedAspectRatio, "auto");
  assert.equal(receipt.generation.imageTransport, "data_url");
  assert.equal(receipt.emptyRoomAssist.generatedFromOriginalSha256, sha(PIXEL));
  assert.equal(receipt.safety.emptyRoomGenerationCall, false);
  assert.equal(receipt.safety.geminiFloorProposalCall, false);
  assert.equal(receipt.safety.persisted, false);
}));

test("F cache-only miss creates no output, files, receipt, fetch, or generation", async () => withTemp(async ({ original, out, repo }) => {
  let fetchCalls = 0;
  let generationCalls = 0;
  const result = await captureAfcR3cFixedEmptyRoom(
    request({ original, out }),
    dependencies({
      repo,
      fetchOriginal: async () => {
        fetchCalls += 1;
        return fetched();
      },
      generate: async () => {
        generationCalls += 1;
        throw new Error("must not generate");
      },
    })
  );
  assert.equal(result.status, "cache_miss");
  assert.equal(fetchCalls, 0);
  assert.equal(generationCalls, 0);
  await assert.rejects(stat(out), /ENOENT/);
}));

test("G generation fallback preflights and binds URL evidence before exactly one injected generation", async () => withTemp(async ({ original, out, repo }) => {
  let calls = 0;
  const unsafe = await captureAfcR3cFixedEmptyRoom(
    request({ original, out: path.join(repo, "public"), overrides: { executeEmptyRoomGeneration: true } }),
    dependencies({
      repo,
      fetchOriginal: async () => fetched(),
      generate: async () => {
        calls += 1;
        return { ok: true, cacheStatus: "miss", image: emptyImage() };
      },
    })
  );
  assert.equal(unsafe.status === "failure" && unsafe.failureCode, "output_preflight_failed");
  assert.equal(calls, 0);
  const sharp = (await import("sharp")).default;
  const alternate = await sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const mismatch = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "mismatch", overrides: { executeEmptyRoomGeneration: true } }),
    dependencies({
      repo,
      fetchOriginal: async () => fetched(Buffer.from(alternate)),
      generate: async () => {
        calls += 1;
        return { ok: true, cacheStatus: "miss", image: emptyImage() };
      },
    })
  );
  assert.equal(mismatch.status === "failure" && mismatch.failureCode, "original_url_evidence_mismatch");
  assert.equal(calls, 0);
  let fetchCalls = 0;
  const success = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "generated", overrides: { executeEmptyRoomGeneration: true } }),
    dependencies({
      repo,
      fetchOriginal: async () => {
        fetchCalls += 1;
        return fetched();
      },
      generate: async () => {
        calls += 1;
        return { ok: true, cacheStatus: "miss", image: emptyImage() };
      },
    })
  );
  assert.equal(success.status, "captured");
  assert.equal(calls, 1);
  assert.equal(fetchCalls, 1);
  if (success.status === "captured") {
    assert.equal(success.captureSource, "generated");
    assert.equal(success.emptyRoomGenerationCall, true);
    assert.equal(JSON.parse(await readFile(success.receiptPath, "utf8")).generation.cacheStatus, "miss");
  }
}));

test("H Empty-byte admission rejects malformed, mismatched, and unsupported cache values", async () => withTemp(async ({ original, out, repo }) => {
  const rows: Array<[string, EmptyRoomImageBytes, string]> = [
    ["base64", emptyImage({ base64: "%%%" }), "empty_base64_invalid"],
    ["byte count", emptyImage({ byteCount: 1 }), "empty_byte_count_mismatch"],
    ["MIME", emptyImage({ mime: "image/jpeg" }), "empty_mime_mismatch"],
    ["provenance", emptyImage({ provenance: { ...emptyImage().provenance, resolvedModelId: "claimed" } as never }), "empty_provenance_invalid"],
  ];
  for (const [label, image, code] of rows) {
    const result = await captureAfcR3cFixedEmptyRoom(
      request({ original, out: `${out}-${label}`, requestId: `empty-${label.replaceAll(" ", "-")}` }),
      dependencies({ repo, cached: image })
    );
    assert.equal(result.status === "failure" && result.failureCode, code);
  }
}));

test("I immutable image reuse, request-ID reuse, conflict rejection, and cleanup", async () => withTemp(async ({ original, out, repo }) => {
  const first = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "immutable-first" }),
    dependencies({ repo, cached: emptyImage() })
  );
  assert.equal(first.status, "captured");
  if (first.status !== "captured") return;
  const receiptBefore = await readFile(first.receiptPath, "utf8");
  const replay = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "immutable-first" }),
    dependencies({ repo, cached: emptyImage() })
  );
  assert.equal(replay.status === "failure" && replay.failureCode, "request_id_reused");
  assert.equal(await readFile(first.receiptPath, "utf8"), receiptBefore);
  const conflictName = `room-fixture.empty-room.${sha(PIXEL)}.png`;
  await writeFile(path.join(out, conflictName), Buffer.from("conflicting bytes"));
  const conflict = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "conflict" }),
    dependencies({ repo, cached: emptyImage() })
  );
  assert.equal(conflict.status === "failure" && conflict.failureCode, "capture_write_failed");
  const files = await readdir(out);
  assert.equal(files.some((name) => name.includes(".tmp")), false);
}));

test("J authorized generation failure creates one sanitized immutable failure receipt", async () => withTemp(async ({ original, out, repo }) => {
  const result = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "failure-evidence", overrides: { executeEmptyRoomGeneration: true } }),
    dependencies({
      repo,
      fetchOriginal: async () => fetched(),
      generate: async () => ({ ok: false, cacheStatus: "miss", stage: "generate", reason: "raw upstream secret response" }),
    })
  );
  assert.equal(result.status, "failure");
  if (result.status !== "failure") return;
  assert.equal(result.failureCode, "empty_generation_failed");
  assert.equal(result.emptyRoomGenerationCall, true);
  assert.equal(result.captureWritten, false);
  assert.ok(result.receiptPath);
  const text = await readFile(result.receiptPath!, "utf8");
  assert.equal(text.includes(PIXEL.toString("base64")), false);
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("raw upstream"), false);
  assert.equal(JSON.parse(text).generationAttempt.compositorCallOccurred, true);
  await assertNoReservationOrTemp(out);
}));

test("K reservations single-flight same-ID generation and release after settlement", async () => withTemp(async ({ original, out, repo }) => {
  const generationEntered = deferred<void>();
  const releaseGeneration = deferred<void>();
  let fetchCalls = 0;
  let generationCalls = 0;
  const deps = dependencies({
    repo,
    fetchOriginal: async () => {
      fetchCalls += 1;
      return fetched();
    },
    generate: async () => {
      generationCalls += 1;
      generationEntered.resolve();
      await releaseGeneration.promise;
      return { ok: true, cacheStatus: "miss", image: emptyImage() };
    },
  });
  const first = captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "same-generation", overrides: { executeEmptyRoomGeneration: true } }),
    deps
  );
  await generationEntered.promise;
  const second = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId: "same-generation", overrides: { executeEmptyRoomGeneration: true } }),
    deps
  );
  assert.equal(second.status === "failure" && second.failureCode, "request_id_in_progress");
  assert.equal(fetchCalls, 1);
  assert.equal(generationCalls, 1);
  releaseGeneration.resolve();
  const firstResult = await first;
  assert.equal(firstResult.status, "captured");
  assert.equal(fetchCalls, 1);
  assert.equal(generationCalls, 1);
  await assertNoReservationOrTemp(out);
}));

test("L same-ID cache hit preserves receipt-referenced images through a receipt race", async () => withTemp(async ({ original, out, repo }) => {
  const receiptEntered = deferred<void>();
  const releaseReceipt = deferred<void>();
  let receiptWaited = false;
  const writer: AfcR3cFixedEmptyRoomCaptureDependencies["captureWriter"] = async (args) => {
    if (!receiptWaited && args.filename.endsWith(".receipt.json")) {
      receiptWaited = true;
      receiptEntered.resolve();
      await releaseReceipt.promise;
    }
    return writeAfcR3cImmutableCapture(args);
  };
  const deps = { ...dependencies({ repo, cached: emptyImage() }), captureWriter: writer };
  const first = captureAfcR3cFixedEmptyRoom(request({ original, out, requestId: "same-cache" }), deps);
  await receiptEntered.promise;
  const second = await captureAfcR3cFixedEmptyRoom(request({ original, out, requestId: "same-cache" }), deps);
  assert.equal(second.status === "failure" && second.failureCode, "request_id_in_progress");
  releaseReceipt.resolve();
  const winner = await first;
  assert.equal(winner.status, "captured");
  if (winner.status !== "captured") return;
  assert.deepEqual(await readFile(winner.originalPath), PIXEL);
  assert.deepEqual(await readFile(winner.emptyPath), PIXEL);
  const receipt = JSON.parse(await readFile(winner.receiptPath, "utf8"));
  assert.equal(receipt.original.capturedFilePath, winner.originalPath);
  assert.equal(receipt.emptyRoomAssist.capturedFilePath, winner.emptyPath);
  await assertNoReservationOrTemp(out);
}));

test("M different request IDs concurrently reuse digest images without overwrite", async () => withTemp(async ({ original, out, repo }) => {
  const deps = dependencies({ repo, cached: emptyImage() });
  const [one, two] = await Promise.all([
    captureAfcR3cFixedEmptyRoom(request({ original, out, requestId: "different-one" }), deps),
    captureAfcR3cFixedEmptyRoom(request({ original, out, requestId: "different-two" }), deps),
  ]);
  assert.equal(one.status, "captured");
  assert.equal(two.status, "captured");
  if (one.status !== "captured" || two.status !== "captured") return;
  assert.equal(one.originalPath, two.originalPath);
  assert.equal(one.emptyPath, two.emptyPath);
  assert.notEqual(one.receiptPath, two.receiptPath);
  assert.deepEqual(await readFile(one.originalPath), PIXEL);
  assert.deepEqual(await readFile(one.emptyPath), PIXEL);
  await assertNoReservationOrTemp(out);
}));

test("N cache hit takes precedence over a primitive-true generation acknowledgement", async () => withTemp(async ({ original, out, repo }) => {
  let fetchCalls = 0;
  let generationCalls = 0;
  const result = await captureAfcR3cFixedEmptyRoom(
    request({ original, out, overrides: { executeEmptyRoomGeneration: true } }),
    dependencies({
      repo,
      cached: emptyImage(),
      fetchOriginal: async () => {
        fetchCalls += 1;
        return fetched();
      },
      generate: async () => {
        generationCalls += 1;
        return { ok: true, cacheStatus: "miss", image: emptyImage() };
      },
    })
  );
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  assert.equal(result.captureSource, "cache_hit");
  assert.equal(result.emptyRoomGenerationCall, false);
  assert.equal(fetchCalls, 0);
  assert.equal(generationCalls, 0);
  assert.equal(JSON.parse(await readFile(result.receiptPath, "utf8")).safety.emptyRoomGenerationCall, false);
}));

test("O provenance sanitization and canonical timestamps fail closed", async () => withTemp(async ({ original, out, repo }) => {
  assert.equal(sanitizeEmptyRoomAppliedAspectRatio(" 16:9 "), "16:9");
  assert.equal(sanitizeEmptyRoomAppliedAspectRatio("unsafe value with spaces"), null);
  assert.equal(sanitizeEmptyRoomAppliedAspectRatio("x".repeat(33)), null);
  const invalidRows: Array<[string, EmptyRoomImageBytes]> = [
    ["aspect", emptyImage({ provenance: { ...emptyImage().provenance, appliedAspectRatio: "unsafe aspect" } as never })],
    ["timestamp", emptyImage({ provenance: { ...emptyImage().provenance, generatedAt: "2026-01-01T00:00:00Z" } as never })],
  ];
  for (const [label, image] of invalidRows) {
    const target = `${out}-${label}`;
    const result = await captureAfcR3cFixedEmptyRoom(
      request({ original, out: target, requestId: `provenance-${label}` }),
      dependencies({ repo, cached: image })
    );
    assert.equal(result.status === "failure" && result.failureCode, "empty_provenance_invalid");
    await assertNoReservationOrTemp(target);
  }
}));

test("P handled failures release reservations and retain admitted digest artifacts", async () => withTemp(async ({ original, out, repo }) => {
  const run = async (
    requestId: string,
    overrides: AfcR3cFixedEmptyRoomCaptureDependencies,
    executeGeneration = false
  ) => captureAfcR3cFixedEmptyRoom(
    request({ original, out, requestId, overrides: executeGeneration ? { executeEmptyRoomGeneration: true } : {} }),
    overrides
  );

  const urlFailure = await run("url-failure", {
    ...dependencies({ repo, fetchOriginal: async () => ({ ok: false, reason: "blocked" }), generate: async () => { throw new Error("unreachable"); } }),
  }, true);
  assert.equal(urlFailure.status === "failure" && urlFailure.failureCode, "original_url_evidence_failed");
  await assertNoReservationOrTemp(out);

  const configFailure = await run("config-failure", dependencies({
    repo,
    fetchOriginal: async () => fetched(),
    generate: async () => ({ ok: false, cacheStatus: "unavailable", stage: "config", reason: "sanitized" }),
  }), true);
  assert.equal(configFailure.status === "failure" && configFailure.captureWritten, false);
  await assertNoReservationOrTemp(out);

  const admissionFailure = await run("admission-failure", dependencies({
    repo,
    fetchOriginal: async () => fetched(),
    generate: async () => ({ ok: true, cacheStatus: "miss", image: emptyImage({ base64: "%%%" }) }),
  }), true);
  assert.equal(admissionFailure.status === "failure" && admissionFailure.captureWritten, false);
  await assertNoReservationOrTemp(out);

  const originalWriteFailure = await run("original-write-failure", {
    ...dependencies({ repo, cached: emptyImage() }),
    captureWriter: async () => ({ ok: false, reason: "injected" }),
  });
  assert.equal(originalWriteFailure.status === "failure" && originalWriteFailure.captureWritten, false);
  await assertNoReservationOrTemp(out);

  const emptyWriteFailure = await run("empty-write-failure", {
    ...dependencies({ repo, cached: emptyImage() }),
    captureWriter: async (args) => {
      if (args.filename.includes(".empty-room.")) return { ok: false, reason: "injected" };
      return writeAfcR3cImmutableCapture(args);
    },
  });
  assert.equal(emptyWriteFailure.status === "failure" && emptyWriteFailure.captureWritten, false);
  assert.equal((await readdir(out)).some((name) => name.includes(".original.")), true);
  await assertNoReservationOrTemp(out);

  let imageWrites = 0;
  const lateReceiptFailure = await run("late-receipt-failure", {
    ...dependencies({ repo, cached: emptyImage() }),
    captureWriter: async (args) => {
      imageWrites += 1;
      if (args.filename.endsWith(".receipt.json")) return { ok: false, reason: "injected" };
      return writeAfcR3cImmutableCapture(args);
    },
  });
  assert.equal(lateReceiptFailure.status === "failure" && lateReceiptFailure.captureWritten, false);
  assert.equal(imageWrites, 3);
  const files = await readdir(out);
  assert.equal(files.some((name) => name.includes(".original.")), true);
  assert.equal(files.some((name) => name.includes(".empty-room.")), true);
  await assertNoReservationOrTemp(out);
}));

test("Q containment imports only the narrow Empty-Room generation helper", async () => {
  const source = await readFile(new URL("./afc-r3c-fixed-empty-room-capture.ts", import.meta.url), "utf8");
  const routeSource = await readFile(
    new URL("../../../api/admin/3d-room-lab/afc-r3c/fixed-empty-room-capture/route.ts", import.meta.url),
    "utf8"
  );
  for (const forbidden of [
    "ThreeRoomLab",
    "scene-state",
    "Apply",
    "active-camera",
    "supabase",
    "vibode_room_assets",
    "vibodeGeminiUsageAccounting",
    "gemini-floor-proposal-provider",
    "gemini-floor-proposal-runner",
    "candidate-discrimination",
    "app/api/admin/3d-room-lab/empty-room-assist/run",
    "upload",
  ]) {
    assert.equal(new RegExp(`^import[^;]*${forbidden}`, "m").test(source), false, forbidden);
    assert.equal(new RegExp(`^import[^;]*${forbidden}`, "m").test(routeSource), false, `route ${forbidden}`);
  }
  assert.equal(source.includes("getOrGenerateEmptyRoomImage"), true);
});
