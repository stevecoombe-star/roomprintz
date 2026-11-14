/**
 * Read-only admin dashboard contract for AI furniture generation.
 * Snake_case values come from the database functions. The API and page use
 * camelCase. Storage paths, provider secrets, and task payloads are dropped.
 */

export const FURNITURE_GENERATION_WORKER_STATUS =
  "Worker configuration: Not verified from this application";

export const ADMIN_REQUIRED = "Admin access required.";
export const ADMIN_UNAVAILABLE = "The furniture generation dashboard could not be loaded.";
export const ADMIN_MISCONFIGURED = "Server configuration missing for admin controls.";
export const ADMIN_BAD_REQUEST = "The request could not be read.";
export const ADMIN_JOB_MISSING = "That generation could not be found.";

const LEAK = /users\/|candidate\.glb|msy_|api\.meshy|MESHY_API_KEY|supabase\.co|signed_url|storage_object_path|output_object_path|:\/\//i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFLICT = Symbol("conflict");

const JOB_STATUSES = [
  "reserved",
  "submitting",
  "ambiguous",
  "running",
  "ingesting",
  "ready",
  "needs_review",
  "failed",
  "saved",
  "discarded",
  "expired",
  "cancelled",
] as const;

const OPERATIONS = ["image-to-3d", "multi-image-to-3d"] as const;
const SLOTS = ["front", "left", "right", "back"] as const;
const ALLOWANCE_STATES = ["reserved", "consumed", "released"] as const;
const QUOTA_STATES = ["reserved", "reconciled", "released"] as const;
const PROVIDER_STATUSES = ["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"] as const;
const CREDIT_REVIEWS = ["reported", "unreported", "operator_resolved", "pending", "not_contacted"] as const;
const SAVED_STATES = ["permanently_saved", "candidate_ready", "not_saved"] as const;
const CLASSIFICATIONS = ["individual_beta", "furniture_partner"] as const;
const ALLOWANCE_ACTIONS = ["grant", "adjust", "enable", "disable", "restore", "classify", "reserve", "release", "consume"] as const;
const ACTOR_KINDS = ["administrator", "system"] as const;
const RESUBMIT_ACTIONS = ["authorize", "revoke", "consume"] as const;
const RESUBMIT_REASONS = ["operator_recovery", "submission_budget_exhausted", "submission_committed"] as const;
const RESOLUTION_STATUSES = ["SUCCEEDED", "FAILED", "CANCELED"] as const;

export type GenerationStatus = (typeof JOB_STATUSES)[number];
export type GenerationOperation = (typeof OPERATIONS)[number];
export type GenerationSlot = (typeof SLOTS)[number];
export type AllowanceState = (typeof ALLOWANCE_STATES)[number];
export type CreditReview = (typeof CREDIT_REVIEWS)[number];
export type SavedAssetStatus = (typeof SAVED_STATES)[number];
export type TesterClassification = (typeof CLASSIFICATIONS)[number];
export type AllowanceAction = (typeof ALLOWANCE_ACTIONS)[number];
export type ResubmitAction = (typeof RESUBMIT_ACTIONS)[number];
export type ResubmitReason = (typeof RESUBMIT_REASONS)[number];

export type GenerationProfile = {
  operation: GenerationOperation;
  aiModel: "meshy-7.1";
  geometryResolution: string | null;
  shouldTexture: boolean | null;
  textureModel: string | null;
  textureResolution: string | null;
  enablePbr: boolean | null;
  imageEnhancement: boolean | null;
  shouldRemesh: boolean | null;
  topology: string | null;
  targetPolycount: number | null;
};

export type GenerationJobRecord = {
  jobId: string;
  userId: string;
  createdAt: string;
  status: GenerationStatus;
  operation: GenerationOperation;
  aiModel: "meshy-7.1";
  imageSlots: GenerationSlot[];
  allowanceState: AllowanceState | null;
  reservedCredits: number;
  consumedCredits: number | null;
  quotaState: (typeof QUOTA_STATES)[number];
  errorClass: string | null;
  providerStatus: (typeof PROVIDER_STATUSES)[number] | null;
  providerTaskConfirmed: boolean;
  providerCreditReview: CreditReview;
  savedAssetStatus: SavedAssetStatus;
  unresolved: boolean;
  profile: GenerationProfile;
};

