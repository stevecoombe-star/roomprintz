import type {
  HarmonizeHistoryPublicationResult,
  HarmonizeHistoryThumbnailState,
} from "./history-publication";

export type HarmonizeRecoveryKind = "history" | "thumbnail";

export type HarmonizeRecoveryTask = Readonly<{
  jobId: string;
  kind: HarmonizeRecoveryKind;
  recoveryNonce: string;
}>;

export type HarmonizeRecoveryRpcResult = Readonly<{
  ok: boolean;
  code: string;
  blocked?: boolean;
}>;

export type HarmonizeStoredObjectPresence = "present" | "absent" | "unavailable" | "unchecked";

export type HarmonizeRecoverySettlement =
  | Readonly<{ action: "complete"; code: string }>
  | Readonly<{ action: "fail"; code: string }>;

const TRANSIENT_PUBLICATION_CODES = new Set([
  "output_unreadable",
  "unavailable",
  "publication_failed",
]);

/**
 * Confirmed Storage absence is distinct from a temporary read.
 * Anything else keeps the publication code, including the existing
 * terminal publication codes.
 */
export function classifyHarmonizeObjectRead(
  error: Readonly<{ message?: string; statusCode?: string | number }> | null,
  byteLength: number | null,
): Exclude<HarmonizeStoredObjectPresence, "unchecked"> {
  if (!error && byteLength != null && byteLength > 0) return "present";
  const status = error ? String(error.statusCode ?? "") : "";
  const message = error?.message ?? "";
  if (status === "404" || /not found|does not exist|no such object/i.test(message)) return "absent";
  return "unavailable";
}

export function settlementForHistoryPublication(
  published: HarmonizeHistoryPublicationResult,
  providerObject: HarmonizeStoredObjectPresence = "unchecked",
): HarmonizeRecoverySettlement {
  if (published.outcome === "published" || published.outcome === "already_published") {
    return { action: "complete", code: published.code };
  }
  if (
    published.code === "output_unreadable"
    && TRANSIENT_PUBLICATION_CODES.has(published.code)
    && providerObject === "absent"
  ) {
    return { action: "fail", code: "output_absent" };
  }
  return { action: "fail", code: published.code };
}

export function settlementForThumbnail(
  thumbnail: "created" | "present" | "failed",
): HarmonizeRecoverySettlement {
  if (thumbnail === "failed") return { action: "fail", code: "thumbnail_failed" };
  return { action: "complete", code: thumbnail };
}

export type HarmonizeRecoveryAttemptResult = Readonly<{
  kind: HarmonizeRecoveryKind;
  action: "complete" | "fail";
  code: string;
  activated: boolean;
  thumbnail: HarmonizeHistoryThumbnailState | "created" | "present" | "failed";
  rpc: HarmonizeRecoveryRpcResult;
}>;

/**
 * One claimed recovery task. History publication is the existing publisher,
 * once. Thumbnail recovery never calls that publisher. Neither path contacts
 * a provider or claims a generation.
 */
export async function executeHarmonizeRecoveryAttempt(input: Readonly<{
  task: HarmonizeRecoveryTask;
  publishHistory: () => Promise<HarmonizeHistoryPublicationResult>;
  recoverThumbnail: () => Promise<"created" | "present" | "failed">;
  providerObject?: () => Promise<Exclude<HarmonizeStoredObjectPresence, "unchecked">>;
  complete: (nonce: string) => Promise<HarmonizeRecoveryRpcResult>;
  fail: (nonce: string, code: string) => Promise<HarmonizeRecoveryRpcResult>;
}>): Promise<HarmonizeRecoveryAttemptResult> {
  if (input.task.kind === "thumbnail") {
    const thumbnail = await input.recoverThumbnail();
    const settlement = settlementForThumbnail(thumbnail);
    const rpc = settlement.action === "complete"
      ? await input.complete(input.task.recoveryNonce)
      : await input.fail(input.task.recoveryNonce, settlement.code);
    return {
      kind: "thumbnail",
      action: settlement.action,
      code: settlement.code,
      activated: false,
      thumbnail,
      rpc,
    };
  }

  const published = await input.publishHistory();
  let presence: HarmonizeStoredObjectPresence = "unchecked";
  if (published.code === "output_unreadable" && published.outcome !== "published" && input.providerObject) {
    presence = await input.providerObject();
  }
  const settlement = settlementForHistoryPublication(published, presence);
  const rpc = settlement.action === "complete"
    ? await input.complete(input.task.recoveryNonce)
    : await input.fail(input.task.recoveryNonce, settlement.code);
  return {
    kind: "history",
    action: settlement.action,
    code: settlement.code,
    activated: published.activated === true,
    thumbnail: published.thumbnail,
    rpc,
  };
}
