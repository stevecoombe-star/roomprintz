import { randomUUID } from "node:crypto";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import type { RemoveCleanupGenerationInputSnapshot } from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

import { cleanupJobInsertFromSnapshot, cleanupMaskManifest } from "./snapshot";
import type { CleanupControl } from "./runtime";
import type { CleanupEnqueueResult } from "./types";

/**
 * Store the frozen ORIGINAL, overlay, prompt, and mask manifest, then create
 * the job. A duplicate paid fingerprint returns the existing job and does
 * not upload a second input set for that job.
 */
export async function enqueuePreparedCleanupJob(
  control: CleanupControl,
  snapshot: RemoveCleanupGenerationInputSnapshot,
  input: Readonly<{ userId: string; roomUserId: string; currentGenerationId: string; jobId?: string }>,
): Promise<CleanupEnqueueResult | Readonly<{ ok: false; code: "inadmissible_aspect" | "artifact_unreadable" }>> {
  const jobId = input.jobId ?? randomUUID();
  const insert = cleanupJobInsertFromSnapshot(snapshot, { ...input, jobId });
  if (!insert) return { ok: false, code: "inadmissible_aspect" };
  const existing = await control.readRoom(insert.userId, insert.roomId);
  if (existing && existing.paidRequestFingerprint === insert.paidRequestFingerprint) {
    return control.enqueue(insert);
  }
  const original = snapshot.artifacts.originalBytes();
  const overlay = snapshot.artifacts.overlayPng();
  const prompt = new TextEncoder().encode(snapshot.prompt.text);
  const masks = cleanupMaskManifest(snapshot);
  const paths = [insert.originalPath, insert.overlayPath, insert.promptPath, insert.masksPath];
  const stored = await Promise.all([
    control.artifacts.put(insert.originalPath, original, snapshot.original.mimeType),
    control.artifacts.put(insert.overlayPath, overlay, "image/png"),
    control.artifacts.put(insert.promptPath, prompt, "text/plain"),
    control.artifacts.put(insert.masksPath, masks, "application/json"),
  ]);
  if (stored.some((result) => result !== "ok")) {
    await control.artifacts.remove(paths);
    return { ok: false, code: "artifact_unreadable" };
  }
  const readBack = await Promise.all(paths.map((path) => control.artifacts.get(path)));
  const hashes = [
    sha256Hex(original),
    sha256Hex(overlay),
    sha256Hex(prompt),
    sha256Hex(masks),
  ];
  const expected = [insert.originalSha256, insert.overlaySha256, insert.promptSha256, insert.maskManifestSha256];
  if (readBack.some((bytes, index) => !bytes || sha256Hex(bytes) !== hashes[index] || hashes[index] !== expected[index])) {
    await control.artifacts.remove(paths);
    return { ok: false, code: "artifact_unreadable" };
  }
  const queued = await control.enqueue(insert);
  if (!queued.ok || !queued.created) await control.artifacts.remove(paths);
  return queued;
}
