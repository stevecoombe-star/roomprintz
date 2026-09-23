/**
 * PI-5F2A Partner package CLI.
 *
 * Usage:
 *   npm run vibode:import-partner-package -- --input <package-dir>
 *   npm run vibode:import-partner-package -- --input <package-dir> --check
 */

import { importPartnerPackage } from "@/lib/vibode-stage/partner-package";

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
    `  npm run vibode:import-partner-package -- --input <package-dir>\n` +
    `  npm run vibode:import-partner-package -- --input <package-dir> --check\n`
  );
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help === true) {
    process.stdout.write(help());
    return;
  }
  const inputPath = flagString(flags, "input");
  if (!inputPath) {
    process.stderr.write("import-partner-package requires --input <package-dir>.\n");
    process.stderr.write(help());
    process.exitCode = 1;
    return;
  }
  const result = await importPartnerPackage({
    packageDir: inputPath,
    repoRoot: flagString(flags, "repo-root") ?? process.cwd(),
    check: flags.check === true,
    migrationTimestamp: flagString(flags, "migration-timestamp"),
    catalogBatchId: flagString(flags, "batch-id"),
  });
  printJson({
    ok: result.ok,
    check: result.check,
    issues: result.issues,
    assetPlans: result.assetPlans,
    catalogPlan: result.catalogPlan
      ? {
        migration: result.catalogPlan.migration,
        productCount: result.catalogPlan.productCount,
        variantCount: result.catalogPlan.variantCount,
        collectionCount: result.catalogPlan.collectionCount,
        membershipCount: result.catalogPlan.membershipCount,
      }
      : null,
    written: result.written,
    migrationOrder: result.migrationOrder,
    incompleteRecovery: result.incompleteRecovery,
  });
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
