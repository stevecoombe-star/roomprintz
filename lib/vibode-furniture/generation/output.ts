/**
 * Provider GLB intake. Downloads stay on an injected transport.
 * The permanent 25 MiB ceiling and the existing GLB validator both apply.
 * A candidate is not a personal asset and is not saved here.
 */

import { PERSONAL_FURNITURE_BUCKET, PERSONAL_FURNITURE_GLB_MAX_BYTES } from "@/lib/vibode-furniture/asset-id";
import type { PersonalGlbValidator } from "@/lib/vibode-furniture/store";

import { meshyAssetUrlDecision } from "./meshy-task";
import { MESHY_DOWNLOAD_TIMEOUT_MS } from "./policy";

export type GenerationDownload =
  | Readonly<{ kind: "ok"; status: number; body: Uint8Array; contentLength: number | null }>
  | Readonly<{ kind: "redirect"; location: string }>
  | Readonly<{ kind: "timeout" }>
  | Readonly<{ kind: "network" }>
  | Readonly<{ kind: "too_large" }>;

export type GenerationDownloader = (input: Readonly<{
  url: string;
  timeoutMs: number;
  maxBytes: number;
}>) => Promise<GenerationDownload>;

export type ProviderGlbIntake =
  | Readonly<{ ok: true; bytes: Uint8Array; shaReady: true }>
  | Readonly<{ ok: false; errorClass: "invalid_output" | "oversized_output" | "ingest_failed"; message: string }>;

export function generationCandidatePath(userId: string, jobId: string): string {
  return `users/${userId}/generations/${jobId}/candidate.glb`;
}

export function generationInputPath(
  userId: string,
  jobId: string,
  slot: string,
  extension: "jpg" | "png" | "webp",
): string {
  return `users/${userId}/inputs/${jobId}/${slot}.${extension}`;
}

export function pathOwnedBy(path: string, userId: string): boolean {
  const prefix = `users/${userId}/`;
  return path.startsWith(prefix) && !path.includes("..") && !path.includes("//");
}

export async function intakeProviderGlb(input: Readonly<{
  url: string;
  nowMs: number;
  expiresAtMs: number | null;
  assetId: string;
  download: GenerationDownloader;
  validate: PersonalGlbValidator;
}>): Promise<ProviderGlbIntake> {
  const decision = meshyAssetUrlDecision({
    url: input.url,
    nowMs: input.nowMs,
    expiresAtMs: input.expiresAtMs,
  });
  if (decision !== "ok") {
    return { ok: false, errorClass: "invalid_output", message: "The generated model link cannot be used." };
  }
  const first = await input.download({
    url: input.url,
    timeoutMs: MESHY_DOWNLOAD_TIMEOUT_MS,
    maxBytes: PERSONAL_FURNITURE_GLB_MAX_BYTES,
  });
  const followed = await followOneRedirect(input, first);
  if (!followed.ok) return followed.result;
  const downloaded = followed.download;
  if (downloaded.kind === "too_large") {
    return { ok: false, errorClass: "oversized_output", message: "This GLB is too large. The limit is 25 MB." };
  }
  if (downloaded.kind !== "ok" || downloaded.status !== 200) {
    return { ok: false, errorClass: "ingest_failed", message: "The generated model could not be downloaded." };
  }
  if (
    downloaded.body.byteLength <= 0 ||
    downloaded.body.byteLength > PERSONAL_FURNITURE_GLB_MAX_BYTES ||
    (downloaded.contentLength != null && downloaded.contentLength > PERSONAL_FURNITURE_GLB_MAX_BYTES)
  ) {
    return { ok: false, errorClass: "oversized_output", message: "This GLB is too large. The limit is 25 MB." };
  }
  const validated = await input.validate({ bytes: downloaded.body, assetId: input.assetId });
  if (!validated.accepted || validated.widthM == null || validated.heightM == null || validated.depthM == null) {
    return { ok: false, errorClass: "invalid_output", message: "This file isn't a supported GLB." };
  }
  return { ok: true, bytes: downloaded.body, shaReady: true };
}

export function candidateBucket(): string {
  return PERSONAL_FURNITURE_BUCKET;
}

async function followOneRedirect(
  input: Readonly<{
    url: string;
    nowMs: number;
    expiresAtMs: number | null;
    download: GenerationDownloader;
  }>,
  first: GenerationDownload,
): Promise<
  | { ok: true; download: GenerationDownload }
  | { ok: false; result: ProviderGlbIntake }
> {
  if (first.kind !== "redirect") return { ok: true, download: first };
  const nextUrl = resolveRedirect(input.url, first.location);
  const nextDecision = meshyAssetUrlDecision({
    url: nextUrl,
    nowMs: input.nowMs,
    expiresAtMs: input.expiresAtMs,
  });
  if (nextDecision !== "ok") {
    return {
      ok: false,
      result: { ok: false, errorClass: "invalid_output", message: "The generated model link cannot be used." },
    };
  }
  const second = await input.download({
    url: nextUrl,
    timeoutMs: MESHY_DOWNLOAD_TIMEOUT_MS,
    maxBytes: PERSONAL_FURNITURE_GLB_MAX_BYTES,
  });
  if (second.kind === "redirect") {
    return {
      ok: false,
      result: { ok: false, errorClass: "ingest_failed", message: "The generated model could not be downloaded." },
    };
  }
  return { ok: true, download: second };
}

function resolveRedirect(current: string, location: string): string {
  try {
    return new URL(location, current).toString();
  } catch {
    return location;
  }
}