export type AllowanceEventRecord = {
  eventId: string;
  action: AllowanceAction;
  reason: string | null;
  actorKind: (typeof ACTOR_KINDS)[number];
  actorUserId: string | null;
  deltaAuthorized: number;
  deltaReserved: number;
  deltaConsumed: number;
  jobId: string | null;
  createdAt: string;
  classificationBefore: TesterClassification | null;
  classificationAfter: TesterClassification | null;
  enabledBefore: boolean | null;
  enabledAfter: boolean | null;
};

export type ResubmitEventRecord = {
  eventId: string;
  action: ResubmitAction;
  reason: ResubmitReason;
  jobId: string;
  createdAt: string;
};

export type CreditResolutionRecord = {
  jobId: string;
  providerStatus: (typeof RESOLUTION_STATUSES)[number];
  consumedCredits: number;
  reason: string | null;
  createdAt: string;
};

export type DeletedAccountAudit = {
  userId: string;
  allowanceEvents: number;
  resubmitEvents: number;
  creditResolutions: number;
};

export type SqlOverview = {
  approvedAccounts: number;
  enabledAccounts: number;
  authorizedGenerations: number;
  reservedGenerations: number;
  consumedGenerations: number;
  remainingGenerations: number;
  paidSubmissionsAuthorized: number;
  paidSubmissionsUsed: number;
  confirmedProviderTasks: number;
  usableCandidates: number;
  permanentlySavedModels: number;
  providerFailures: number;
  creditsReserved: number;
  creditsConsumed: number;
  creditCeiling: number;
  remainingCreditBudget: number;
  unresolvedProviderCreditExposure: number;
  liveEnabled: boolean;
  maxConcurrent: number;
  deletedAccountAuditEvents: number;
  deletedAccountAudits: DeletedAccountAudit[];
  historicalJobsWithoutAllowance: number;
  historicalJobs: GenerationJobRecord[];
};

export type DashboardOverview = SqlOverview & {
  generationAdmissionEnabled: boolean;
  workerConfiguration: typeof FURNITURE_GENERATION_WORKER_STATUS;
};

export type BetaTesterRecord = {
  userId: string;
  email: string | null;
  classification: TesterClassification;
  enabled: boolean;
  authorizedGenerations: number;
  reservedGenerations: number;
  consumedGenerations: number;
  remainingGenerations: number;
  updatedAt: string;
};

export type TesterPage = {
  total: number;
  limit: number;
  offset: number;
  testers: BetaTesterRecord[];
};

export type TesterJobPage = {
  userId: string;
  email: string | null;
  approved: boolean;
  total: number;
  limit: number;
  offset: number;
  jobs: GenerationJobRecord[];
  allowanceEvents: AllowanceEventRecord[];
  resubmitEvents: ResubmitEventRecord[];
  creditResolutions: CreditResolutionRecord[];
};

export type JobDetailRecord = {
  job: GenerationJobRecord | null;
  allowanceEvents: AllowanceEventRecord[];
  resubmitEvents: ResubmitEventRecord[];
  creditResolution: CreditResolutionRecord | null;
};

export type AdminReadName =
  | "read_vibode_furniture_generation_admin_overview"
  | "read_vibode_furniture_generation_admin_testers"
  | "read_vibode_furniture_generation_admin_jobs"
  | "read_vibode_furniture_generation_admin_job";

