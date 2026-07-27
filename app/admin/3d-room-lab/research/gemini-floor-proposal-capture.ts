/**
 * AFC-R3C-B2 — local-only immutable research capture writes.
 */
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm, stat, link } from "node:fs/promises";
import path from "node:path";

export const AFC_R3C_CAPTURE_ROOT_RELATIVE = path.join(".local", "afc-r3c-captures");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/**
 * Permit only the dedicated ignored repository root, or a directory entirely
 * outside the repository. This blocks source, public assets, uploads, and any
 * tracked repository directory without relying on a mutable git query.
 */
export function validateAfcR3cCaptureDirectory(outputDir: string, repositoryRoot: string): { ok: true; outputDir: string } | { ok: false; reason: string } {
  if (typeof outputDir !== "string" || outputDir.length === 0 || outputDir.includes("\0")) return { ok: false, reason: "capture_output_invalid" };
  const root = path.resolve(repositoryRoot);
  const resolved = path.resolve(outputDir);
  if (!inside(root, resolved)) return { ok: true, outputDir: resolved };
  const approved = path.resolve(root, AFC_R3C_CAPTURE_ROOT_RELATIVE);
  if (!inside(approved, resolved)) return { ok: false, reason: "capture_output_inside_repository" };
  return { ok: true, outputDir: resolved };
}

/**
 * Establish the output directory before a provider request. The post-mkdir
 * realpath checks reject a symlink that escapes the dedicated repository root
 * or redirects an apparently external output back into repository sources.
 */
export async function prepareAfcR3cCaptureDirectory(args: {
  outputDir: string;
  repositoryRoot: string;
}): Promise<{ ok: true; outputDir: string } | { ok: false; reason: string }> {
  const checked = validateAfcR3cCaptureDirectory(args.outputDir, args.repositoryRoot);
  if (!checked.ok) return checked;
  try {
    const lexicalRoot = path.resolve(args.repositoryRoot);
    const lexicalOutput = checked.outputDir;
    const lexicalInsideRepository = inside(lexicalRoot, lexicalOutput);
    const lexicalApprovedRoot = path.resolve(lexicalRoot, AFC_R3C_CAPTURE_ROOT_RELATIVE);
    if (lexicalInsideRepository) {
      try {
        if ((await lstat(lexicalApprovedRoot)).isSymbolicLink()) {
          return { ok: false, reason: "capture_output_symlink_escape" };
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(lexicalOutput, { recursive: true });
    const [realOutput, realRoot] = await Promise.all([realpath(lexicalOutput), realpath(lexicalRoot)]);
    if (lexicalInsideRepository) {
      const realApprovedRoot = await realpath(lexicalApprovedRoot);
      if (!inside(realRoot, realApprovedRoot) || !inside(realApprovedRoot, realOutput)) {
        return { ok: false, reason: "capture_output_symlink_escape" };
      }
    } else if (inside(realRoot, realOutput)) {
      return { ok: false, reason: "capture_output_symlink_into_repository" };
    }
    const probe = path.join(realOutput, `.afc-r3c-preflight.${randomUUID()}.tmp`);
    const handle = await open(probe, "wx", 0o600);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rm(probe);
    return { ok: true, outputDir: realOutput };
  } catch {
    return { ok: false, reason: "capture_output_unwritable" };
  }
}

/** Sanitized token never includes separators, control characters, or traversal. */
export function sanitizeAfcR3cCaptureToken(value: string): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  const token = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  if (token.length === 0 || token.length > 180 || token === "." || token === "..") return null;
  return token;
}

/**
 * Atomically make an immutable digest-named artifact. An existing same-name file
 * is reused only when its bytes exactly match. Hard-link publication prevents
 * an accidental overwrite race; temp and final files are in the same directory.
 */
export async function writeAfcR3cImmutableCapture(args: {
  outputDir: string;
  filename: string;
  bytes: Buffer;
}): Promise<{ ok: true; filePath: string; reused: boolean } | { ok: false; reason: string }> {
  if (path.basename(args.filename) !== args.filename || !args.filename || args.filename.includes("\0")) {
    return { ok: false, reason: "capture_filename_invalid" };
  }
  try {
    await mkdir(args.outputDir, { recursive: true });
    const outputInfo = await stat(args.outputDir);
    if (!outputInfo.isDirectory()) return { ok: false, reason: "capture_output_not_directory" };
    const target = path.join(args.outputDir, args.filename);
    try {
      const existing = await readFile(target);
      return existing.equals(args.bytes)
        ? { ok: true, filePath: target, reused: true }
        : { ok: false, reason: "capture_existing_bytes_mismatch" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = path.join(args.outputDir, `.${args.filename}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(args.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, target);
      await rm(temporary);
      return { ok: true, filePath: target, reused: false };
    } catch (error) {
      await rm(temporary, { force: true });
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(target);
      return existing.equals(args.bytes)
        ? { ok: true, filePath: target, reused: true }
        : { ok: false, reason: "capture_existing_bytes_mismatch" };
    }
  } catch {
    return { ok: false, reason: "capture_write_failed" };
  }
}

export function providerEnvelopeFilename(digest: string): string {
  return `provider-envelope.${digest}.json`;
}

export function modelOutputFilename(digest: string): string {
  return `model-output.${digest}.json`;
}

export function receiptFilename(requestId: string): string | null {
  const token = sanitizeAfcR3cCaptureToken(requestId);
  return token ? `afc-r3c-run.${token}.receipt.json` : null;
}

export function stableReceiptBytes(receipt: unknown): Buffer {
  return Buffer.from(JSON.stringify(receipt, null, 2), "utf8");
}

export function digestAfcR3cCaptureBytes(bytes: Buffer): string {
  return sha256(bytes);
}
