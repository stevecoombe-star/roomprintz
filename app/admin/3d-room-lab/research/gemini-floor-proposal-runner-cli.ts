#!/usr/bin/env node
/**
 * AFC-R3C-B2 manual runner. This file has no default execution path: a live
 * request is impossible without the explicit acknowledgement flag.
 */
import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateAfcR3cCaptureDirectory } from "./gemini-floor-proposal-capture";
import {
  deriveGeminiFloorBasisBinding,
  GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
} from "./gemini-floor-proposal-contract";
import { classifyAfcR3cImagePairCompatibility } from "./gemini-floor-proposal-composition";
import { parseAfcR3cImageManifest } from "./gemini-floor-proposal-manifest";
import { resolveAfcR3cGenerationConfig } from "./gemini-floor-proposal-provider";
import {
  runAfcR3cGeminiFloorProposalStudy,
  verifyAfcR3cManifestImage,
} from "./gemini-floor-proposal-runner";
import { buildAfcR3cGeminiFloorProposalPrompt, type AfcR3cStudyMode } from "./gemini-floor-proposal-prompt";

type CliOptions = Readonly<{
  manifest: string;
  outputDir: string;
  studyMode: AfcR3cStudyMode;
  model: string;
  validateOnly: boolean;
  executeLiveProviderCall: boolean;
  runAfcR2: boolean;
  requestIdPrefix?: string;
}>;

const EXIT: Record<string, number> = {
  invalid_arguments: 2,
  invalid_manifest: 3,
  comparison_context_invalid: 3,
  image_read_failed: 4,
  image_oversized: 4,
  image_byte_count_mismatch: 5,
  image_mime_mismatch: 4,
  image_hash_mismatch: 5,
  image_metadata_mismatch: 6,
  image_orientation_unsupported: 6,
  incompatible_image_pair: 7,
  missing_api_key: 8,
  provider_transport_failed: 9,
  provider_non_success: 10,
  provider_envelope_invalid: 11,
  provider_envelope_ambiguous: 12,
  r3b_contract_failure: 13,
  capture_write_failed: 14,
  composition_failure: 15,
  afc_r2_context_failure: 16,
};

