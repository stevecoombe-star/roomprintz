/**
 * Partner-facing 3D model library.
 *
 * Presentation only. Rows are built from Partner-scoped asset, intake, and
 * catalog payloads that the portal already returns. This module does not
 * register, activate, upload, or retarget anything.
 *
 * A model is in use when a current catalog variant points at it. Open drafts
 * are not current references: a model attached only in a draft stays Unused
 * until that variant is current.
 */

import {
  formatPartnerIntakeMetresTriple,
  formatSha256Prefix,
} from "./partner-asset-intake-display";
import { partnerProductEditorPath } from "./partner-catalog-workspace";

export const PARTNER_MODEL_LIBRARY_READY = "Ready";
export const PARTNER_MODEL_LIBRARY_PROCESSING = "Processing";
export const PARTNER_MODEL_LIBRARY_ATTENTION = "Needs attention";
export const PARTNER_MODEL_LIBRARY_UNUSED = "Unused";
export const PARTNER_MODEL_LIBRARY_VALIDATE = "Could not validate this GLB.";
export const PARTNER_MODEL_LIBRARY_PREPARE = "This model could not be prepared for Vibode.";
export const PARTNER_MODEL_LIBRARY_PREPARING = "This model is still being prepared.";
export const PARTNER_MODEL_LIBRARY_CATALOG_HREF = "/partner/catalog";
export const PARTNER_MODEL_LIBRARY_CATALOG_NAME = "Catalog model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type PartnerModelLibraryState = "ready" | "processing" | "needs_attention";

export type PartnerModelLibraryStatusFilter =
  | "all"
  | "ready"
  | "processing"
  | "needs_attention"
  | "unused";

export type PartnerModelLibraryUse = Readonly<{
  productName: string;
  variantLabel: string | null;
  viewProductHref: string;
}>;

export type PartnerModelLibraryTechnical = Readonly<{
  dimensionsLabel: string | null;
  shaPrefix: string | null;
  assetStatus: string | null;
  intakeStatus: string | null;
  assetId: string | null;
  intakeId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  sourceLabel: string | null;
}>;

export type PartnerModelLibraryItem = Readonly<{
  key: string;
  fileName: string;
  state: PartnerModelLibraryState;
  stateLabel: string;
  unused: boolean;
  uploadedAt: string | null;
  uploadedLabel: string | null;
  fileSizeLabel: string | null;
  dimensionsLabel: string | null;
  uses: readonly PartnerModelLibraryUse[];
  attentionMessage: string | null;
  processingMessage: string | null;
  technical: PartnerModelLibraryTechnical;
  searchText: string;
}>;

export type PartnerModelLibraryAssetInput = Readonly<{
  assetId: string;
  status: "ready" | "unavailable" | string;
  originalFileName: string | null;
  measuredWidthM: number;
  measuredHeightM: number;
  measuredDepthM: number;
  sha256: string | null;
  registeredAt: string;
  origin: "partner_intake" | "catalog_linked" | string;
}>;

export type PartnerModelLibraryIntakeInput = Readonly<{
  intakeId: string;
  status: string;
  originalFileName: string;
  byteSize?: number | null;
  authoredWidthM?: number | null;
  authoredHeightM?: number | null;
  authoredDepthM?: number | null;
  measuredWidthM?: number | null;
  measuredHeightM?: number | null;
  measuredDepthM?: number | null;
  sha256?: string | null;
  errorCode?: string | null;
  error?: string | null;
  assetId?: string | null;
  createdAt: string;
}>;

export type PartnerModelLibraryBuild = Readonly<{
  items: readonly PartnerModelLibraryItem[];
  associationsKnown: boolean;
}>;

type CatalogVariant = Readonly<{
  productId: string;
  assetId: string;
  finishLabel: string | null;
  sku: string | null;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function formatPartnerModelTimestamp(iso: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso?.trim() ?? "");
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const label = MONTHS[month - 1];
  if (!label || day < 1 || day > 31) return null;
  return `${day} ${label} ${match[1]}`;
}

export function formatPartnerModelFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export function partnerModelAttentionMessage(errorCode: string | null | undefined): string {
  switch (errorCode) {
    case "MALFORMED_GLB":
    case "PARSE_FAILED":
    case "EXTERNAL_URI":
    case "EMPTY_SCENE":
    case "DIMENSION_MISMATCH":
    case "IMPLAUSIBLE_SIZE":
    case "NEGATIVE_SCALE":
    case "NON_UNIT_PLACEMENT_SCALE":
    case "INVALID_DIMENSIONS":
      return PARTNER_MODEL_LIBRARY_VALIDATE;
    default:
      return PARTNER_MODEL_LIBRARY_PREPARE;
  }
}

export function partnerModelLibraryEmptyFilterMessage(
  status: PartnerModelLibraryStatusFilter,
  query: string,
): string {
  if (status === "needs_attention" && query.trim() === "") return "No models need attention.";
  return "No models match these filters.";
}