export type AdminReadClient = {
  rpc: (
    fn: AdminReadName,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export type AdminReadResult = {
  status: number;
  body: Record<string, unknown>;
};

const READ_FUNCTIONS = new Set<string>([
  "read_vibode_furniture_generation_admin_overview",
  "read_vibode_furniture_generation_admin_testers",
  "read_vibode_furniture_generation_admin_jobs",
  "read_vibode_furniture_generation_admin_job",
]);

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export function adminReadGateway(client: RpcClient | null): AdminReadClient | null {
  if (!client) return null;
  return {
    async rpc(fn, args) {
      if (!READ_FUNCTIONS.has(fn)) return { data: null, error: { message: "rpc_failed" } };
      const { data, error } = await client.rpc(fn, args);
      if (error || data == null) return { data: null, error: { message: "rpc_failed" } };
      return { data, error: null };
    },
  };
}

export function withProductionStatus(
  overview: SqlOverview,
  generationAdmissionEnabled: boolean,
): DashboardOverview {
  return {
    ...overview,
    generationAdmissionEnabled,
    workerConfiguration: FURNITURE_GENERATION_WORKER_STATUS,
  };
}

export function readAdminError(value: unknown): string {
  if (!value || typeof value !== "object" || !("error" in value)) return ADMIN_UNAVAILABLE;
  const error = (value as { error: unknown }).error;
  if (typeof error !== "string" || error.length === 0 || error.length > 200 || LEAK.test(error)) {
    return ADMIN_UNAVAILABLE;
  }
  return error;
}

export function readAdminAccountFilter(value: string | null): string | null {
  if (value == null) return "";
  const query = value.trim().toLowerCase();
  if (query.length > 200 || /[\u0000-\u001f]/.test(query)) return null;
  return query;
}

export function readAdminPage(
  limitValue: string | null,
  offsetValue: string | null,
  defaultLimit: number,
): { limit: number; offset: number } | null {
  const limit = limitValue == null || limitValue.trim() === "" ? defaultLimit : readPageNumber(limitValue, 1, 10_000);
  const offset = offsetValue == null || offsetValue.trim() === "" ? 0 : readPageNumber(offsetValue, 0, 100_000);
  if (limit == null || offset == null) return null;
  return { limit: Math.min(limit, 50), offset };
}

export async function furnitureGenerationOverviewResponse(deps: {
  getAdmin: () => Promise<unknown>;
  getServiceClient: () => AdminReadClient | null;
  generationAdmissionEnabled: boolean;
}): Promise<AdminReadResult> {
  const admin = await deps.getAdmin();
  if (!admin || typeof admin !== "object") return errorResult(403, ADMIN_REQUIRED);
  const client = deps.getServiceClient();
  if (!client) return errorResult(500, ADMIN_MISCONFIGURED);
  const read = await client.rpc("read_vibode_furniture_generation_admin_overview");
  if (read.error) return errorResult(500, ADMIN_UNAVAILABLE);
  const outcome = readOutcome(read.data);
  if (outcome !== "ready") return errorResult(500, ADMIN_UNAVAILABLE);
  const overview = parseSqlOverview(read.data);
  if (!overview) return errorResult(500, ADMIN_UNAVAILABLE);
  return { status: 200, body: successBody(withProductionStatus(overview, deps.generationAdmissionEnabled)) };
}

export async function furnitureGenerationTestersResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    getServiceClient: () => AdminReadClient | null;
  },
  searchParams: URLSearchParams,
): Promise<AdminReadResult> {
  const admin = await deps.getAdmin();
  if (!admin || typeof admin !== "object") return errorResult(403, ADMIN_REQUIRED);
  const query = readAdminAccountFilter(searchParams.get("q"));
  const page = readAdminPage(searchParams.get("limit"), searchParams.get("offset"), 25);
  if (query == null || !page) return errorResult(400, ADMIN_BAD_REQUEST);
  const client = deps.getServiceClient();
  if (!client) return errorResult(500, ADMIN_MISCONFIGURED);
  const read = await client.rpc("read_vibode_furniture_generation_admin_testers", {
    p_query: query,
    p_limit: page.limit,
    p_offset: page.offset,
  });
  if (read.error) return errorResult(500, ADMIN_UNAVAILABLE);
  return mapParsed(read.data, parseTesterPage, 400);
}

export async function furnitureGenerationJobsResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    getServiceClient: () => AdminReadClient | null;
  },
  userId: string,
  searchParams: URLSearchParams,
): Promise<AdminReadResult> {
  const admin = await deps.getAdmin();
  if (!admin || typeof admin !== "object") return errorResult(403, ADMIN_REQUIRED);
  if (!UUID.test(userId)) return errorResult(400, ADMIN_BAD_REQUEST);
  const page = readAdminPage(searchParams.get("limit"), searchParams.get("offset"), 25);
  if (!page) return errorResult(400, ADMIN_BAD_REQUEST);
  const client = deps.getServiceClient();
  if (!client) return errorResult(500, ADMIN_MISCONFIGURED);
  const read = await client.rpc("read_vibode_furniture_generation_admin_jobs", {
    p_user_id: userId.toLowerCase(),
    p_limit: page.limit,
    p_offset: page.offset,
  });
  if (read.error) return errorResult(500, ADMIN_UNAVAILABLE);
  const parsed = mapParsed(read.data, parseTesterJobs, 400);
  if (parsed.status === 200 && parsed.body.userId !== userId.toLowerCase()) {
    return errorResult(500, ADMIN_UNAVAILABLE);
  }
  return parsed;
}

