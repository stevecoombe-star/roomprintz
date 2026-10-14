import { createHash } from "node:crypto";

import { assessHarmonizeJobOutput } from "./output";
import {
  VIBODE_HARMONIZE_BUCKET,
  VIBODE_HISTORY_BUCKET,
  harmonizeHistoryBackoffMs,
  harmonizeHistoryObjectPath,
} from "./policy";
import type { HarmonizeJobRow, HarmonizeJobStatus } from "./types";

export type HarmonizeHistoryState = "pending" | "published" | "unavailable";

export type HarmonizePublicationJob = Readonly<{
  id: string;
  userId: string;
  roomId: string;
  status: HarmonizeJobStatus;
  historyState: HarmonizeHistoryState;
  outputBucket: string | null;
  outputPath: string | null;
  outputSha256: string | null;
  outputMime: string | null;
  outputWidth: number | null;
  outputHeight: number | null;
  compositeWidth: number;
  compositeHeight: number;
  backdropKind: string | null;
  sceneObjects: unknown;
  outputAssetId: string | null;
}>;

export type HarmonizeHistoryStorage = Readonly<{
  download: (bucket: string, path: string) => Promise<Uint8Array | null>;
  putIfAbsent: (
    bucket: string,
    path: string,
    bytes: Uint8Array,
  ) => Promise<
    | Readonly<{ ok: true; created: boolean }>
    | Readonly<{ ok: false; code: "exists" | "unavailable" }>
  >;
}>;

export type HarmonizeHistoryPublishArgs = Readonly<{
  jobId: string;
  outputSha256: string;
  historyBucket: string;
  historyPath: string;
}>;

export type HarmonizeHistoryPublishResult =
  | Readonly<{
      ok: true;
      code: "published" | "already_published";
      assetId: string | null;
      generationRunId: string | null;
      activated: boolean;
    }>
  | Readonly<{ ok: false; code: string }>;

export type HarmonizeHistoryThumbnail = (input: Readonly<{
  jobId: string;
  roomId: string;
  userId: string;
  assetId: string;
  historyBucket: string;
  historyPath: string;
}>) => Promise<"created" | "present" | "failed">;

export type HarmonizeHistoryThumbnailState = "created" | "present" | "failed" | "skipped";

export type HarmonizeHistoryDisposition = "complete" | "retryable" | "terminal";

export type HarmonizeHistoryPublicationResult = Readonly<{
  outcome: "published" | "already_published" | "pending" | "terminal" | "ignored";
  code: string;
  assetId: string | null;
  generationRunId: string | null;
  activated: boolean;
  thumbnail: HarmonizeHistoryThumbnailState;
  disposition: HarmonizeHistoryDisposition;
}>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const BACKDROP_KINDS = new Set(["afc_empty", "afc_original", "room_asset"]);

export function publicationJobFromRow(job: HarmonizeJobRow): HarmonizePublicationJob {
  return {
    id: job.id,
    userId: job.userId,
    roomId: job.roomId,
    status: job.status,
    historyState: job.historyState,
    outputBucket: job.outputBucket,
    outputPath: job.outputPath,
    outputSha256: job.outputSha256,
    outputMime: job.outputMime,
    outputWidth: job.outputWidth,
    outputHeight: job.outputHeight,
    compositeWidth: job.compositeWidth,
    compositeHeight: job.compositeHeight,
    backdropKind: job.backdropKind,
    sceneObjects: job.sceneObjects,
    outputAssetId: job.outputAssetId,
  };
}

/**
 * One explicit recovery of one already-loaded job.
 * Transient storage and thumbnail failures retry with backoff.
 * Permanent publication codes stop this call. Nothing here contacts a provider
 * or selects another job.
 */
export async function recoverHarmonizeHistoryPublication(input: Readonly<{
  job: HarmonizePublicationJob | null;
  publish: (job: HarmonizePublicationJob) => Promise<HarmonizeHistoryPublicationResult>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}>): Promise<HarmonizeHistoryPublicationResult> {
  if (!input.job) return result("ignored", "not_found", "terminal");
  if (input.job.historyState === "unavailable") return result("ignored", "not_publishable", "terminal");
  if (input.job.status !== "succeeded") return result("ignored", "not_succeeded", "terminal");
  const attempts = input.sleep
    ? Math.max(1, input.maxAttempts ?? 3)
    : 1;
  let last = result("pending", "publication_failed", "retryable");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await input.publish(input.job);
    const retryThumbnail = last.thumbnail === "failed"
      && (last.outcome === "published" || last.outcome === "already_published");
    const retry = last.disposition === "retryable" || retryThumbnail;
    if (!retry || attempt === attempts - 1) return last;
    await input.sleep?.(harmonizeHistoryBackoffMs(attempt));
  }
  return last;
}

/**
 * Verify one succeeded job's private JPEG, copy it to the deterministic
 * History path, then call the publication RPC. The RPC owns the database
 * transaction. A later thumbnail failure does not undo that transaction.
 */