function variantLabel(finishLabel: string | null, sku: string | null): string | null {
  const finish = finishLabel?.trim() ?? "";
  const code = sku?.trim() ?? "";
  if (finish && code) return `${finish} · SKU ${code}`;
  if (finish) return finish;
  if (code) return `SKU ${code}`;
  return null;
}

function dimensionsFrom(
  width: number | null,
  height: number | null,
  depth: number | null,
): string | null {
  if (width == null || height == null || depth == null) return null;
  return formatPartnerIntakeMetresTriple(width, height, depth);
}

function intakeDimensions(intake: PartnerModelLibraryIntakeInput): string | null {
  const measured = dimensionsFrom(
    asFiniteNumber(intake.measuredWidthM),
    asFiniteNumber(intake.measuredHeightM),
    asFiniteNumber(intake.measuredDepthM),
  );
  if (measured) return measured;
  return dimensionsFrom(
    asFiniteNumber(intake.authoredWidthM),
    asFiniteNumber(intake.authoredHeightM),
    asFiniteNumber(intake.authoredDepthM),
  );
}

function fileNameFrom(value: string | null | undefined): string {
  return asNonEmpty(value) ?? PARTNER_MODEL_LIBRARY_CATALOG_NAME;
}

function readCatalog(catalog: unknown): Readonly<{
  known: boolean;
  products: ReadonlyMap<string, string>;
  variants: readonly CatalogVariant[];
}> {
  const body = asRecord(catalog);
  if (!body || body.ok !== true || !Array.isArray(body.products) || !Array.isArray(body.variants)) {
    return { known: false, products: new Map(), variants: [] };
  }
  const products = new Map<string, string>();
  for (const value of body.products) {
    const row = asRecord(value);
    const productId = asNonEmpty(row?.productId);
    const name = asNonEmpty(row?.name);
    if (!productId || !name) continue;
    products.set(productId, name);
  }
  const variants: CatalogVariant[] = [];
  for (const value of body.variants) {
    const row = asRecord(value);
    const productId = asNonEmpty(row?.productId);
    const assetId = asNonEmpty(row?.assetId);
    if (!productId || !assetId) continue;
    variants.push({
      productId,
      assetId,
      finishLabel: asNonEmpty(row?.finishLabel),
      sku: asNonEmpty(row?.sku),
    });
  }
  return { known: true, products, variants };
}