export async function furnitureGenerationJobResponse(
  deps: {
    getAdmin: () => Promise<unknown>;
    getServiceClient: () => AdminReadClient | null;
  },
  jobId: string,
): Promise<AdminReadResult> {
  const admin = await deps.getAdmin();
  if (!admin || typeof admin !== "object") return errorResult(403, ADMIN_REQUIRED);
  if (!UUID.test(jobId)) return errorResult(400, ADMIN_BAD_REQUEST);
  const client = deps.getServiceClient();
  if (!client) return errorResult(500, ADMIN_MISCONFIGURED);
  const read = await client.rpc("read_vibode_furniture_generation_admin_job", {
    p_job_id: jobId.toLowerCase(),
  });
  if (read.error) return errorResult(500, ADMIN_UNAVAILABLE);
  return mapParsed(read.data, parseJobDetail, 404);
}

export function parseSqlOverview(value: unknown): SqlOverview | null {
  const body = asObject(value);
  if (!body || body.ok !== true) return null;
  const approvedAccounts = readCount(readField(body, "approved_accounts", "approvedAccounts"));
  const enabledAccounts = readCount(readField(body, "enabled_accounts", "enabledAccounts"));
  const authorizedGenerations = readCount(readField(body, "authorized_generations", "authorizedGenerations"));
  const reservedGenerations = readCount(readField(body, "reserved_generations", "reservedGenerations"));
  const consumedGenerations = readCount(readField(body, "consumed_generations", "consumedGenerations"));
  const remainingGenerations = readCount(readField(body, "remaining_generations", "remainingGenerations"));
  const paidSubmissionsAuthorized = readCount(readField(body, "paid_submissions_authorized", "paidSubmissionsAuthorized"));
  const paidSubmissionsUsed = readCount(readField(body, "paid_submissions_used", "paidSubmissionsUsed"));
  const confirmedProviderTasks = readCount(readField(body, "confirmed_provider_tasks", "confirmedProviderTasks"));
  const usableCandidates = readCount(readField(body, "usable_candidates", "usableCandidates"));
  const permanentlySavedModels = readCount(readField(body, "permanently_saved_models", "permanentlySavedModels"));
  const providerFailures = readCount(readField(body, "provider_failures", "providerFailures"));
  const creditsReserved = readCount(readField(body, "credits_reserved", "creditsReserved"));
  const creditsConsumed = readCount(readField(body, "credits_consumed", "creditsConsumed"));
  const creditCeiling = readCount(readField(body, "credit_ceiling", "creditCeiling"));
  const remainingCreditBudget = readSignedInt(readField(body, "remaining_credit_budget", "remainingCreditBudget"));
  const unresolvedProviderCreditExposure = readCount(
    readField(body, "unresolved_provider_credit_exposure", "unresolvedProviderCreditExposure"),
  );
  const liveEnabled = readBool(readField(body, "live_enabled", "liveEnabled"));
  const maxConcurrent = readCount(readField(body, "max_concurrent", "maxConcurrent"));
  const deletedAccountAuditEvents = readCount(readField(body, "deleted_account_audit_events", "deletedAccountAuditEvents"));
  const historicalJobsWithoutAllowance = readCount(
    readField(body, "historical_jobs_without_allowance", "historicalJobsWithoutAllowance"),
  );
  if (
    approvedAccounts == null || enabledAccounts == null || authorizedGenerations == null || reservedGenerations == null
    || consumedGenerations == null || remainingGenerations == null || paidSubmissionsAuthorized == null
    || paidSubmissionsUsed == null || confirmedProviderTasks == null || usableCandidates == null
    || permanentlySavedModels == null || providerFailures == null || creditsReserved == null || creditsConsumed == null
    || creditCeiling == null || remainingCreditBudget == null || unresolvedProviderCreditExposure == null
    || liveEnabled == null || maxConcurrent == null || deletedAccountAuditEvents == null
    || historicalJobsWithoutAllowance == null
  ) {
    return null;
  }
  if (enabledAccounts > approvedAccounts || paidSubmissionsUsed > paidSubmissionsAuthorized) return null;
  if (remainingGenerations !== authorizedGenerations - reservedGenerations - consumedGenerations) return null;
  if (remainingCreditBudget !== creditCeiling - creditsReserved - creditsConsumed) return null;
  const deletedAccountAudits = readArray(readField(body, "deleted_account_audits", "deletedAccountAudits"), 20)
    .map(parseDeletedAudit)
    .filter((item): item is DeletedAccountAudit => item != null);
  const historicalJobs = readArray(readField(body, "historical_jobs", "historicalJobs"), 20)
    .map(parseJob)
    .filter((item): item is GenerationJobRecord => item != null);
  const listedEvents = deletedAccountAudits.reduce(
    (sum, item) => sum + item.allowanceEvents + item.resubmitEvents + item.creditResolutions,
    0,
  );
  if (deletedAccountAuditEvents < listedEvents || historicalJobsWithoutAllowance < historicalJobs.length) return null;
  return {
    approvedAccounts,
    enabledAccounts,
    authorizedGenerations,
    reservedGenerations,
    consumedGenerations,
    remainingGenerations,
    paidSubmissionsAuthorized,
    paidSubmissionsUsed,
    confirmedProviderTasks,
    usableCandidates,
    permanentlySavedModels,
    providerFailures,
    creditsReserved,
    creditsConsumed,
    creditCeiling,
    remainingCreditBudget,
    unresolvedProviderCreditExposure,
    liveEnabled,
    maxConcurrent,
    deletedAccountAuditEvents,
    deletedAccountAudits,
    historicalJobsWithoutAllowance,
    historicalJobs,
  };
}

