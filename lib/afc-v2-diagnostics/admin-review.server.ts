import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
  type AuthorizeAfcDiagnosticsAdminOptions,
} from "./admin-auth.server";
import {
  parseAfcDiagnosticAdminUuid,
  type AfcDiagnosticAdminCaseDetail,
} from "./admin-read-model";
import {
  AfcDiagnosticAdminInputError,
  AfcDiagnosticAdminNotFoundError,
  AfcDiagnosticAdminStoreError,
  createSupabaseAfcDiagnosticAdminReadStore,
  getAfcDiagnosticAdminCaseDetail,
  type AfcDiagnosticAdminReadStore,
} from "./admin-read-model.server";
import {
  type AfcDiagnosticAwaitableQuery,
  type AfcDiagnosticFilterQuery,
  type AfcDiagnosticSelectHead,
  type AfcDiagnosticTableClient,
} from "./diagnostic-db-client";
import { AFC_DIAGNOSTIC_CASE_TABLE, isAfcDiagnosticReviewStatus } from "./contracts";
import {
  parseAfcDiagnosticAdminReviewPatchRequest,
  planAfcDiagnosticAdminReview,
  type AfcDiagnosticAdminReviewCurrentState,
  type AfcDiagnosticAdminReviewUpdate,
} from "./admin-review";

export const AFC_DIAGNOSTIC_ADMIN_REVIEW_COLUMNS = [
  "review_status",
  "reviewer_user_id",
  "review_notes",
  "reviewed_at",
] as const;

export const AFC_DIAGNOSTIC_ADMIN_REVIEW_SELECT =
  AFC_DIAGNOSTIC_ADMIN_REVIEW_COLUMNS.join(", ");

export class AfcDiagnosticAdminReviewConflictError extends Error {
  readonly code = "illegal_transition" as const;
  constructor() {
    super("Conflict.");
    this.name = "AfcDiagnosticAdminReviewConflictError";
  }
}

export type AfcDiagnosticAdminReviewStore = {
  findCaseReviewById(
    caseId: string,
  ): Promise<AfcDiagnosticAdminReviewCurrentState | null>;
  updateCaseReview(
    caseId: string,
    update: AfcDiagnosticAdminReviewUpdate,
  ): Promise<void>;
};

export type AfcDiagnosticAdminReviewRouteDependencies = Readonly<{
  authorize?: (
    options?: AuthorizeAfcDiagnosticsAdminOptions,
  ) => Promise<AfcDiagnosticsAdminAuth>;
  authorizeOptions?: AuthorizeAfcDiagnosticsAdminOptions;
  reviewStore?: AfcDiagnosticAdminReviewStore;
  readStore?: AfcDiagnosticAdminReadStore;
  getReviewStore?: () => AfcDiagnosticAdminReviewStore | null;
  getReadStore?: () => AfcDiagnosticAdminReadStore | null;
  now?: () => string;
}>;

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) return code;
  if (typeof code === "number") return String(code);
  return undefined;
}

