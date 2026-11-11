/**
 * Server-controlled Meshy 7.1 generation limits for the first integration.
 *
 * Live generation stays off unless an operator sets the database switch and
 * the process environment is exactly "true". Neither switch is a client flag.
 * There is no user-facing credit wallet. The ceiling is a test budget.
 *
 * Figures follow Meshy pricing and the task lifecycle guide checked
 * 2026-11-06 (docs.meshy.ai, OpenAPI https://docs.meshy.ai/openapi.json).
 */

import { isAdminEmail } from "@/lib/adminAccess";

export const MESHY_PROVIDER_ID = "meshy" as const;

/** Temporary reference photos. Not the personal GLB library bucket. */
export const GENERATION_INPUT_BUCKET = "vibode-furniture-generation-inputs";

export const MESHY_API_ORIGIN = "https://api.meshy.ai";

export const MESHY_ASSET_HOST = "assets.meshy.ai";

export const MESHY_GENERATION_ENABLED_ENV = "VIBODE_MESHY_GENERATION_ENABLED";

/** One in-flight generation for the whole deployment. */
export const MESHY_MAX_CONCURRENT_GENERATIONS = 1;

/**
 * One maximum Meshy 7.1 task: 8K textures (35) plus Ultra geometry (5).
 * The database check rejects a higher ceiling. Raising it needs a new migration.
 */
export const MESHY_TEST_CREDIT_CEILING = 40;

export const MESHY_CREATE_TIMEOUT_MS = 60_000;

export const MESHY_GET_TIMEOUT_MS = 30_000;

export const MESHY_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Docs: poll at Retry-After, otherwise 5 seconds. Polls count as requests. */
export const MESHY_POLL_DEFAULT_MS = 5_000;

/**
 * A create request that times out is not proof the task was not billed.
 * Absence can be confirmed only after this wait and a completed task list.
 */
export const MESHY_ABSENCE_RECONCILE_WAIT_MS = 60_000;

/** Docs: wait at least 60 minutes from created_at before stopping. */
export const MESHY_MIN_OVERALL_WAIT_MS = 60 * 60 * 1000;

export const MESHY_CLAIM_LEASE_MS = 2 * 60 * 1000;

/**
 * A reserved job may still be receiving its private photo. The worker
 * waits this long before treating a missing input as a definite failure.
 * The create request attaches the photo before it returns, so this only
 * covers a worker that starts during that upload.
 */
export const GENERATION_INPUT_UPLOAD_GRACE_MS = 2 * 60 * 1000;

/** Reference photos are temporary. They are not personal furniture assets. */
export const GENERATION_INPUT_TTL_MS = 24 * 60 * 60 * 1000;

/** Private candidate GLBs expire unless a later explicit save copies them. */
export const GENERATION_CANDIDATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Meshy deletes API outputs after at most three days for non-Enterprise accounts. */
export const MESHY_PROVIDER_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * One automatic create. A second POST exists only after an operator
 * accepts the duplicate-charge risk. Meshy has no idempotency key, so a
 * timeout is not proof that the first request created nothing.
 */
export const MESHY_MAX_SUBMIT_ATTEMPTS = 2;

export type GenerationAccess = "ok" | "unauthorized" | "disabled";

/**
 * Non-admins are unauthorized even when both switches are on.
 * Admins see a disabled switch before any job row is created.
 * Unset, "TRUE", "1", and "on" stay off.
 */
export function generationEnabledFromEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[MESHY_GENERATION_ENABLED_ENV] === "true";
}

export function generationAccessDecision(input: Readonly<{
  userId: string | null;
  email: string | null;
  generationEnabledEnv: string | undefined;
  liveEnabled: boolean;
  isAdmin?: (email: string | null | undefined) => boolean;
}>): GenerationAccess {
  const admin = input.isAdmin ?? isAdminEmail;
  if (!input.userId || !admin(input.email)) return "unauthorized";
  if (input.generationEnabledEnv !== "true" || !input.liveEnabled) return "disabled";
  return "ok";
}

export function meshyPollWaitMs(retryAfterHeader: string | null | undefined): number {
  if (!retryAfterHeader) return MESHY_POLL_DEFAULT_MS;
  const seconds = Number(retryAfterHeader.trim());
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) return MESHY_POLL_DEFAULT_MS;
  return Math.round(seconds * 1000);
}