export function parseDashboardOverview(value: unknown): DashboardOverview | null {
  const overview = parseSqlOverview(value);
  const body = asObject(value);
  if (!overview || !body) return null;
  const generationAdmissionEnabled = readBool(body.generationAdmissionEnabled);
  if (generationAdmissionEnabled == null || body.workerConfiguration !== FURNITURE_GENERATION_WORKER_STATUS) return null;
  return {
    ...overview,
    generationAdmissionEnabled,
    workerConfiguration: FURNITURE_GENERATION_WORKER_STATUS,
  };
}

export function parseTesterPage(value: unknown): TesterPage | null {
  const body = asObject(value);
  if (!body || body.ok !== true) return null;
  const total = readCount(readField(body, "total", "total"));
  const limit = readCount(readField(body, "limit", "limit"));
  const offset = readCount(readField(body, "offset", "offset"));
  if (total == null || limit == null || offset == null || limit < 1 || limit > 50) return null;
  const testers = readArray(readField(body, "testers", "testers"), 50)
    .map(parseBetaTester)
    .filter((item): item is BetaTesterRecord => item != null);
  if (total < testers.length) return null;
  return { total, limit, offset, testers };
}

export function parseTesterJobs(value: unknown): TesterJobPage | null {
  const body = asObject(value);
  if (!body || body.ok !== true) return null;
  const userId = readUuid(readField(body, "user_id", "userId"));
  const approved = readBool(readField(body, "approved", "approved"));
  const total = readCount(readField(body, "total", "total"));
  const limit = readCount(readField(body, "limit", "limit"));
  const offset = readCount(readField(body, "offset", "offset"));
  if (!userId || approved == null || total == null || limit == null || offset == null || limit < 1 || limit > 50) {
    return null;
  }
  const jobs = readArray(readField(body, "jobs", "jobs"), 50)
    .map(parseJob)
    .filter((item): item is GenerationJobRecord => item != null && item.userId === userId);
  if (total < jobs.length) return null;
  return {
    userId,
    email: readEmail(readField(body, "email", "email")),
    approved,
    total,
    limit,
    offset,
    jobs,
    allowanceEvents: readEvents(body, "allowance_events", "allowanceEvents", parseAllowanceEvent),
    resubmitEvents: readEvents(body, "resubmit_events", "resubmitEvents", parseResubmitEvent),
    creditResolutions: readEvents(body, "credit_resolutions", "creditResolutions", parseCreditResolution),
  };
}

export function parseJobDetail(value: unknown): JobDetailRecord | null {
  const body = asObject(value);
  if (!body || body.ok !== true) return null;
  const jobValue = readField(body, "job", "job");
  const job = jobValue == null ? null : parseJob(jobValue);
  if (jobValue != null && !job) return null;
  const allowanceEvents = readEvents(body, "allowance_events", "allowanceEvents", parseAllowanceEvent);
  const resubmitEvents = readEvents(body, "resubmit_events", "resubmitEvents", parseResubmitEvent);
  const creditValue = readField(body, "credit_resolution", "creditResolution");
  const creditResolution = creditValue == null ? null : parseCreditResolution(creditValue);
  if (creditValue != null && !creditResolution) return null;
  if (!job && allowanceEvents.length === 0 && resubmitEvents.length === 0 && !creditResolution) return null;
  return { job, allowanceEvents, resubmitEvents, creditResolution };
}

