/**
 * PI-5F3A Partner catalog sync CLI.
 *
 * Usage:
 *   npm run vibode:sync-partner-catalog -- --input <sync.json>
 *   npm run vibode:sync-partner-catalog -- --input <sync.json> --check
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  importPartnerCatalogSync,
  parsePartnerCatalogSyncJson,
} from "@/lib/vibode-stage/partner-catalog-sync";

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
    `  npm run vibode:sync-partner-catalog -- --input <sync.json>\n` +
    `  npm run vibode:sync-partner-catalog -- --input <sync.json> --check\n`
  );
}

function main(): void {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help === true) {
    process.stdout.write(help());
    return;
  }
  const inputPath = flagString(flags, "input");
  if (!inputPath) {
    process.stderr.write("sync-partner-catalog requires --input <sync.json>.\n");
    process.stderr.write(help());
    process.exitCode = 1;
    return;
  }
  const repoRoot = flagString(flags, "repo-root") ?? process.cwd();
  const resolved = path.resolve(repoRoot, inputPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    printJson({
      ok: false,
      check: flags.check === true,
      noOp: false,
      issues: [{
        code: "INVALID_JSON",
        message: error instanceof Error ? error.message : "Unable to read partner sync JSON.",
      }],
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      productDeactivations: [],
      productReactivations: [],
      variantDeactivations: [],
      variantReactivations: [],
      written: null,
      migration: null,
    });
    process.exitCode = 1;
    return;
  }
  const parsed = parsePartnerCatalogSyncJson(raw);
  if (!parsed.ok) {
    printJson({
      ok: false,
      check: flags.check === true,
      noOp: false,
      issues: parsed.issues,
      productUpdates: [],
      variantCreates: [],
      variantUpdates: [],
      collectionUpdates: [],
      membershipAdds: [],
      membershipRemoves: [],
      productDeactivations: [],
      productReactivations: [],
      variantDeactivations: [],
      variantReactivations: [],
      written: null,
      migration: null,
    });
    process.exitCode = 1;
    return;
  }
  const result = importPartnerCatalogSync({
    document: parsed.document,
    repoRoot,
    check: flags.check === true,
    migrationTimestamp: flagString(flags, "migration-timestamp"),
    jsonRelativePath: path.relative(repoRoot, resolved).replaceAll("\\", "/"),
  });
  printJson({
    ok: result.ok,
    check: result.check,
    noOp: result.noOp,
    issues: result.issues,
      productUpdates: result.productUpdates,
      variantCreates: result.variantCreates,
      variantUpdates: result.variantUpdates,
      collectionUpdates: result.collectionUpdates,
      membershipAdds: result.membershipAdds,
      membershipRemoves: result.membershipRemoves,
      productDeactivations: result.productDeactivations,
      productReactivations: result.productReactivations,
      variantDeactivations: result.variantDeactivations,
      variantReactivations: result.variantReactivations,
      written: result.written,
      migration: result.migration,
  });
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
