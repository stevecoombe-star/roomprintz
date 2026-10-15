import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { publishHarmonizeGenerationHistory, recoverPublishedHarmonizeThumbnail } from "./history-publication.server";
import {
  executeHarmonizeRecoveryAttempt,
  classifyHarmonizeObjectRead,
  type HarmonizeRecoveryRpcResult,
  type HarmonizeRecoveryTask,
} from "./history-recovery";
import { VIBODE_HARMONIZE_BUCKET, VIBODE_HISTORY_BUCKET } from "./policy";

export type HarmonizeRecoveryOnceResult =
  | Readonly<{ outcome: "idle" }>
  | Readonly<{ outcome: "unavailable"; code: string }>
  | Readonly<{
      outcome: "completed" | "failed";
      kind: HarmonizeRecoveryTask["kind"];
      code: string;
      activated: boolean;
      blocked: boolean;
    }>;

/**
 * Claim and run one History publication or thumbnail recovery.
 * Not mounted on the worker loop. Does not claim a generation or contact a provider.
 */
export async function runHarmonizeHistoryRecoveryOnce(
  supabase: SupabaseClient,
): Promise<HarmonizeRecoveryOnceResult> {
  const claimed = await claimRecovery(supabase);
  if (!claimed.ok) return { outcome: "unavailable", code: claimed.code };
  if (!claimed.task) return { outcome: "idle" };
  const task = claimed.task;
  try {
    const attempt = await executeHarmonizeRecoveryAttempt({
      task,
      publishHistory: () => publishHarmonizeGenerationHistory(supabase, task.jobId),
      recoverThumbnail: () => recoverPublishedHarmonizeThumbnail(supabase, task.jobId),
      providerObject: () => readProviderObjectPresence(supabase, task.jobId),
      complete: (nonce) => completeRecovery(supabase, task.jobId, nonce),
      fail: (nonce, code) => failRecovery(supabase, task.jobId, nonce, code),
    });
    console.info("[vibode-harmonize] recovery", {
      jobId: task.jobId,
      kind: attempt.kind,
      action: attempt.action,
      code: attempt.code,
      activated: attempt.activated,
    });
    return {
      outcome: attempt.action === "complete" ? "completed" : "failed",
      kind: attempt.kind,
      code: attempt.code,
      activated: attempt.activated,
      blocked: attempt.rpc.blocked === true,
    };
  } catch {
    await failRecovery(supabase, task.jobId, task.recoveryNonce, "unavailable").catch(() => undefined);
    return { outcome: "unavailable", code: "unavailable" };
  }
}

async function claimRecovery(
  supabase: SupabaseClient,
): Promise<
  | Readonly<{ ok: true; task: HarmonizeRecoveryTask | null }>
  | Readonly<{ ok: false; code: string }>
> {
  const { data, error } = await supabase.rpc("claim_next_vibode_harmonize_history_recovery");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "unavailable" };
  }
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return { ok: false, code: text(row.code) || "unavailable" };
  if (row.task == null) return { ok: true, task: null };
  if (!row.task || typeof row.task !== "object" || Array.isArray(row.task)) {
    return { ok: false, code: "unavailable" };
  }
  const task = row.task as Record<string, unknown>;
  const jobId = text(task.jobId);
  const kind = text(task.kind);
  const recoveryNonce = text(task.recoveryNonce);
  if (!jobId || (kind !== "history" && kind !== "thumbnail") || !recoveryNonce) {
    return { ok: false, code: "unavailable" };
  }
  return { ok: true, task: { jobId, kind, recoveryNonce } };
}

async function completeRecovery(
  supabase: SupabaseClient,
  jobId: string,
  nonce: string,
): Promise<HarmonizeRecoveryRpcResult> {
  return callRecovery(supabase, "complete_vibode_harmonize_history_recovery", {
    p_job_id: jobId,
    p_recovery_nonce: nonce,
  });
}

async function failRecovery(
  supabase: SupabaseClient,
  jobId: string,
  nonce: string,
  code: string,
): Promise<HarmonizeRecoveryRpcResult> {
  return callRecovery(supabase, "fail_vibode_harmonize_history_recovery", {
    p_job_id: jobId,
    p_recovery_nonce: nonce,
    p_code: code,
  });
}

async function callRecovery(
  supabase: SupabaseClient,
  fn: "complete_vibode_harmonize_history_recovery" | "fail_vibode_harmonize_history_recovery",
  args: Readonly<Record<string, string>>,
): Promise<HarmonizeRecoveryRpcResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: "unavailable" };
  }
  const row = data as Record<string, unknown>;
  return {
    ok: row.ok === true,
    code: text(row.code) || "unavailable",
    blocked: row.blocked === true,
  };
}

async function readProviderObjectPresence(
  supabase: SupabaseClient,
  jobId: string,
): Promise<"present" | "absent" | "unavailable"> {
  const { data, error } = await supabase
    .from("vibode_harmonize_generations")
    .select("output_bucket, output_path")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data || typeof data !== "object") return "unavailable";
  const row = data as Record<string, unknown>;
  const bucket = text(row.output_bucket);
  const path = text(row.output_path);
  if ((bucket !== VIBODE_HARMONIZE_BUCKET && bucket !== VIBODE_HISTORY_BUCKET) || !path) return "unavailable";
  try {
    const downloaded = await supabase.storage.from(bucket).download(path);
    if (!downloaded.error && downloaded.data) {
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      return classifyHarmonizeObjectRead(null, bytes.byteLength);
    }
    const statusCode = downloaded.error && "statusCode" in downloaded.error
      ? downloaded.error.statusCode
      : undefined;
    return classifyHarmonizeObjectRead(
      { message: downloaded.error?.message, statusCode },
      null,
    );
  } catch {
    return "unavailable";
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
