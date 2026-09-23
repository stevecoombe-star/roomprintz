/**
 * PI-5G3 immutable Partner publish audit records.
 *
 * Successful/noop rows are inserted inside the RPC transaction.
 * Rejected/failed rows are inserted by the server after a closed
 * decision or after RPC rollback. Insert-only; no browser policies.
 */

import { asNonEmptyString, isPlainObject } from "./product-variant-register";

export const STAGE_PARTNER_PUBLISHES_TABLE = "vibode_stage_partner_publishes";
export const PARTNER_PUBLISH_SOURCE = "portal";
export const PARTNER_PUBLISH_MODE = "patch";

export const PARTNER_PUBLISH_AUDIT_STATUSES = Object.freeze([
  "accepted",
  "noop",
  "rejected",
  "failed",
] as const);

export type PartnerPublishAuditStatus = (typeof PARTNER_PUBLISH_AUDIT_STATUSES)[number];

export type PartnerPublishAuditRow = Readonly<{
  publishId: string;
  partnerId: string;
  userId: string | null;
  draftId: string;
  draftRevision: number;
  source: typeof PARTNER_PUBLISH_SOURCE;
  mode: typeof PARTNER_PUBLISH_MODE;
  document: unknown;
  plan: unknown;
  status: PartnerPublishAuditStatus;
  errorCode: string | null;
  errorDetail: unknown;
  baseCatalogHash: string | null;
  prePublishCatalogHash: string | null;
  postPublishCatalogHash: string | null;
  createdAt: string;
}>;

export type PartnerPublishAuditInsert = Readonly<{
  publishId?: string;
  partnerId: string;
  userId: string | null;
  draftId: string;
  draftRevision: number;
  document: unknown;
  plan: unknown;
  status: PartnerPublishAuditStatus;
  errorCode?: string | null;
  errorDetail?: unknown;
  baseCatalogHash: string | null;
  prePublishCatalogHash: string | null;
  postPublishCatalogHash?: string | null;
  createdAt?: string;
}>;

export type PartnerPublishAuditStore = Readonly<{
  findSuccessful(draftId: string, draftRevision: number): Promise<PartnerPublishAuditRow | null>;
  insert(row: PartnerPublishAuditInsert): Promise<
    Readonly<{ ok: true; row: PartnerPublishAuditRow }> | Readonly<{ ok: false; code: "unique_conflict" | "failed" }>
  >;
}>;

function isoNow(): string {
  return new Date().toISOString();
}

function asAuditStatus(value: unknown): PartnerPublishAuditStatus | null {
  if (
    value === "accepted"
    || value === "noop"
    || value === "rejected"
    || value === "failed"
  ) {
    return value;
  }
  return null;
}

function asRevision(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return null;
}

export function mapPartnerPublishAuditRow(row: Record<string, unknown>): PartnerPublishAuditRow | null {
  const publishId = asNonEmptyString(row.publish_id);
  const partnerId = asNonEmptyString(row.partner_id);
  const draftId = asNonEmptyString(row.draft_id);
  const draftRevision = asRevision(row.draft_revision);
  const source = asNonEmptyString(row.source);
  const mode = asNonEmptyString(row.mode);
  const status = asAuditStatus(row.status);
  const createdAt = asNonEmptyString(row.created_at)
    ?? (row.created_at instanceof Date ? row.created_at.toISOString() : null);
  if (
    !publishId
    || !partnerId
    || !draftId
    || draftRevision == null
    || source !== PARTNER_PUBLISH_SOURCE
    || mode !== PARTNER_PUBLISH_MODE
    || !status
    || !createdAt
  ) {
    return null;
  }
  return {
    publishId,
    partnerId,
    userId: asNonEmptyString(row.user_id),
    draftId,
    draftRevision,
    source: PARTNER_PUBLISH_SOURCE,
    mode: PARTNER_PUBLISH_MODE,
    document: row.document,
    plan: row.plan ?? null,
    status,
    errorCode: asNonEmptyString(row.error_code),
    errorDetail: row.error_detail ?? null,
    baseCatalogHash: asNonEmptyString(row.base_catalog_hash),
    prePublishCatalogHash: asNonEmptyString(row.pre_publish_catalog_hash),
    postPublishCatalogHash: asNonEmptyString(row.post_publish_catalog_hash),
    createdAt,
  };
}

export function createMemoryPartnerPublishAuditStore(options: Readonly<{
  now?: () => string;
}> = {}): PartnerPublishAuditStore & { rows: PartnerPublishAuditRow[] } {
  const rows: PartnerPublishAuditRow[] = [];
  const now = options.now ?? isoNow;
  return {
    rows,
    async findSuccessful(draftId, draftRevision) {
      return rows.find((row) => (
        row.draftId === draftId
        && row.draftRevision === draftRevision
        && (row.status === "accepted" || row.status === "noop")
      )) ?? null;
    },
    async insert(input) {
      if (input.status === "accepted" || input.status === "noop") {
        const exists = rows.some((row) => (
          row.draftId === input.draftId
          && row.draftRevision === input.draftRevision
          && (row.status === "accepted" || row.status === "noop")
        ));
        if (exists) return { ok: false, code: "unique_conflict" };
      }
      const row: PartnerPublishAuditRow = {
        publishId: input.publishId ?? `pub-${rows.length + 1}-${input.draftId.slice(0, 8)}`,
        partnerId: input.partnerId,
        userId: input.userId,
        draftId: input.draftId,
        draftRevision: input.draftRevision,
        source: PARTNER_PUBLISH_SOURCE,
        mode: PARTNER_PUBLISH_MODE,
        document: input.document,
        plan: input.plan,
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorDetail: input.errorDetail ?? null,
        baseCatalogHash: input.baseCatalogHash,
        prePublishCatalogHash: input.prePublishCatalogHash,
        postPublishCatalogHash: input.postPublishCatalogHash ?? null,
        createdAt: input.createdAt ?? now(),
      };
      rows.push(row);
      return { ok: true, row };
    },
  };
}

export function persistablePartnerPublishAuditInsert(input: PartnerPublishAuditInsert): Record<string, unknown> {
  return {
    publish_id: input.publishId,
    partner_id: input.partnerId,
    user_id: input.userId,
    draft_id: input.draftId,
    draft_revision: input.draftRevision,
    source: PARTNER_PUBLISH_SOURCE,
    mode: PARTNER_PUBLISH_MODE,
    document: isPlainObject(input.document) ? input.document : {},
    plan: input.plan ?? null,
    status: input.status,
    error_code: input.errorCode ?? null,
    error_detail: input.errorDetail ?? null,
    base_catalog_hash: input.baseCatalogHash,
    pre_publish_catalog_hash: input.prePublishCatalogHash,
    post_publish_catalog_hash: input.postPublishCatalogHash ?? null,
  };
}
