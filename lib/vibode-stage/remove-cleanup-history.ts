import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { CLEANUP_HISTORY_LABEL } from "@/lib/vibode-stage/remove-cleanup-history-ui";
import type { CleanupJobRow } from "@/lib/vibode-stage/remove-cleanup-jobs/types";

export { CLEANUP_HISTORY_LABEL, CLEANUP_HISTORY_NOTE, isCleanupHistoryAsset } from "@/lib/vibode-stage/remove-cleanup-history-ui";

export const CLEANUP_HISTORY_BUCKET = "vibode-generations";

export type CleanupHistoryAspectTier = "exact_grid_compatible" | "aspect_compatible_rescaled";

export type CleanupHistoryAspect =
  | Readonly<{
      ok: true;
      tier: CleanupHistoryAspectTier;
      relativeAspectError: number;
    }>
  | Readonly<{ ok: false; reason: string }>;

export type CleanupHistoryAsset = Readonly<{
  id: string;
  jobId: string;
  roomId: string;
  userId: string;
  bucket: string;
  path: string;
  sha256: string;
  width: number;
  height: number;
  bytes: Uint8Array;
  isActive: false;
  label: typeof CLEANUP_HISTORY_LABEL;
  sourceAssetId: string | null;
  sourceAfcGenerationId: string;
  originalSha256: string;
  provider: string;
  model: string;
  aspectTier: CleanupHistoryAspectTier;
  relativeAspectError: number;
  acceptedAtMs: number;
  generationRunId: string;
}>;

export type CleanupHistoryLedger = {
  objects: Map<string, Uint8Array>;
  assets: CleanupHistoryAsset[];
  roomUpdates: number;
  failInserts: number;
  locks: Map<string, Promise<void>>;
};

export type CleanupHistoryAcceptResult =
  | Readonly<{
      ok: true;
      created: boolean;
      asset: CleanupHistoryAsset;
      activated: false;
    }>
  | Readonly<{
      ok: false;
      code:
        | "not_found"
        | "not_succeeded"
        | "discarded"
        | "candidate_missing"
        | "candidate_mismatch"
        | "undecodable"
        | "aspect_incompatible"
        | "unavailable";
    }>;

export function cleanupHistoryObjectPath(roomId: string, jobId: string): string {
  return `rooms/${roomId}/cleanup/${jobId}.jpg`;
}

export function createCleanupHistoryLedger(): CleanupHistoryLedger {
  return {
    objects: new Map(),
    assets: [],
    roomUpdates: 0,
    failInserts: 0,
    locks: new Map(),
  };
}

/** Existing AFC pair classifier. Dimension differences inside 1.5% stay admissible. */
export function classifyCleanupCandidateAspect(input: Readonly<{
  originalWidth: number;
  originalHeight: number;
  candidateWidth: number;
  candidateHeight: number;
  candidateOrientation?: number;
}>): CleanupHistoryAspect {
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "original",
      decodedWidth: input.originalWidth,
      decodedHeight: input.originalHeight,
      orientation: 1,
    },
    {
      fingerprint: "candidate",
      decodedWidth: input.candidateWidth,
      decodedHeight: input.candidateHeight,
      orientation: input.candidateOrientation ?? 1,
    },
  );
  if (compatibility.tier === "incompatible" || compatibility.relativeAspectErrorRaw == null) {
    return { ok: false, reason: compatibility.reason ?? "Input image aspect ratio diverges too far for transfer." };
  }
  return {
    ok: true,
    tier: compatibility.tier,
    relativeAspectError: compatibility.relativeAspectErrorRaw,
  };
}

/**
 * Publish one verified candidate. The stored JPEG bytes are copied, not rewritten.
 * This never updates a room, camera, scale, or active background.
 */
