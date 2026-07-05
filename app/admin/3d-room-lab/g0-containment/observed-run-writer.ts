import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BenchmarkFixtureReceipt } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import { validateBenchmarkRunReceiptMetadata } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import type { G0ObservedRunRecord } from "./observed-run-record";
import { validateG0ObservedRunRecord } from "./observed-run-record";
import { G0_PROBE_IDS } from "./package";

const RUN_ID_PATTERN = /^benchmark-run:([0-9a-f]{64})$/;
const SAFE_PACKAGE_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;

function isDeclaredProbeId(probeId: string): boolean {
  return (G0_PROBE_IDS as readonly string[]).includes(probeId);
}

function isSafeProbePackageVersion(probePackageVersion: string): boolean {
  if (probePackageVersion.trim() !== probePackageVersion) return false;
  if (!probePackageVersion) return false;
  if (probePackageVersion === "." || probePackageVersion === "..") return false;
  if (!SAFE_PACKAGE_VERSION_PATTERN.test(probePackageVersion)) return false;
  if (probePackageVersion.includes("/") || probePackageVersion.includes("\\")) return false;
  return true;
}

function extractRunIdHex(runId: string): string | null {
  const match = RUN_ID_PATTERN.exec(runId);
  return match ? match[1] : null;
}

export function buildG0ObservedRunRecordPath(input: {
  rootDir: string;
  probePackageVersion: string;
  probeId: string;
  runId: string;
}): string {
  if (!isDeclaredProbeId(input.probeId)) {
    throw new Error("unsafe_probe_id");
  }
  if (!isSafeProbePackageVersion(input.probePackageVersion)) {
    throw new Error("unsafe_probe_package_version");
  }
  const runIdHex = extractRunIdHex(input.runId);
  if (!runIdHex) {
    throw new Error("unsafe_run_id");
  }
  const resolvedRootDir = path.resolve(input.rootDir);
  const resolvedReceiptsRoot = path.resolve(resolvedRootDir, "g0-containment", "receipts");
  const destination = path.resolve(
    input.rootDir,
    "g0-containment",
    "receipts",
    input.probePackageVersion,
    input.probeId,
    `${runIdHex}.json`
  );
  const relativeFromReceipts = path.relative(resolvedReceiptsRoot, destination);
  if (
    relativeFromReceipts === "" ||
    relativeFromReceipts.startsWith("..") ||
    path.isAbsolute(relativeFromReceipts)
  ) {
    throw new Error("unsafe_target_path");
  }
  return destination;
}

export async function writeG0ObservedRunRecordImmutable(input: {
  rootDir: string;
  fixtureReceipt: BenchmarkFixtureReceipt;
  record: G0ObservedRunRecord;
}): Promise<{ path: string }> {
  const runMetadataValidation = await validateBenchmarkRunReceiptMetadata(input.record.runMetadata);
  if (!runMetadataValidation.ok) {
    throw new Error(`invalid_run_metadata:${runMetadataValidation.reason}`);
  }
  const recordValidation = await validateG0ObservedRunRecord({
    fixtureReceipt: input.fixtureReceipt,
    record: input.record,
  });
  if (!recordValidation.ok) {
    throw new Error(`invalid_g0_record:${recordValidation.reason}`);
  }

  const destination = buildG0ObservedRunRecordPath({
    rootDir: input.rootDir,
    probePackageVersion: input.record.probePackageVersion,
    probeId: input.record.probeId,
    runId: input.record.runMetadata.runId,
  });

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(input.record, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
  return { path: destination };
}