function usesFor(
  assetId: string,
  products: ReadonlyMap<string, string>,
  variants: readonly CatalogVariant[],
): PartnerModelLibraryUse[] {
  const uses: PartnerModelLibraryUse[] = [];
  const seen = new Set<string>();
  for (const variant of variants) {
    if (variant.assetId !== assetId) continue;
    const productName = products.get(variant.productId);
    if (!productName) continue;
    const label = variantLabel(variant.finishLabel, variant.sku);
    const key = `${variant.productId}\0${label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uses.push({
      productName,
      variantLabel: label,
      viewProductHref: partnerProductEditorPath(variant.productId),
    });
  }
  return uses.sort((left, right) => (
    left.productName.localeCompare(right.productName)
    || (left.variantLabel ?? "").localeCompare(right.variantLabel ?? "")
  ));
}

function searchTextFor(
  fileName: string,
  uses: readonly PartnerModelLibraryUse[],
  variants: readonly CatalogVariant[],
  products: ReadonlyMap<string, string>,
  assetId: string | null,
): string {
  const fields = [fileName];
  for (const use of uses) {
    fields.push(use.productName);
    if (use.variantLabel) fields.push(use.variantLabel);
  }
  if (assetId) {
    for (const variant of variants) {
      if (variant.assetId !== assetId || !products.has(variant.productId)) continue;
      if (variant.finishLabel) fields.push(variant.finishLabel);
      if (variant.sku) fields.push(variant.sku);
    }
  }
  return fields.join("\n").toLowerCase();
}

function stateLabel(state: PartnerModelLibraryState): string {
  if (state === "ready") return PARTNER_MODEL_LIBRARY_READY;
  if (state === "processing") return PARTNER_MODEL_LIBRARY_PROCESSING;
  return PARTNER_MODEL_LIBRARY_ATTENTION;
}

function sourceLabel(origin: string): string | null {
  if (origin === "partner_intake") return "Uploaded model";
  if (origin === "catalog_linked") return "Existing catalog model";
  return null;
}

function latestIntakeForAsset(
  assetId: string,
  intakes: readonly PartnerModelLibraryIntakeInput[],
): PartnerModelLibraryIntakeInput | null {
  const matches = intakes.filter((intake) => intake.assetId === assetId);
  if (matches.length === 0) return null;
  return [...matches].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt) || right.intakeId.localeCompare(left.intakeId)
  ))[0] ?? null;
}

function shaPrefix(value: string | null | undefined): string | null {
  const sha = asNonEmpty(value);
  if (!sha) return null;
  return formatSha256Prefix(sha);
}

export function buildPartnerModelLibrary(input: Readonly<{
  assets: readonly PartnerModelLibraryAssetInput[];
  intakes: readonly PartnerModelLibraryIntakeInput[];
  catalog: unknown;
}>): PartnerModelLibraryBuild {
  const catalog = readCatalog(input.catalog);
  const assetIds = new Set<string>();
  const items: PartnerModelLibraryItem[] = [];

  for (const asset of input.assets) {
    const assetId = asNonEmpty(asset.assetId);
    if (!assetId || assetIds.has(assetId)) continue;
    assetIds.add(assetId);
    const linked = latestIntakeForAsset(assetId, input.intakes);
    const ready = asset.status === "ready";
    const failed = !ready && linked?.status === "failed";
    const state: PartnerModelLibraryState = ready
      ? "ready"
      : failed
        ? "needs_attention"
        : "processing";
    const uses = catalog.known ? usesFor(assetId, catalog.products, catalog.variants) : [];
    const uploadedAt = linked?.createdAt || asNonEmpty(asset.registeredAt);
    const fileName = fileNameFrom(asset.originalFileName ?? linked?.originalFileName);
    const dimensionsLabel = dimensionsFrom(
      asFiniteNumber(asset.measuredWidthM),
      asFiniteNumber(asset.measuredHeightM),
      asFiniteNumber(asset.measuredDepthM),
    ) ?? (linked ? intakeDimensions(linked) : null);
    items.push({
      key: `asset:${assetId}`,
      fileName,
      state,
      stateLabel: stateLabel(state),
      unused: catalog.known && state === "ready" && uses.length === 0,
      uploadedAt,
      uploadedLabel: formatPartnerModelTimestamp(uploadedAt),
      fileSizeLabel: formatPartnerModelFileSize(linked?.byteSize),
      dimensionsLabel,
      uses,
      attentionMessage: state === "needs_attention"
        ? partnerModelAttentionMessage(linked?.errorCode)
        : null,
      processingMessage: state === "processing" ? PARTNER_MODEL_LIBRARY_PREPARING : null,
      technical: {
        dimensionsLabel,
        shaPrefix: shaPrefix(asset.sha256 ?? linked?.sha256),
        assetStatus: asNonEmpty(asset.status),
        intakeStatus: linked ? asNonEmpty(linked.status) : null,
        assetId,
        intakeId: linked?.intakeId ?? null,
        errorCode: state === "needs_attention" ? asNonEmpty(linked?.errorCode) : null,
        errorDetail: state === "needs_attention" ? asNonEmpty(linked?.error) : null,
        sourceLabel: sourceLabel(asset.origin),
      },
      searchText: searchTextFor(fileName, uses, catalog.variants, catalog.products, assetId),
    });
  }

  for (const intake of input.intakes) {
    const intakeId = asNonEmpty(intake.intakeId);
    if (!intakeId) continue;
    const linkedAssetId = asNonEmpty(intake.assetId);
    if (linkedAssetId && assetIds.has(linkedAssetId)) continue;
    const failed = intake.status === "failed";
    const state: PartnerModelLibraryState = failed ? "needs_attention" : "processing";
    const fileName = fileNameFrom(intake.originalFileName);
    const dimensionsLabel = intakeDimensions(intake);
    const uploadedAt = asNonEmpty(intake.createdAt);
    items.push({
      key: `intake:${intakeId}`,
      fileName,
      state,
      stateLabel: stateLabel(state),
      unused: false,
      uploadedAt,
      uploadedLabel: formatPartnerModelTimestamp(uploadedAt),
      fileSizeLabel: formatPartnerModelFileSize(intake.byteSize),
      dimensionsLabel,
      uses: [],
      attentionMessage: failed ? partnerModelAttentionMessage(intake.errorCode) : null,
      processingMessage: failed ? null : PARTNER_MODEL_LIBRARY_PREPARING,
      technical: {
        dimensionsLabel,
        shaPrefix: shaPrefix(intake.sha256),
        assetStatus: null,
        intakeStatus: asNonEmpty(intake.status),
        assetId: linkedAssetId,
        intakeId,
        errorCode: failed ? asNonEmpty(intake.errorCode) : null,
        errorDetail: failed ? asNonEmpty(intake.error) : null,
        sourceLabel: "Upload",
      },
      searchText: searchTextFor(fileName, [], [], new Map(), null),
    });
  }

  items.sort((left, right) => (
    (right.uploadedAt ?? "").localeCompare(left.uploadedAt ?? "")
    || left.fileName.localeCompare(right.fileName)
    || left.key.localeCompare(right.key)
  ));
  return { items, associationsKnown: catalog.known };
}

export function filterPartnerModelLibrary(
  items: readonly PartnerModelLibraryItem[],
  filter: Readonly<{ query: string; status: PartnerModelLibraryStatusFilter }>,
): readonly PartnerModelLibraryItem[] {
  const tokens = filter.query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
  return items.filter((item) => {
    if (filter.status === "ready" && item.state !== "ready") return false;
    if (filter.status === "processing" && item.state !== "processing") return false;
    if (filter.status === "needs_attention" && item.state !== "needs_attention") return false;
    if (filter.status === "unused" && !item.unused) return false;
    if (tokens.length === 0) return true;
    return tokens.every((token) => item.searchText.includes(token));
  });
}