export async function publishPreparedHarmonizeHistory(input: Readonly<{
  job: HarmonizePublicationJob;
  storage: HarmonizeHistoryStorage;
  publish: (args: HarmonizeHistoryPublishArgs) => Promise<HarmonizeHistoryPublishResult> | HarmonizeHistoryPublishResult;
  thumbnail?: HarmonizeHistoryThumbnail;
}>): Promise<HarmonizeHistoryPublicationResult> {
  const job = input.job;
  if (job.historyState === "unavailable") return result("ignored", "not_publishable", "terminal");
  if (job.status !== "succeeded") return result("ignored", "not_succeeded", "terminal");
  const historyPath = harmonizeHistoryObjectPath(job.roomId, job.id);
  if (job.historyState === "published") {
    const published = await callPublisher(input.publish, {
      jobId: job.id,
      outputSha256: SHA256_HEX.test(job.outputSha256 ?? "") ? job.outputSha256 ?? "" : "0".repeat(64),
      historyBucket: VIBODE_HISTORY_BUCKET,
      historyPath,
    });
    if (!published.ok) return mapRpcFailure(published.code);
    return finishCommitted(input.thumbnail, job, historyPath, published);
  }
  if (missingCapture(job)) {
    const retired = await callPublisher(input.publish, {
      jobId: job.id,
      outputSha256: SHA256_HEX.test(job.outputSha256 ?? "") ? job.outputSha256 ?? "" : "0".repeat(64),
      historyBucket: VIBODE_HISTORY_BUCKET,
      historyPath,
    });
    if (!retired.ok) return mapRpcFailure(retired.code);
    return finishCommitted(input.thumbnail, job, historyPath, retired);
  }
  if (!trustedOutputIdentity(job, historyPath)) {
    return result("terminal", "unexpected_output", "terminal");
  }
  const source = await readObject(input.storage, job.outputBucket ?? "", job.outputPath ?? "");
  if (!source.ok || !source.bytes) return result("pending", "output_unreadable", "retryable");
  const verified = await verifyProviderJpeg(source.bytes, job);
  if (!verified.ok) return result("terminal", verified.code, "terminal");
  const placed = await placeHistoryObject(input.storage, historyPath, source.bytes, verified.sha256);
  if (!placed.ok) {
    return result(
      placed.disposition === "retryable" ? "pending" : "terminal",
      placed.code,
      placed.disposition,
    );
  }
  const committed = await callPublisher(input.publish, {
    jobId: job.id,
    outputSha256: verified.sha256,
    historyBucket: VIBODE_HISTORY_BUCKET,
    historyPath,
  });
  if (!committed.ok) return mapRpcFailure(committed.code);
  return finishCommitted(input.thumbnail, job, historyPath, committed);
}

