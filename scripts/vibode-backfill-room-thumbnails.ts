/**
 * Repair historical Vibode room-asset 2D thumbnails.
 *
 * Reads server credentials from the environment or .env.local.
 * Does not print secrets or signed URLs.
 *
 *   npm run vibode:backfill-room-thumbnails -- --dry-run
 *   npm run vibode:backfill-room-thumbnails -- --limit 50
 *   npm run vibode:backfill-room-thumbnails -- --asset-id <uuid>
 *   npm run vibode:backfill-room-thumbnails -- --room-id <uuid>
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  createVibode2dThumbnailBackfillStorage,
  loadVibode2dThumbnailBackfillCandidates,
  runVibode2dThumbnailBackfill,
  updateVibode2dThumbnailPath,
  type ThumbnailBackfillResult,
} from "@/lib/vibodeAssetThumbnailBackfill";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CliOptions = {
  dryRun: boolean;
  verifyExisting: boolean;
  limit: number | null;
  assetId: string | null;
  roomId: string | null;
};

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const stripped = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function readOption(argv: string[], name: string): string | null {
  const inline = argv.find((token) => token.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help")) {
    console.log(`Usage: npm run vibode:backfill-room-thumbnails -- [--dry-run] [--limit N] [--asset-id UUID] [--room-id UUID] [--verify-existing]`);
    process.exit(0);
  }
  const known = new Set(["--dry-run", "--verify-existing", "--limit", "--asset-id", "--room-id", "--help"]);
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const name = token.split("=")[0] ?? token;
    if (!known.has(name)) throw new Error(`Unknown option ${name}.`);
  }
  const limitText = readOption(argv, "--limit");
  const assetId = readOption(argv, "--asset-id");
  const roomId = readOption(argv, "--room-id");
  let limit: number | null = null;
  if (limitText !== null) {
    if (!/^[1-9]\d*$/.test(limitText)) throw new Error("--limit must be a positive integer.");
    limit = Number(limitText);
  }
  if (assetId && !UUID.test(assetId)) throw new Error("--asset-id must be a uuid.");
  if (roomId && !UUID.test(roomId)) throw new Error("--room-id must be a uuid.");
  return {
    dryRun: argv.includes("--dry-run"),
    verifyExisting: argv.includes("--verify-existing"),
    limit,
    assetId,
    roomId,
  };
}

function publicResult(result: ThumbnailBackfillResult) {
  return {
    assetId: result.assetId,
    roomId: result.roomId,
    outcome: result.outcome,
    reason: result.reason,
    errorClass: result.errorClass,
    sourceAvailable: result.sourceAvailable,
    sourceBucket: result.sourceBucket,
    sourcePath: result.sourcePath,
    targetBucket: result.targetBucket,
    targetPath: result.targetPath,
    dbUpdated: result.dbUpdated,
    bytes: result.bytes,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase: SupabaseClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const assets = await loadVibode2dThumbnailBackfillCandidates(supabase, {
    assetId: options.assetId,
    roomId: options.roomId,
    verifyExisting: options.verifyExisting,
  });
  const report = await runVibode2dThumbnailBackfill({
    assets,
    dryRun: options.dryRun,
    limit: options.limit,
    assetId: options.assetId,
    roomId: options.roomId,
    storage: createVibode2dThumbnailBackfillStorage(supabase),
    updateThumbnail: (update) => updateVibode2dThumbnailPath(supabase, update),
  });
  console.log(JSON.stringify({
    mode: options.dryRun ? "dry-run" : "live",
    candidates: report.candidates,
    scanned: report.scanned,
    skipped: report.skipped,
    repaired: report.repaired,
    planned: report.planned,
    failed: report.failed,
    sourceMissing: report.sourceMissing,
    objectReused: report.objectReused,
    plannedReuse: report.plannedReuse,
    dbUpdated: report.dbUpdated,
  }, null, 2));
  for (const result of report.results) {
    if (result.outcome === "skipped") continue;
    console.log(JSON.stringify(publicResult(result)));
  }
  if ((options.assetId || options.roomId) && report.candidates === 0) {
    process.exitCode = 1;
  } else if (report.failed > 0 || report.sourceMissing > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Room thumbnail backfill failed.";
  console.error(message);
  process.exit(1);
});