function throwStoreError(error: unknown): never {
  throw new AfcDiagnosticAdminStoreError(postgresCode(error) ?? "unknown");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseReviewRow(
  row: unknown,
): AfcDiagnosticAdminReviewCurrentState | null {
  if (!isRecord(row)) return null;
  if (!isAfcDiagnosticReviewStatus(row.review_status)) return null;
  if (row.reviewer_user_id != null && typeof row.reviewer_user_id !== "string") {
    return null;
  }
  if (row.review_notes != null && typeof row.review_notes !== "string") {
    return null;
  }
  if (row.reviewed_at != null && typeof row.reviewed_at !== "string") {
    return null;
  }
  return Object.freeze({
    reviewStatus: row.review_status,
    reviewerUserId: row.reviewer_user_id
      ? String(row.reviewer_user_id).toLowerCase()
      : null,
    reviewNotes: row.review_notes ?? null,
    reviewedAt: row.reviewed_at ?? null,
  });
}

type AdminReviewFilter<S> = AfcDiagnosticFilterQuery<S, "eq" | "maybeSingle">;
type AdminReviewUpdate<U> = AfcDiagnosticFilterQuery<U, "eq"> &
  AfcDiagnosticAwaitableQuery;

export function createSupabaseAfcDiagnosticAdminReviewStore<
  S extends AdminReviewFilter<S>,
  U extends AdminReviewUpdate<U>,
>(
  supabase: AfcDiagnosticTableClient<
    AfcDiagnosticSelectHead<S> & {
      update(values: Record<string, unknown>): U;
    }
  >,
): AfcDiagnosticAdminReviewStore {
  return {
    async findCaseReviewById(caseId) {
      const { data, error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .select(AFC_DIAGNOSTIC_ADMIN_REVIEW_SELECT)
        .eq("id", caseId)
        .maybeSingle();
      if (error) throwStoreError(error);
      if (data == null) return null;
      const parsed = parseReviewRow(data);
      if (!parsed) throw new AfcDiagnosticAdminStoreError("invalid_row");
      return parsed;
    },

    async updateCaseReview(caseId, update) {
      const payload = {
        review_status: update.review_status,
        reviewer_user_id: update.reviewer_user_id,
        review_notes: update.review_notes,
        reviewed_at: update.reviewed_at,
      };
      const { error } = await supabase
        .from(AFC_DIAGNOSTIC_CASE_TABLE)
        .update(payload)
        .eq("id", caseId);
      if (error) throwStoreError(error);
    },
  };
}

function storesFromEnv(): {
  reviewStore: AfcDiagnosticAdminReviewStore;
  readStore: AfcDiagnosticAdminReadStore;
} {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    throw new AfcDiagnosticAdminStoreError("missing_service_role");
  }
  return {
    reviewStore: createSupabaseAfcDiagnosticAdminReviewStore(supabase),
    readStore: createSupabaseAfcDiagnosticAdminReadStore(supabase),
  };
}

function resolveStores(dependencies: AfcDiagnosticAdminReviewRouteDependencies): {
  reviewStore: AfcDiagnosticAdminReviewStore;
  readStore: AfcDiagnosticAdminReadStore;
} {
  if (dependencies.reviewStore && dependencies.readStore) {
    return {
      reviewStore: dependencies.reviewStore,
      readStore: dependencies.readStore,
    };
  }
  if (dependencies.getReviewStore || dependencies.getReadStore) {
    const reviewStore = dependencies.getReviewStore?.() ?? null;
    const readStore = dependencies.getReadStore?.() ?? null;
    if (!reviewStore || !readStore) {
      throw new AfcDiagnosticAdminStoreError("missing_service_role");
    }
    return { reviewStore, readStore };
  }
  return storesFromEnv();
}

async function authorizeOrReject(
  dependencies: AfcDiagnosticAdminReviewRouteDependencies,
): Promise<AfcDiagnosticsAdminAuth> {
  const authorize = dependencies.authorize ?? authorizeAfcDiagnosticsAdmin;
  return authorize(dependencies.authorizeOptions);
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false };
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

function mapReviewHttpError(error: unknown) {
  if (error instanceof AfcDiagnosticAdminInputError) {
    return afcDiagnosticsAdminJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcDiagnosticAdminNotFoundError) {
    return afcDiagnosticsAdminJson({ error: "Not found." }, 404);
  }
  if (error instanceof AfcDiagnosticAdminReviewConflictError) {
    return afcDiagnosticsAdminJson({ error: "Conflict." }, 409);
  }
  return afcDiagnosticsAdminJson({ error: "Server error." }, 500);
}

export async function handleAfcDiagnosticsAdminCaseReviewPatch(
  args: {
    request: Request;
    caseId: string;
  } & AfcDiagnosticAdminReviewRouteDependencies,
): Promise<Response> {
  try {
    const auth = await authorizeOrReject(args);
    if (!auth.ok) return auth.response;

    const caseId = parseAfcDiagnosticAdminUuid(args.caseId);
    if (!caseId) throw new AfcDiagnosticAdminInputError();

    const raw = await readJsonBody(args.request);
    if (!raw.ok) throw new AfcDiagnosticAdminInputError();
    const parsed = parseAfcDiagnosticAdminReviewPatchRequest(raw.value);
    if (!parsed.ok) throw new AfcDiagnosticAdminInputError();

    const stores = resolveStores(args);
    const current = await stores.reviewStore.findCaseReviewById(caseId);
    if (!current) throw new AfcDiagnosticAdminNotFoundError();

    const plan = planAfcDiagnosticAdminReview({
      current,
      request: parsed.value,
      adminUserId: auth.admin.userId,
      now: (args.now ?? defaultNow)(),
    });
    if (!plan.ok) throw new AfcDiagnosticAdminReviewConflictError();

    if (!plan.noOp) {
      await stores.reviewStore.updateCaseReview(caseId, plan.update);
    }

    const detail: AfcDiagnosticAdminCaseDetail =
      await getAfcDiagnosticAdminCaseDetail(stores.readStore, caseId);
    return afcDiagnosticsAdminJson(detail, 200);
  } catch (error) {
    return mapReviewHttpError(error);
  }
}
