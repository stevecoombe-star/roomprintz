export type PartnerSyncDocumentRegistration = Readonly<{
  batchId: string;
  jsonRelativePath: string;
  sqlSlug: string;
}>;

export const PI5F3A_SYNC_BATCH_ID = "demo-furniture-co-pi5f3a-commercial";
export const PI5F3A_SYNC_SQL_SLUG = "demo_furniture_co_pi5f3a_commercial";
export const PI5F3A_SYNC_JSON_RELATIVE_PATH =
  "lib/vibode-stage/partners/demo-furniture-co/pi5f3a-commercial-update/partner-sync.json";
export const PI5F3A_SYNC_MIGRATION_TIMESTAMP = "20260915120000";

export const PI5F3B_SYNC_BATCH_ID = "demo-furniture-co-pi5f3b-deactivation";
export const PI5F3B_SYNC_SQL_SLUG = "demo_furniture_co_pi5f3b_deactivation";
export const PI5F3B_SYNC_JSON_RELATIVE_PATH =
  "lib/vibode-stage/partners/demo-furniture-co/pi5f3b-deactivation/partner-sync.json";
export const PI5F3B_SYNC_MIGRATION_TIMESTAMP = "20260915140000";
export const PI5F3B_VARIANT_STATUS_MIGRATION_TIMESTAMP = "20260915130000";
export const PI5F3B_VARIANT_STATUS_MIGRATION_FILE =
  `${PI5F3B_VARIANT_STATUS_MIGRATION_TIMESTAMP}_vibode_stage_variants_status.sql`;

export const PI5F3C_SYNC_BATCH_ID = "demo-furniture-co-pi5f3c-full-snapshot";
export const PI5F3C_SYNC_SQL_SLUG = "demo_furniture_co_pi5f3c_full_snapshot";
export const PI5F3C_SYNC_JSON_RELATIVE_PATH =
  "lib/vibode-stage/partners/demo-furniture-co/pi5f3c-full-snapshot/partner-sync.json";
export const PI5F3C_SYNC_MIGRATION_TIMESTAMP = "20260915150000";

/**
 * Canonical partner catalog sync patches. Drift maps each registered
 * document to one partner_sync SQL artifact by sqlSlug, not by
 * timestamp. Do not mix these into PARTNER_CATALOG_DOCUMENTS.
 */
export const PARTNER_SYNC_DOCUMENTS: readonly PartnerSyncDocumentRegistration[] = Object.freeze([
  Object.freeze({
    batchId: PI5F3A_SYNC_BATCH_ID,
    jsonRelativePath: PI5F3A_SYNC_JSON_RELATIVE_PATH,
    sqlSlug: PI5F3A_SYNC_SQL_SLUG,
  }),
  Object.freeze({
    batchId: PI5F3B_SYNC_BATCH_ID,
    jsonRelativePath: PI5F3B_SYNC_JSON_RELATIVE_PATH,
    sqlSlug: PI5F3B_SYNC_SQL_SLUG,
  }),
  Object.freeze({
    batchId: PI5F3C_SYNC_BATCH_ID,
    jsonRelativePath: PI5F3C_SYNC_JSON_RELATIVE_PATH,
    sqlSlug: PI5F3C_SYNC_SQL_SLUG,
  }),
]);
