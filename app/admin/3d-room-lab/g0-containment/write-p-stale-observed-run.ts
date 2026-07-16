import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { validateG0ObservedRunRecord, type G0ObservedRunRecord } from "./observed-run-record";
import {
  buildG0ObservedRunRecordPath,
  writeG0ObservedRunRecordImmutable,
} from "./observed-run-writer";
import {
  buildPStaleObservedRunRecord,
  buildPStaleRunMetadata,
  readAndParsePStaleObservedRunWriterInputFile,
  resolvePStaleActivePreconditionBinding,
} from "./p-stale-observed-run-writer";
import { buildG0ProbeDeclarations } from "./probe-declarations";

type CliArgs = {
  inputPath: string;
  rootDir: string;
  write: boolean;
};

function printUsage(): void {
  console.error(
    "Usage: npm run write:p-stale-observed-run -- --input /absolute/path/to/run.json [--root-dir /absolute/path] [--write]"
  );
}

function parseCliArgs(argv: string[]): CliArgs {
  let inputPath: string | null = null;
  let rootDir = path.join(process.cwd(), "app/admin/3d-room-lab");
  let write = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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

  if (!inputPath) {
    throw new Error("input_path_required");
  }

  return { inputPath, rootDir, write };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const fixtureReceipt = buildG0ProbeDeclarations()["P-stale"];
  const binding = resolvePStaleActivePreconditionBinding(fixtureReceipt);
  const parsedInput = await readAndParsePStaleObservedRunWriterInputFile(args.inputPath, binding);
  const runMetadata = await buildPStaleRunMetadata(parsedInput);
  const record = buildPStaleObservedRunRecord({
    fixtureReceipt,
    runMetadata,
    parsedInput,
  });

  const preWriteValidation = await validateG0ObservedRunRecord({ fixtureReceipt, record });
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

  console.log(
    "schema_and_contract_validation=passed (operator evidence truthfulness not independently verified)"
  );

  if (!args.write) {
    console.log("mode=dry-run");
    console.log(`intended_record_path=${targetPath}`);
    return;
  }

  const writeResult = await writeG0ObservedRunRecordImmutable({
    rootDir: args.rootDir,
    fixtureReceipt,
    record,
  });
  const persistedRecord = JSON.parse(
    await readFile(writeResult.path, "utf8")
  ) as G0ObservedRunRecord;
  const postWriteValidation = await validateG0ObservedRunRecord({
    fixtureReceipt,
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
  console.error(`write_p_stale_observed_run_failed:${message}`);
  printUsage();
  process.exitCode = 1;
});