function parseArguments(argv: readonly string[]): { ok: true; value: CliOptions } | { ok: false; reason: string } {
  const values = new Map<string, string | boolean>();
  const takesValue = new Set(["--manifest", "--output-dir", "--study-mode", "--model", "--request-id-prefix"]);
  const flags = new Set(["--validate-only", "--execute-live-provider-call", "--run-afc-r2"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (takesValue.has(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--") || values.has(token)) return { ok: false, reason: "invalid_argument_value" };
      values.set(token, value);
      index += 1;
    } else if (flags.has(token)) {
      if (values.has(token)) return { ok: false, reason: "duplicate_flag" };
      values.set(token, true);
    } else {
      return { ok: false, reason: "unknown_argument" };
    }
  }
  const manifest = values.get("--manifest");
  const outputDir = values.get("--output-dir");
  const studyMode = values.get("--study-mode");
  const model = values.get("--model");
  if (typeof manifest !== "string" || typeof outputDir !== "string" || typeof model !== "string" ||
    (studyMode !== "empty_only" && studyMode !== "original_only" && studyMode !== "parallel_union")) {
    return { ok: false, reason: "missing_required_argument" };
  }
  if (values.has("--validate-only") && values.has("--execute-live-provider-call")) return { ok: false, reason: "validate_only_live_conflict" };
  if (!values.has("--validate-only") && !values.has("--execute-live-provider-call")) return { ok: false, reason: "live_acknowledgement_required" };
  return {
    ok: true,
    value: {
      manifest, outputDir, studyMode, model,
      validateOnly: values.has("--validate-only"),
      executeLiveProviderCall: values.has("--execute-live-provider-call"),
      runAfcR2: values.has("--run-afc-r2"),
      requestIdPrefix: typeof values.get("--request-id-prefix") === "string" ? values.get("--request-id-prefix") as string : undefined,
    },
  };
}

async function repositoryRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try {
      if ((await stat(path.join(current, ".git"))).isDirectory()) return current;
    } catch {
      // keep ascending
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

function printFailure(code: string, details?: string): number {
  console.error(`AFC-R3C-B2 failed: ${code}${details ? ` (${details})` : ""}`);
  return EXIT[code] ?? EXIT.invalid_arguments;
}

async function readManifest(manifestPath: string) {
  let bytes: Buffer;
  try {
    bytes = await readFile(manifestPath);
  } catch {
    return { ok: false as const, reason: "manifest_read_failed" };
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false as const, reason: "manifest_invalid_json" };
  }
  return parseAfcR3cImageManifest(value);
}

async function validateOnly(options: CliOptions, manifest: Extract<Awaited<ReturnType<typeof readManifest>>, { ok: true }>["manifest"]): Promise<number> {
  const manifestDirectory = path.dirname(path.resolve(options.manifest));
  const original = await verifyAfcR3cManifestImage({ descriptor: manifest.original, manifestDirectory });
  if (!original.ok) return printFailure(original.code);
  const empty = await verifyAfcR3cManifestImage({ descriptor: manifest.emptyRoomAssist, manifestDirectory });
  if (!empty.ok) return printFailure(empty.code);
  const compatibility = classifyAfcR3cImagePairCompatibility(original.image, empty.image);
  if (compatibility.tier === "incompatible") return printFailure("incompatible_image_pair");
  const basisBinding = deriveGeminiFloorBasisBinding(manifest.sharedComparisonContext, GEMINI_FLOOR_COORDINATE_EXTENT_POLICY);
  const roles = options.studyMode === "parallel_union"
    ? ["empty_room_boundary_specialist", "original_contextual"] as const
    : [options.studyMode === "empty_only" ? "empty_room_boundary_specialist" : "original_contextual"] as const;
  const prompts = roles.map((imageRole) => buildAfcR3cGeminiFloorProposalPrompt({ imageRole, basisBinding }));
  const generation = resolveAfcR3cGenerationConfig(options.model);
  console.log(JSON.stringify({
    status: "validated",
    roomId: manifest.roomId,
    studyMode: options.studyMode,
    model: options.model,
    generationConfig: generation,
    prompts: prompts.map((prompt) => ({ role: prompt.imageRole, version: prompt.promptVersion, sha256: prompt.promptSha256 })),
    compatibilityTier: compatibility.tier,
    relativeAspectErrorRaw: compatibility.relativeAspectErrorRaw,
    relativeAspectError: compatibility.relativeAspectError,
    providerCall: false,
    captureWritten: false,
  }));
  return 0;
}

export async function runAfcR3cProposalRunnerCli(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArguments(argv);
  if (!parsed.ok) return printFailure("invalid_arguments", parsed.reason);
  const options = parsed.value;
  const root = await repositoryRoot(process.cwd());
  const parsedManifest = await readManifest(options.manifest);
  if (!parsedManifest.ok) {
    const failureCode = parsedManifest.reason === "shared_context_invalid"
      ? "comparison_context_invalid"
      : "invalid_manifest";
    return printFailure(failureCode, `${parsedManifest.reason}${"path" in parsedManifest ? `:${parsedManifest.path}` : ""}`);
  }
  const outputCheck = validateAfcR3cCaptureDirectory(options.outputDir, root);
  if (!outputCheck.ok) return printFailure("capture_write_failed", outputCheck.reason);
  console.log(`AFC-R3C-B2 resolved model: ${options.model}`);
  if (options.validateOnly) return validateOnly(options, parsedManifest.manifest);
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
  const result = await runAfcR3cGeminiFloorProposalStudy({
    manifest: parsedManifest.manifest,
    manifestDirectory: path.dirname(path.resolve(options.manifest)),
    studyMode: options.studyMode,
    outputDir: outputCheck.outputDir,
    apiKey,
    model: options.model,
    executeLiveProviderCall: options.executeLiveProviderCall as true,
    repositoryRoot: root,
    requestIdPrefix: options.requestIdPrefix,
    runAfcR2: options.runAfcR2,
  });
  if (result.status === "failure") {
    const receiptPaths = result.arms.map((arm) => arm.receiptPath).filter((item): item is string => !!item);
    return printFailure(result.failureCode ?? "invalid_arguments", receiptPaths.length ? `receipts=${receiptPaths.join(",")}` : undefined);
  }
  console.log(JSON.stringify({
    status: "completed",
    roomId: result.manifestRoomId,
    studyMode: result.studyMode,
    compositionStatus: result.composition?.status ?? null,
    afcR2SelectionState: result.afcR2Result?.selectionState ?? "not_run",
    receiptPaths: result.arms.map((arm) => arm.receiptPath),
  }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAfcR3cProposalRunnerCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.exitCode = printFailure("invalid_arguments");
  });
}
