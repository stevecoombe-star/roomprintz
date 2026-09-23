/**
 * PI-5D2B Variant → current Asset association CLI.
 *
 * Usage:
 *   npm run vibode:retarget-variant -- \
 *     --variant-id <id> --product-id <id> --asset-id <id> [--check]
 */

import {
  retargetVariantCurrentAssetAssociation,
} from "@/lib/vibode-stage/variant-asset-association";

type FlagMap = Record<string, string | boolean>;

function parseFlags(argv: string[]): FlagMap {
  const flags: FlagMap = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) continue;
    const trimmed = token.slice(2);
    const eq = trimmed.indexOf("=");
    if (eq >= 0) {
      flags[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[trimmed] = true;
    } else {
      flags[trimmed] = next;
      i += 1;
    }
  }
  return flags;
}

function flagString(flags: FlagMap, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help(): string {
  return (
    `Usage:\n` +
    `  npm run vibode:retarget-variant -- --variant-id <id> --product-id <id> --asset-id <id>\n` +
    `  npm run vibode:retarget-variant -- --variant-id <id> --product-id <id> --asset-id <id> --check\n`
  );
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help === true) {
    process.stdout.write(help());
    return;
  }
  const variantId = flagString(flags, "variant-id");
  const productId = flagString(flags, "product-id");
  const assetId = flagString(flags, "asset-id");
  if (!variantId || !productId || !assetId) {
    process.stderr.write("retarget-variant requires --variant-id --product-id --asset-id.\n");
    process.stderr.write(help());
    process.exitCode = 1;
    return;
  }
  const result = retargetVariantCurrentAssetAssociation({
    variantId,
    productId,
    assetId,
    repoRoot: flagString(flags, "repo-root") ?? process.cwd(),
    check: flags.check === true,
    migrationTimestamp: flagString(flags, "migration-timestamp"),
  });
  printJson(result);
  process.exitCode = result.ok ? 0 : 1;
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