function mapParsed<T extends object>(
  value: unknown,
  parse: (input: unknown) => T | null,
  invalidStatus: 400 | 404,
): AdminReadResult {
  const outcome = readOutcome(value);
  if (outcome === "not_found") return errorResult(404, ADMIN_JOB_MISSING);
  if (outcome === "invalid") return errorResult(invalidStatus, invalidStatus === 404 ? ADMIN_JOB_MISSING : ADMIN_BAD_REQUEST);
  if (outcome !== "ready") return errorResult(500, ADMIN_UNAVAILABLE);
  const parsed = parse(value);
  if (!parsed) return errorResult(500, ADMIN_UNAVAILABLE);
  return { status: 200, body: successBody(parsed) };
}

function readOutcome(value: unknown): "ready" | "not_found" | "invalid" | "unreadable" {
  const body = asObject(value);
  if (!body) return "unreadable";
  if (body.ok === false) {
    if (body.code === "not_found") return "not_found";
    if (body.code === "invalid") return "invalid";
    return "unreadable";
  }
  return body.ok === true ? "ready" : "unreadable";
}

function parseDeletedAudit(value: unknown): DeletedAccountAudit | null {
  const body = asObject(value);
  if (!body) return null;
  const userId = readUuid(readField(body, "user_id", "userId"));
  const allowanceEvents = readCount(readField(body, "allowance_events", "allowanceEvents"));
  const resubmitEvents = readCount(readField(body, "resubmit_events", "resubmitEvents"));
  const creditResolutions = readCount(readField(body, "credit_resolutions", "creditResolutions"));
  if (!userId || allowanceEvents == null || resubmitEvents == null || creditResolutions == null) return null;
  return { userId, allowanceEvents, resubmitEvents, creditResolutions };
}

export function parseBetaTester(value: unknown): BetaTesterRecord | null {
  const body = asObject(value);
  if (!body) return null;
  const userId = readUuid(readField(body, "user_id", "userId"));
  const classification = readChoice(readField(body, "classification", "classification"), CLASSIFICATIONS);
  const enabled = readBool(readField(body, "enabled", "enabled"));
  const authorizedGenerations = readCount(readField(body, "authorized_generations", "authorizedGenerations"));
  const reservedGenerations = readCount(readField(body, "reserved_generations", "reservedGenerations"));
  const consumedGenerations = readCount(readField(body, "consumed_generations", "consumedGenerations"));
  const remainingGenerations = readCount(readField(body, "remaining_generations", "remainingGenerations"));
  const updatedAt = readTimestamp(readField(body, "updated_at", "updatedAt"));
  if (
    !userId || !classification || enabled == null || authorizedGenerations == null || reservedGenerations == null
    || consumedGenerations == null || remainingGenerations == null || !updatedAt
  ) {
    return null;
  }
  if (remainingGenerations !== authorizedGenerations - reservedGenerations - consumedGenerations) return null;
  if (reservedGenerations + consumedGenerations > authorizedGenerations) return null;
  return {
    userId,
    email: readEmail(readField(body, "email", "email")),
    classification,
    enabled,
    authorizedGenerations,
    reservedGenerations,
    consumedGenerations,
    remainingGenerations,
    updatedAt,
  };
}

