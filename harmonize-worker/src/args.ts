import { isHarmonizeJobId } from "@/lib/vibode-stage/harmonize-jobs/job-id";

export type HarmonizeWorkerSelection =
  | Readonly<{ mode: "continuous" }>
  | Readonly<{ mode: "once"; jobId: string }>;

export function parseHarmonizeWorkerArgs(
  argv: readonly string[],
): Readonly<{ ok: true; selection: HarmonizeWorkerSelection }> | Readonly<{ ok: false; code: "invalid_arguments" | "invalid_job_id" }> {
  if (argv.length === 0) return { ok: true, selection: { mode: "continuous" } };
  let jobId: string | null = null;
  let once = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--once") {
      if (once) return { ok: false, code: "invalid_arguments" };
      once = true;
      continue;
    }
    if (arg === "--job-id") {
      if (jobId !== null) return { ok: false, code: "invalid_arguments" };
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) return { ok: false, code: "invalid_job_id" };
      if (!isHarmonizeJobId(value)) return { ok: false, code: "invalid_job_id" };
      jobId = value.toLowerCase();
      index += 1;
      continue;
    }
    return { ok: false, code: "invalid_arguments" };
  }
  if (once !== (jobId !== null) || !jobId) return { ok: false, code: "invalid_arguments" };
  return { ok: true, selection: { mode: "once", jobId } };
}