export async function acceptCleanupHistory(input: Readonly<{
  job: CleanupJobRow | null;
  bytes: Uint8Array | null;
  nowMs: number;
  ledger: CleanupHistoryLedger;
  sourceAssetId?: string | null;
  decode: (bytes: Uint8Array) => Promise<Readonly<{ width: number; height: number; orientation: number }> | null>;
  createId?: () => string;
}>): Promise<CleanupHistoryAcceptResult> {
  const job = input.job;
  if (!job) return { ok: false, code: "not_found" };
  return withHistoryLock(input.ledger, job.id, async () => {
    if (job.discardedAtMs != null || job.status === "cancelled") return { ok: false, code: "discarded" };
    if (job.status !== "succeeded" || !job.outputSha256 || !job.outputPath || !job.outputWidth || !job.outputHeight) {
      return { ok: false, code: "not_succeeded" };
    }
    if (!input.bytes || input.bytes.byteLength < 1) return { ok: false, code: "candidate_missing" };
    const sha256 = sha256Hex(input.bytes);
    if (sha256 !== job.outputSha256) return { ok: false, code: "candidate_mismatch" };
    const path = cleanupHistoryObjectPath(job.roomId, job.id);
    const existing = input.ledger.assets.find((asset) => asset.jobId === job.id) ?? null;
    if (job.historyAssetId || existing) {
      return reconcileAccepted(input, job, path, sha256, existing);
    }
    let decoded: Readonly<{ width: number; height: number; orientation: number }> | null = null;
    try {
      decoded = await input.decode(input.bytes);
    } catch {
      decoded = null;
    }
    if (!decoded || decoded.width !== job.outputWidth || decoded.height !== job.outputHeight) {
      return { ok: false, code: "undecodable" };
    }
    const aspect = classifyCleanupCandidateAspect({
      originalWidth: job.originalWidth,
      originalHeight: job.originalHeight,
      candidateWidth: decoded.width,
      candidateHeight: decoded.height,
      candidateOrientation: decoded.orientation,
    });
    if (!aspect.ok) return { ok: false, code: "aspect_incompatible" };
    const stored = input.ledger.objects.get(path);
    if (stored && sha256Hex(stored) !== sha256) return { ok: false, code: "candidate_mismatch" };
    if (!stored) input.ledger.objects.set(path, input.bytes.slice());
    if (input.ledger.failInserts > 0) {
      input.ledger.failInserts -= 1;
      return { ok: false, code: "unavailable" };
    }
    const createId = input.createId ?? (() => crypto.randomUUID());
    const asset: CleanupHistoryAsset = {
      id: createId(),
      jobId: job.id,
      roomId: job.roomId,
      userId: job.userId,
      bucket: CLEANUP_HISTORY_BUCKET,
      path,
      sha256,
      width: decoded.width,
      height: decoded.height,
      bytes: input.ledger.objects.get(path) ?? input.bytes,
      isActive: false,
      label: CLEANUP_HISTORY_LABEL,
      sourceAssetId: input.sourceAssetId ?? null,
      sourceAfcGenerationId: job.afcGenerationId,
      originalSha256: job.originalSha256,
      provider: job.provider,
      model: job.returnedModelId ?? job.requestedModelId,
      aspectTier: aspect.tier,
      relativeAspectError: aspect.relativeAspectError,
      acceptedAtMs: input.nowMs,
      generationRunId: createId(),
    };
    input.ledger.assets.push(asset);
    job.historyAssetId = asset.id;
    job.acceptedAtMs = input.nowMs;
    job.updatedAtMs = input.nowMs;
    return { ok: true, created: true, asset, activated: false };
  });
}

async function reconcileAccepted(
  input: Readonly<{ bytes: Uint8Array | null; ledger: CleanupHistoryLedger }>,
  job: CleanupJobRow,
  path: string,
  sha256: string,
  existing: CleanupHistoryAsset | null,
): Promise<CleanupHistoryAcceptResult> {
  const asset = existing ?? input.ledger.assets.find((item) => item.id === job.historyAssetId) ?? null;
  if (!asset || !input.bytes) return { ok: false, code: "candidate_missing" };
  if (asset.sha256 !== sha256 || sha256Hex(asset.bytes) !== sha256) return { ok: false, code: "candidate_mismatch" };
  const stored = input.ledger.objects.get(path);
  if (stored && sha256Hex(stored) !== sha256) return { ok: false, code: "candidate_mismatch" };
  if (!stored) input.ledger.objects.set(path, input.bytes.slice());
  if (!job.historyAssetId) {
    job.historyAssetId = asset.id;
    job.acceptedAtMs = asset.acceptedAtMs;
  }
  return { ok: true, created: false, asset, activated: false };
}

function withHistoryLock<T>(ledger: CleanupHistoryLedger, jobId: string, run: () => Promise<T>): Promise<T> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = ledger.locks.get(jobId) ?? Promise.resolve();
  ledger.locks.set(jobId, previous.then(() => gate));
  return previous.then(async () => {
    try {
      return await run();
    } finally {
      release();
    }
  });
}