function parseJob(value: unknown): GenerationJobRecord | null {
  const body = asObject(value);
  if (!body) return null;
  const jobId = readUuid(readField(body, "job_id", "jobId"));
  const userId = readUuid(readField(body, "user_id", "userId"));
  const createdAt = readTimestamp(readField(body, "created_at", "createdAt"));
  const status = readChoice(readField(body, "status", "status"), JOB_STATUSES);
  const operation = readChoice(readField(body, "operation", "operation"), OPERATIONS);
  const aiModel = readField(body, "ai_model", "aiModel") === "meshy-7.1" ? "meshy-7.1" : null;
  const allowanceValue = readField(body, "allowance_state", "allowanceState");
  const allowanceState = allowanceValue == null ? null : readChoice(allowanceValue, ALLOWANCE_STATES);
  const reservedCredits = readCount(readField(body, "reserved_credits", "reservedCredits"));
  const consumedValue = readField(body, "consumed_credits", "consumedCredits");
  const consumedCredits = consumedValue == null ? null : readCount(consumedValue);
  const quotaState = readChoice(readField(body, "quota_state", "quotaState"), QUOTA_STATES);
  const providerValue = readField(body, "provider_status", "providerStatus");
  const providerStatus = providerValue == null ? null : readChoice(providerValue, PROVIDER_STATUSES);
  const providerTaskConfirmed = readBool(readField(body, "provider_task_confirmed", "providerTaskConfirmed"));
  const providerCreditReview = readChoice(readField(body, "provider_credit_review", "providerCreditReview"), CREDIT_REVIEWS);
  const savedAssetStatus = readChoice(readField(body, "saved_asset_status", "savedAssetStatus"), SAVED_STATES);
  const unresolvedValue = readField(body, "unresolved", "unresolved");
  // `false OR (null IN (...))` is null when error_class is null and the job is resolved.
  const unresolved = unresolvedValue === null ? false : readBool(unresolvedValue);
  const profile = parseProfile(readField(body, "profile", "profile"), operation, aiModel);
  if (
    !jobId || !userId || !createdAt || !status || !operation || !aiModel || allowanceValue !== null && !allowanceState
    || reservedCredits == null || (consumedValue != null && consumedCredits == null) || !quotaState
    || (providerValue != null && !providerStatus) || providerTaskConfirmed == null || !providerCreditReview
    || !savedAssetStatus || unresolved == null || !profile
  ) {
    return null;
  }
  return {
    jobId,
    userId,
    createdAt,
    status,
    operation,
    aiModel,
    imageSlots: readSlots(readField(body, "image_slots", "imageSlots")),
    allowanceState,
    reservedCredits,
    consumedCredits,
    quotaState,
    errorClass: readToken(readField(body, "error_class", "errorClass"), 80),
    providerStatus,
    providerTaskConfirmed,
    providerCreditReview,
    savedAssetStatus,
    unresolved,
    profile,
  };
}

function parseProfile(
  value: unknown,
  operation: GenerationOperation | null,
  aiModel: "meshy-7.1" | null,
): GenerationProfile | null {
  const body = asObject(value);
  if (!body || !operation || !aiModel) return null;
  const profileOperation = readChoice(readField(body, "operation", "operation"), OPERATIONS);
  const profileModel = readField(body, "ai_model", "aiModel") === "meshy-7.1" ? "meshy-7.1" : null;
  if (profileOperation !== operation || profileModel !== aiModel) return null;
  const target = readField(body, "target_polycount", "targetPolycount");
  const targetPolycount = target == null ? null : readCount(target);
  if (target != null && (targetPolycount == null || targetPolycount > 1_000_000)) return null;
  return {
    operation,
    aiModel,
    geometryResolution: readPlainText(readField(body, "geometry_resolution", "geometryResolution"), 40),
    shouldTexture: readOptionalBool(readField(body, "should_texture", "shouldTexture")),
    textureModel: readPlainText(readField(body, "texture_model", "textureModel"), 40),
    textureResolution: readPlainText(readField(body, "texture_resolution", "textureResolution"), 40),
    enablePbr: readOptionalBool(readField(body, "enable_pbr", "enablePbr")),
    imageEnhancement: readOptionalBool(readField(body, "image_enhancement", "imageEnhancement")),
    shouldRemesh: readOptionalBool(readField(body, "should_remesh", "shouldRemesh")),
    topology: readPlainText(readField(body, "topology", "topology"), 40),
    targetPolycount,
  };
}

function parseAllowanceEvent(value: unknown): AllowanceEventRecord | null {
  const body = asObject(value);
  if (!body) return null;
  const eventId = readUuid(readField(body, "event_id", "eventId"));
  const action = readChoice(readField(body, "action", "action"), ALLOWANCE_ACTIONS);
  const actorKind = readChoice(readField(body, "actor_kind", "actorKind"), ACTOR_KINDS);
  const actorValue = readField(body, "actor_user_id", "actorUserId");
  const actorUserId = actorValue == null ? null : readUuid(actorValue);
  const deltaAuthorized = readSignedInt(readField(body, "delta_authorized", "deltaAuthorized"));
  const deltaReserved = readSignedInt(readField(body, "delta_reserved", "deltaReserved"));
  const deltaConsumed = readCount(readField(body, "delta_consumed", "deltaConsumed"));
  const jobValue = readField(body, "job_id", "jobId");
  const jobId = jobValue == null ? null : readUuid(jobValue);
  const createdAt = readTimestamp(readField(body, "created_at", "createdAt"));
  if (
    !eventId || !action || !actorKind || (actorValue != null && !actorUserId) || deltaAuthorized == null
    || deltaReserved == null || deltaConsumed == null || (jobValue != null && !jobId) || !createdAt
    || deltaAuthorized < -50 || deltaAuthorized > 50 || deltaReserved < -50 || deltaReserved > 50
    || deltaConsumed > 50
  ) {
    return null;
  }
  return {
    eventId,
    action,
    reason: readPlainText(readField(body, "reason", "reason"), 200),
    actorKind,
    actorUserId,
    deltaAuthorized,
    deltaReserved,
    deltaConsumed,
    jobId,
    createdAt,
    classificationBefore: readClassification(readField(body, "classification_before", "classificationBefore")),
    classificationAfter: readClassification(readField(body, "classification_after", "classificationAfter")),
    enabledBefore: readOptionalBool(readField(body, "enabled_before", "enabledBefore")),
    enabledAfter: readOptionalBool(readField(body, "enabled_after", "enabledAfter")),
  };
}

