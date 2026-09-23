/**
 * PI-5D2A furniture Asset CLI.
 *
 * Commands: validate | register | generate
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findManifestAsset,
  furnitureAssetRepoPaths,
  loadFurnitureAssetManifest,
  publicFilePathFromGlbUrl,
} from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import { renderGeneratedFurnitureAssetRegistry } from "@/lib/afc-v2-runtime/furniture-asset-generate";
import {
  generateFurnitureAssetArtifacts,
  registerFurnitureAsset,
} from "@/lib/afc-v2-runtime/furniture-asset-register";
import { validateFurnitureAssetFile } from "@/lib/afc-v2-runtime/furniture-asset-validate";

type FlagMap = Record<string, string | boolean>;

function parseFlags(argv: string[]): { command: string; flags: FlagMap } {
  const [command = "validate", ...rest] = argv;
  const flags: FlagMap = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (!token.startsWith("--")) continue;
    const trimmed = token.slice(2);
    const eq = trimmed.indexOf("=");
    if (eq >= 0) {
      flags[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
      continue;
    }
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      flags[trimmed] = true;
    } else {
      flags[trimmed] = next;
      i += 1;
    }
  }
  return { command, flags };
}

function flagString(flags: FlagMap, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function flagNumber(flags: FlagMap, name: string): number | undefined {
  const raw = flagString(flags, name);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): string {
  return (
    `Usage:\n` +
    `  npm run vibode:validate-asset -- --glb <path> --asset-id <id> --width <m> --height <m> --depth <m>\n` +
    `  npm run vibode:validate-asset -- --asset-id <published-id>\n` +
    `  npm run vibode:register-asset -- --glb <path> --asset-id <id> --width <m> --height <m> --depth <m>\n` +
    `  npm run vibode:generate-assets [-- --check]\n`
  );
}

async function runValidate(flags: FlagMap): Promise<number> {
  const repoRoot = flagString(flags, "repo-root") ?? process.cwd();
  const assetId = flagString(flags, "asset-id");
  if (!assetId) {
    process.stderr.write("Missing --asset-id.\n");
    process.stderr.write(help());
    return 1;
  }
  let glbPath = flagString(flags, "glb");
  let width = flagNumber(flags, "width");
  let height = flagNumber(flags, "height");
  let depth = flagNumber(flags, "depth");
  if (glbPath == null || width == null || height == null || depth == null) {
    const loaded = loadFurnitureAssetManifest(repoRoot);
    if (!loaded.ok) {
      printJson({ accepted: false, errors: loaded.errors });
      return 1;
    }
    const published = findManifestAsset(loaded.manifest, assetId);
    if (!published) {
      process.stderr.write(`Unknown published assetId ${assetId}. Provide --glb and declared dimensions.\n`);
      return 1;
    }
    glbPath = glbPath ?? publicFilePathFromGlbUrl(repoRoot, published.glbUrl);
    width = width ?? published.authoredWidthM;
    height = height ?? published.authoredHeightM;
    depth = depth ?? published.authoredDepthM;
  }
  const result = await validateFurnitureAssetFile({
    glbPath: path.resolve(repoRoot, glbPath),
    assetId,
    declaredWidthM: width,
    declaredHeightM: height,
    declaredDepthM: depth,
  });
  printJson({
    accepted: result.accepted,
    assetId: result.assetId,
    glbPath: result.glbPath,
    parse: { ok: result.parseOk },
    fileSizeBytes: result.fileSizeBytes,
    sha256: result.sha256,
    measured: result.measured,
    declared: result.declared,
    placementScale: result.placementScale,
    warnings: result.warnings,
    errors: result.errors,
  });
  return result.accepted ? 0 : 1;
}

async function runRegister(flags: FlagMap): Promise<number> {
  const repoRoot = flagString(flags, "repo-root") ?? process.cwd();
  const assetId = flagString(flags, "asset-id");
  const glbPath = flagString(flags, "glb");
  const width = flagNumber(flags, "width");
  const height = flagNumber(flags, "height");
  const depth = flagNumber(flags, "depth");
  if (!assetId || !glbPath || width == null || height == null || depth == null) {
    process.stderr.write("register requires --glb --asset-id --width --height --depth.\n");
    process.stderr.write(help());
    return 1;
  }
  const result = await registerFurnitureAsset({
    repoRoot,
    glbPath: path.resolve(repoRoot, glbPath),
    assetId,
    declaredWidthM: width,
    declaredHeightM: height,
    declaredDepthM: depth,
    status: flagString(flags, "status") === "unavailable" ? "unavailable" : "ready",
    glbUrl: flagString(flags, "glb-url"),
    migrationTimestamp: flagString(flags, "migration-timestamp"),
  });
  printJson(result);
  return result.ok ? 0 : 1;
}

function runGenerate(flags: FlagMap): number {
  const repoRoot = flagString(flags, "repo-root") ?? process.cwd();
  const check = flags.check === true;
  const loaded = loadFurnitureAssetManifest(repoRoot);
  if (!loaded.ok) {
    printJson({ ok: false, errors: loaded.errors });
    return 1;
  }
  const expected = renderGeneratedFurnitureAssetRegistry(loaded.manifest.assets);
  const dest = furnitureAssetRepoPaths(repoRoot).generatedRegistry;
  if (check) {
    const current = readFileSync(dest, "utf8");
    const unchanged = current === expected;
    printJson({ ok: unchanged, unchanged, generatedRegistry: dest });
    return unchanged ? 0 : 1;
  }
  const result = generateFurnitureAssetArtifacts(repoRoot);
  printJson(result);
  return result.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const { command, flags } = parseFlags(process.argv.slice(2));
  if (command === "help" || flags.help === true) {
    process.stdout.write(help());
    return;
  }
  if (command === "validate") {
    process.exitCode = await runValidate(flags);
    return;
  }
  if (command === "register") {
    process.exitCode = await runRegister(flags);
    return;
  }
  if (command === "generate") {
    process.exitCode = runGenerate(flags);
    return;
  }
  process.stderr.write(`Unknown command ${command}.\n`);
  process.stderr.write(help());
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
