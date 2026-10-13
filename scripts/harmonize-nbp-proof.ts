/**
 * One admin-only Nano Banana Pro proof call.
 *
 * Dry run verifies the ZIP and prints the request plan. It does not call Google.
 * The paid call runs only when --confirm-paid is present.
 *
 *   npm run harmonize:nbp-proof -- --zip "/absolute/path/package.zip"
 *   npm run harmonize:nbp-proof -- --zip "/absolute/path/package.zip" --confirm-paid
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyNanoBananaProAspectRatio } from "../lib/afc-image-models";
import { sha256HexBytes } from "../lib/vibode-stage/harmonize-export";
import {
  HARMONIZE_NBP_ASPECT_RATIO,
  HARMONIZE_NBP_ENDPOINT,
  HARMONIZE_NBP_IMAGE_SIZE,
  HARMONIZE_NBP_MODEL_ID,
  HARMONIZE_NBP_OUTPUT_HEIGHT,
  HARMONIZE_NBP_OUTPUT_WIDTH,
  HARMONIZE_NBP_PUBLISHED_IMAGE_INPUT_USD,
  HARMONIZE_NBP_PUBLISHED_OUTPUT_USD,
  HARMONIZE_NBP_TIMEOUT_MS,
  HarmonizeNbpProofError,
  assessHarmonizeNbpFraming,
  callHarmonizeNbpProof,
  readHarmonizeNbpApiKey,
  readHarmonizeNbpImageSize,
  readHarmonizeProofPackage,
} from "../lib/vibode-stage/harmonize-nbp-proof";

const DEFAULT_OUT = path.join(process.cwd(), ".local", "harmonize-nbp-proof");

function loadEnvFile(source: string) {
  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const stripped = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadLocalEnv() {
  for (const name of [".env.local", ".env"]) {
    const filePath = path.join(process.cwd(), name);
    try {
      loadEnvFile(await readFile(filePath, "utf8"));
    } catch {
      // Missing env files are fine. The key check happens later.
    }
  }
}

function readOption(argv: readonly string[], name: string): string | null {
  const inline = argv.find((token) => token.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function printPlan(plan: unknown) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write(
      "Usage: npm run harmonize:nbp-proof -- --zip <harmonize.zip> [--out <dir>] [--confirm-paid]\n",
    );
    return;
  }
  const zipPath = readOption(argv, "--zip");
  const outRoot = readOption(argv, "--out") ?? DEFAULT_OUT;
  const confirmPaid = argv.includes("--confirm-paid");
  if (!zipPath) {
    throw new HarmonizeNbpProofError("invalid_package", "Pass --zip with the verified Harmonize package.");
  }
  await loadLocalEnv();
  const zipBytes = new Uint8Array(await readFile(zipPath));
  const proof = await readHarmonizeProofPackage(zipBytes);
  const credential = readHarmonizeNbpApiKey(process.env);
  const classified = classifyNanoBananaProAspectRatio(proof.inputWidth, proof.inputHeight);
  const plan = {
    mode: confirmPaid ? "paid" : "dry-run",
    endpoint: HARMONIZE_NBP_ENDPOINT,
    requestedModel: HARMONIZE_NBP_MODEL_ID,
    aspectRatio: classified.ok ? classified.ratio : null,
    imageSize: HARMONIZE_NBP_IMAGE_SIZE,
    expectedOutput: classified.ok && classified.ratio === HARMONIZE_NBP_ASPECT_RATIO
      ? { width: HARMONIZE_NBP_OUTPUT_WIDTH, height: HARMONIZE_NBP_OUTPUT_HEIGHT }
      : null,
    timeoutMs: HARMONIZE_NBP_TIMEOUT_MS,
    inputWidth: proof.inputWidth,
    inputHeight: proof.inputHeight,
    compositeSha256: proof.compositeSha256,
    promptSha256: proof.promptSha256,
    promptBytes: new TextEncoder().encode(proof.prompt).byteLength,
    coreVersion: proof.coreVersion,
    materialGuidanceIncluded: proof.materialGuidanceIncluded,
    promptCorePresent: proof.promptCorePresent,
    credential: credential ? "present" : "missing",
    publishedImageOutputUsd: HARMONIZE_NBP_PUBLISHED_OUTPUT_USD,
    publishedImageInputUsd: HARMONIZE_NBP_PUBLISHED_IMAGE_INPUT_USD,
    retries: 0,
  };
  if (!classified.ok) {
    printPlan({ ...plan, providerCalled: false });
    throw new HarmonizeNbpProofError(
      "invalid_package",
      "B-stage-composite.png is outside the supported Nano Banana Pro aspect ratios.",
    );
  }
  if (!confirmPaid) {
    printPlan({ ...plan, providerCalled: false });
    return;
  }
  if (!credential) {
    throw new HarmonizeNbpProofError("missing_credentials", "Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }
  const result = await callHarmonizeNbpProof({
    prompt: proof.prompt,
    png: proof.composite,
    apiKey: credential,
    timeoutMs: HARMONIZE_NBP_TIMEOUT_MS,
  });
  const size = readHarmonizeNbpImageSize(result.output);
  if (!size) {
    throw new HarmonizeNbpProofError("unexpected_output", "Returned image is not a PNG or JPEG.");
  }
  const framing = assessHarmonizeNbpFraming({
    width: size.width,
    height: size.height,
    inputWidth: proof.inputWidth,
    inputHeight: proof.inputHeight,
  });
  const outputSha256 = await sha256HexBytes(result.output);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(outRoot, stamp);
  await mkdir(directory, { recursive: true });
  const extension = size.mime === "image/jpeg" ? "jpg" : "png";
  const imagePath = path.join(directory, `harmonize-nbp-proof.${extension}`);
  const receiptPath = path.join(directory, "receipt.json");
  await writeFile(imagePath, result.output);
  const receipt = {
    ...plan,
    providerCalled: true,
    returnedModel: result.returnedModel,
    interactionId: result.interactionId,
    providerStatus: result.providerStatus,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    outputWidth: size.width,
    outputHeight: size.height,
    outputMime: result.outputMime,
    outputBytes: result.output.byteLength,
    outputSha256,
    aspectErrorVsFourThree: framing.aspectErrorVsFourThree,
    aspectErrorVsInput: framing.aspectErrorVsInput,
    matches2kFourThree: framing.matches2kFourThree,
    withinToleranceOfInput: framing.withinToleranceOfInput,
    accepted: framing.accepted,
    postCount: result.postCount,
    getCount: result.getCount,
    usage: result.usage,
    imagePath,
    receiptPath,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  printPlan(receipt);
  if (!framing.accepted) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const code = error instanceof HarmonizeNbpProofError ? error.code : "transport";
  const message = error instanceof Error ? error.message : "Harmonize proof failed.";
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
});