function parseResubmitEvent(value: unknown): ResubmitEventRecord | null {
  const body = asObject(value);
  if (!body) return null;
  const eventId = readUuid(readField(body, "event_id", "eventId"));
  const action = readChoice(readField(body, "action", "action"), RESUBMIT_ACTIONS);
  const reason = readChoice(readField(body, "reason", "reason"), RESUBMIT_REASONS);
  const jobId = readUuid(readField(body, "job_id", "jobId"));
  const createdAt = readTimestamp(readField(body, "created_at", "createdAt"));
  if (!eventId || !action || !reason || !jobId || !createdAt) return null;
  return { eventId, action, reason, jobId, createdAt };
}

function parseCreditResolution(value: unknown): CreditResolutionRecord | null {
  const body = asObject(value);
  if (!body) return null;
  const jobId = readUuid(readField(body, "job_id", "jobId"));
  const providerStatus = readChoice(readField(body, "provider_status", "providerStatus"), RESOLUTION_STATUSES);
  const consumedCredits = readCount(readField(body, "consumed_credits", "consumedCredits"));
  const createdAt = readTimestamp(readField(body, "created_at", "createdAt"));
  if (!jobId || !providerStatus || consumedCredits == null || consumedCredits > 1000 || !createdAt) return null;
  return {
    jobId,
    providerStatus,
    consumedCredits,
    reason: readPlainText(readField(body, "reason", "reason"), 200),
    createdAt,
  };
}

function readEvents<T>(
  body: Record<string, unknown>,
  snake: string,
  camel: string,
  parse: (value: unknown) => T | null,
): T[] {
  return readArray(readField(body, snake, camel), 50)
    .map(parse)
    .filter((item): item is T => item != null);
}

function readSlots(value: unknown): GenerationSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: GenerationSlot[] = [];
  for (const item of value) {
    if (!SLOTS.includes(item as GenerationSlot)) return [];
    slots.push(item as GenerationSlot);
  }
  return slots;
}

function readArray(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max);
}

function readChoice<T extends string>(value: unknown, choices: readonly T[]): T | null {
  return typeof value === "string" && choices.includes(value as T) ? value as T : null;
}

function readClassification(value: unknown): TesterClassification | null {
  if (value == null) return null;
  return readChoice(value, CLASSIFICATIONS);
}

function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000_000) return null;
  return value;
}

function readSignedInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -1_000_000_000 || value > 1_000_000_000) {
    return null;
  }
  return value;
}

function readBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readOptionalBool(value: unknown): boolean | null {
  if (value == null) return null;
  return typeof value === "boolean" ? value : null;
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value.toLowerCase();
}

function readEmail(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || LEAK.test(email) || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || LEAK.test(value) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return null;
  }
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function readToken(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > max || !/^[a-z0-9_]+$/.test(token) || LEAK.test(token)) return null;
  return token;
}

function readPlainText(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || LEAK.test(text)) return null;
  return text;
}

function readPageNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function readField(source: Record<string, unknown>, snake: string, camel: string): unknown {
  const hasSnake = Object.prototype.hasOwnProperty.call(source, snake);
  const hasCamel = Object.prototype.hasOwnProperty.call(source, camel);
  if (hasSnake && hasCamel) {
    return Object.is(source[snake], source[camel]) ? source[camel] : CONFLICT;
  }
  if (hasCamel) return source[camel];
  if (hasSnake) return source[snake];
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function successBody(value: object): Record<string, unknown> {
  return jsonBody({ ...value, ok: true });
}

function jsonBody(value: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function errorResult(status: number, error: string): AdminReadResult {
  return { status, body: { error } };
}
