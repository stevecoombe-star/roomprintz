import { PARTNER_CATALOG_JSON_RELATIVE_PATH } from "./partner-catalog";

export type PartnerCatalogDocumentRegistration = Readonly<{
  batchId: string;
  jsonRelativePath: string;
  sqlSlug: string;
}>;

/**
 * Canonical partner catalog documents. Drift maps each registered
 * document to one partner catalog SQL artifact by sqlSlug, not by
 * timestamp. Do not scan arbitrary JSON files.
 */
export const PARTNER_CATALOG_DOCUMENTS: readonly PartnerCatalogDocumentRegistration[] = Object.freeze([
  Object.freeze({
    batchId: "demo-furniture-co",
    jsonRelativePath: PARTNER_CATALOG_JSON_RELATIVE_PATH,
    sqlSlug: "demo_furniture_co",
  }),
  Object.freeze({
    batchId: "demo-furniture-co-pi5f2-tables",
    jsonRelativePath: "lib/vibode-stage/partners/demo-furniture-co/pi5f2-tables/partner-catalog.json",
    sqlSlug: "demo_furniture_co_pi5f2_tables",
  }),
]);

export const PI5F2_PACKAGE_RELATIVE_PATH =
  "lib/vibode-stage/partners/demo-furniture-co/pi5f2-tables";

export const PI5F2_PACKAGE_BATCH_ID = "demo-furniture-co-pi5f2-tables";