export function createHarmonizeHistoryObjectStore(): HarmonizeHistoryStorage & Readonly<{
  seed: (bucket: string, path: string, bytes: Uint8Array) => void;
  has: (bucket: string, path: string) => boolean;
}> {
  const objects = new Map<string, Uint8Array>();
  let chain: Promise<void> = Promise.resolve();
  const key = (bucket: string, path: string) => `${bucket}\n${path}`;
  return {
    async download(bucket, path) {
      const bytes = objects.get(key(bucket, path));
      return bytes ? bytes.slice() : null;
    },
    async putIfAbsent(bucket, path, bytes) {
      const run = chain.then(() => {
        const id = key(bucket, path);
        if (objects.has(id)) return { ok: false as const, code: "exists" as const };
        objects.set(id, bytes.slice());
        return { ok: true as const, created: true };
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    seed(bucket, path, bytes) {
      objects.set(key(bucket, path), bytes.slice());
    },
    has(bucket, path) {
      return objects.has(key(bucket, path));
    },
  };
}

function missingCapture(job: HarmonizePublicationJob): boolean {
  return !SHA256_HEX.test(job.outputSha256 ?? "")
    || !job.outputPath
    || !job.outputBucket
    || job.outputMime !== "image/jpeg"
    || job.outputWidth == null
    || job.outputHeight == null
    || !BACKDROP_KINDS.has(job.backdropKind ?? "")
    || !Array.isArray(job.sceneObjects)
    || job.sceneObjects.length > 32;
}

function trustedOutputIdentity(job: HarmonizePublicationJob, historyPath: string): boolean {
  return job.outputBucket === VIBODE_HARMONIZE_BUCKET
    && safeObjectPath(job.outputPath)
    && historyPath === `rooms/${job.roomId}/harmonize/${job.id}.jpg`
    && safeObjectPath(historyPath);
}

async function verifyProviderJpeg(
  bytes: Uint8Array,
  job: HarmonizePublicationJob,
): Promise<Readonly<{ ok: true; sha256: string }> | Readonly<{ ok: false; code: "output_mismatch" | "unexpected_output" }>> {
  const assessed = await assessHarmonizeJobOutput(bytes, job.compositeWidth, job.compositeHeight);
  if (!assessed.ok || assessed.mime !== "image/jpeg") return { ok: false, code: "unexpected_output" };
  if (assessed.width !== job.outputWidth || assessed.height !== job.outputHeight) {
    return { ok: false, code: "unexpected_output" };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== assessed.sha256 || sha256 !== job.outputSha256) return { ok: false, code: "output_mismatch" };
  return { ok: true, sha256 };
}

async function placeHistoryObject(
  storage: HarmonizeHistoryStorage,
  path: string,
  source: Uint8Array,
  sha256: string,
): Promise<
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "history_conflict" | "output_unreadable" | "unavailable"; disposition: "terminal" | "retryable" }>
> {
  const existing = await readObject(storage, VIBODE_HISTORY_BUCKET, path);
  if (!existing.ok) return { ok: false, code: existing.code, disposition: "retryable" };
  if (existing.bytes) return reuse(existing.bytes, source, sha256);
  let placed: Awaited<ReturnType<HarmonizeHistoryStorage["putIfAbsent"]>>;
  try {
    placed = await storage.putIfAbsent(VIBODE_HISTORY_BUCKET, path, source);
  } catch {
    return { ok: false, code: "unavailable", disposition: "retryable" };
  }
  if (!placed.ok && placed.code === "unavailable") return { ok: false, code: "unavailable", disposition: "retryable" };
  const written = await readObject(storage, VIBODE_HISTORY_BUCKET, path);
  if (!written.ok) return { ok: false, code: written.code, disposition: "retryable" };
  if (!written.bytes) return { ok: false, code: "output_unreadable", disposition: "retryable" };
  return reuse(written.bytes, source, sha256);
}

function reuse(
  stored: Uint8Array,
  source: Uint8Array,
  sha256: string,
): Readonly<{ ok: true }> | Readonly<{ ok: false; code: "history_conflict"; disposition: "terminal" }> {
  const storedSha = createHash("sha256").update(stored).digest("hex");
  if (storedSha !== sha256 || !sameBytes(stored, source)) {
    return { ok: false, code: "history_conflict", disposition: "terminal" };
  }
  return { ok: true };
}

async function finishCommitted(
  thumbnail: HarmonizeHistoryThumbnail | undefined,
  job: HarmonizePublicationJob,
  historyPath: string,
  published: Extract<HarmonizeHistoryPublishResult, { ok: true }>,
): Promise<HarmonizeHistoryPublicationResult> {
  const thumb = await createThumbnail(thumbnail, job, published.assetId, historyPath);
  return {
    outcome: published.code,
    code: published.code,
    assetId: published.assetId,
    generationRunId: published.generationRunId,
    activated: published.activated,
    thumbnail: thumb,
    disposition: "complete",
  };
}

async function createThumbnail(
  thumbnail: HarmonizeHistoryThumbnail | undefined,
  job: HarmonizePublicationJob,
  assetId: string | null,
  historyPath: string,
): Promise<HarmonizeHistoryThumbnailState> {
  if (!thumbnail || !assetId) return "skipped";
  try {
    return await thumbnail({
      jobId: job.id,
      roomId: job.roomId,
      userId: job.userId,
      assetId,
      historyBucket: VIBODE_HISTORY_BUCKET,
      historyPath,
    });
  } catch {
    return "failed";
  }
}

async function callPublisher(
  publish: (args: HarmonizeHistoryPublishArgs) => Promise<HarmonizeHistoryPublishResult> | HarmonizeHistoryPublishResult,
  args: HarmonizeHistoryPublishArgs,
): Promise<HarmonizeHistoryPublishResult> {
  try {
    return await publish(args);
  } catch {
    return { ok: false, code: "publication_failed" };
  }
}

function mapRpcFailure(code: string): HarmonizeHistoryPublicationResult {
  if (code === "unavailable" || code === "publication_failed") {
    return result("pending", code, "retryable");
  }
  return result("terminal", code, "terminal");
}

async function readObject(
  storage: HarmonizeHistoryStorage,
  bucket: string,
  path: string,
): Promise<
  | Readonly<{ ok: true; bytes: Uint8Array | null }>
  | Readonly<{ ok: false; code: "output_unreadable" }>
> {
  if (!bucket || !safeObjectPath(path)) return { ok: false, code: "output_unreadable" };
  try {
    return { ok: true, bytes: await storage.download(bucket, path) };
  } catch {
    return { ok: false, code: "output_unreadable" };
  }
}

function result(
  outcome: HarmonizeHistoryPublicationResult["outcome"],
  code: string,
  disposition: HarmonizeHistoryDisposition,
): HarmonizeHistoryPublicationResult {
  return {
    outcome,
    code,
    assetId: null,
    generationRunId: null,
    activated: false,
    thumbnail: "skipped",
    disposition,
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return Buffer.from(left).equals(Buffer.from(right));
}

function safeObjectPath(path: string | null): path is string {
  return Boolean(
    path
    && path.length <= 512
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.includes(".."),
  );
}
