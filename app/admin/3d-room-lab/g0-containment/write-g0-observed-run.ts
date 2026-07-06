import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { validateG0ObservedRunRecord, type G0ObservedRunRecord } from "./observed-run-record";
import {
  buildNonPStaleObservedRunRecord,
  buildNonPStaleRunMetadata,
  readAndParseNonPStaleMinimalInputFile,
} from "./non-p-stale-observed-run-builder";
import { resolveNonPStaleProvenance, type NonPStaleProbeId } from "./non-p-stale-provenance-resolver";
import { runDeterministicFirstSliceExecution } from "./non-p-stale-first-slice-execution";
import {
  buildG0ObservedRunRecordPath,
  writeG0ObservedRunRecordImmutable,
} from "./observed-run-writer";
import { G0_PROBE_IDS, type G0ProbeId } from "./package";

const FIRST_SLICE_EXECUTABLE_PROBES = new Set<NonPStaleProbeId>([
  "P-gen",
  "P-legacy",
  "P-coordinate-space-drift",
]);

type CliArgs = {
  probeId: G0ProbeId;
  inputPath: string;
  rootDir: string;
  write: boolean;
};

function printUsage(): void {
  console.error(
    "Usage: npm run write:g0-observed-run -- --probe <probe-id> --input /absolute/path/to/run.json [--root-dir /absolute/path] [--write]"
  );
}

function isDeclaredProbeId(value: string): value is G0ProbeId {
  return (G0_PROBE_IDS as readonly string[]).includes(value);
}

function parseCliArgs(argv: string[]): CliArgs {
  let probeId: G0ProbeId | null = null;
  let inputPath: string | null = null;
  let rootDir = path.join(process.cwd(), "app/admin/3d-room-lab");
  let write = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--probe") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("missing_probe_id");
      }
      if (!isDeclaredProbeId(value)) {
        throw new Error(`unknown_probe:${value}`);
      }
      probeId = value;
      i += 1;
      continue;
    }
    if (arg === "--input") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("missing_input_path");
      }
      inputPath = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--root-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("missing_root_dir");
      }
      rootDir = path.resolve(value);
      i += 1;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    throw new Error(`unknown_argument:${arg}`);
  }
  if (!probeId) {
    throw new Error("probe_required");
  }
  if (!inputPath) {
    throw new Error("input_path_required");
  }
  return { probeId, inputPath, rootDir, write };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function assertFirstSliceExecutableProbe(probeId: G0ProbeId): asserts probeId is NonPStaleProbeId {
  if (probeId === "P-stale") {
    throw new Error("no_execution_adapter_yet:P-stale");
  }
  if (!FIRST_SLICE_EXECUTABLE_PROBES.has(probeId as NonPStaleProbeId)) {
    throw new Error(`no_execution_adapter_yet:${probeId}`);
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  assertFirstSliceExecutableProbe(args.probeId);

  const minimalInput = await readAndParseNonPStaleMinimalInputFile(args.inputPath);
  const provenance = await resolveNonPStaleProvenance(args.probeId);
  const deterministicExecution = await runDeterministicFirstSliceExecution({
    probeId: args.probeId,
    provenance,
  });
  const runMetadata = await buildNonPStaleRunMetadata({
    minimalInput,
    provenance,
  });
  const record = buildNonPStaleObservedRunRecord({
    probeId: args.probeId,
    provenance,
    runMetadata,
    execution: deterministicExecution,
  });

  const preWriteValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: provenance.fixtureReceipt,
    record,
  });
  if (!preWriteValidation.ok) {
    throw new Error(`contract_validation_failed:${preWriteValidation.reason}`);
  }

  const targetPath = buildG0ObservedRunRecordPath({
    rootDir: args.rootDir,
    probePackageVersion: record.probePackageVersion,
    probeId: record.probeId,
    runId: record.runMetadata.runId,
  });
  if (await pathExists(targetPath)) {
    throw new Error(`target_path_exists:${targetPath}`);
  }

  console.log("execution_mode=deterministic_execution_observed");
  console.log("schema_and_contract_validation=passed");

  if (!args.write) {
    console.log("mode=dry-run");
    console.log(`intended_record_path=${targetPath}`);
    return;
  }

  const writeResult = await writeG0ObservedRunRecordImmutable({
    rootDir: args.rootDir,
    fixtureReceipt: provenance.fixtureReceipt,
    record,
  });
  const persistedRecord = JSON.parse(await readFile(writeResult.path, "utf8")) as G0ObservedRunRecord;
  const postWriteValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: provenance.fixtureReceipt,
    record: persistedRecord,
  });
  if (!postWriteValidation.ok) {
    throw new Error(`post_write_validation_failed:${postWriteValidation.reason}`);
  }

  console.log("mode=write");
  console.log("post_write_re_read_validation=passed");
  console.log(`record_path=${writeResult.path}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`write_g0_observed_run_failed:${message}`);
  printUsage();
  process.exitCode = 1;
});
