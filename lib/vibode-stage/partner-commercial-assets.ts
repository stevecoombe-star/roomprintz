/**
 * PI-5G5C1 Partner commercial Asset eligibility.
 *
 * Commercially selectable iff Partner↔Asset mapping exists, the Asset row
 * exists, status is ready, identity is valid, and authored W/H/D are finite
 * and positive. Origin is display metadata only. Generated-registry
 * membership, furniture-manifest membership, furnitureAssetDefinition,
 * and prior Variant association are not required.
 *
 * This is a separate authority from validateTargetAsset, which remains the
 * generated/static validator and must not accept dynamic Partner Assets.
 *
 * Planner Option B: Partner patch planner injects assertTargetAsset from
 * this module. Global registration still uses validateTargetAsset.
 */

import { isValidatorIntakeAssetId } from "./partner-runtime-asset-id";
import type { StageAsset, StageAssetStatus, StageProduct, StageVariant } from "./types";

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPositiveFiniteMetres(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function commercialIssue(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

export const PARTNER_COMMERCIAL_ASSET_ERROR_CODES = Object.freeze([
  "PARTNER_ASSET_NOT_FOUND",
  "PARTNER_ASSET_NOT_READY",
  "PARTNER_ASSET_UNMAPPED",
  "PARTNER_ASSET_INVALID_DIMENSIONS",
  "PARTNER_ASSET_INVALID_IDENTITY",
] as const);

export type PartnerCommercialAssetErrorCode =
  (typeof PARTNER_COMMERCIAL_ASSET_ERROR_CODES)[number];

export type PartnerCommercialAssetOrigin = "partner_intake" | "catalog_linked";

export type PartnerCommercialAssetRecord = Readonly<{
  partnerId: string;
  assetId: string;
  status: StageAssetStatus;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  origin: PartnerCommercialAssetOrigin;
  originalFileName: string | null;
}>;

export type PartnerCommercialEligibilityContext = Readonly<{
  partnerId: string;
  mappings: readonly Readonly<{ partnerId: string; assetId: string; intakeId?: string | null }>[];
  assets: readonly StageAsset[];
  originalFileNames?: Readonly<Record<string, string | null>>;
}>;

export type PartnerCommercialAssetOption = Readonly<{
  assetId: string;
  status: "ready";
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  origin: PartnerCommercialAssetOrigin;
  originalFileName: string | null;
  label: string;
  referencedBy?: number;
}>;

export type PartnerCommercialAssetEligibilitySuccess = Readonly<{
  ok: true;
  record: PartnerCommercialAssetRecord;
}>;

export type PartnerCommercialAssetEligibilityFailure = Readonly<{
  ok: false;
  code: PartnerCommercialAssetErrorCode;
  message: string;
}>;

export type PartnerCommercialAssetEligibilityResult =
  | PartnerCommercialAssetEligibilitySuccess
  | PartnerCommercialAssetEligibilityFailure;

export type PartnerPublishAssetGateSuccess = Readonly<{ ok: true }>;

export type PartnerPublishAssetGateFailure = Readonly<{
  ok: false;
  code: "PARTNER_ASSET_NOT_FOUND" | "ASSET_NOT_READY" | "PARTNER_ASSET_UNMAPPED";
}>;

export type PartnerPublishAssetGateResult =
  | PartnerPublishAssetGateSuccess
  | PartnerPublishAssetGateFailure;

export type PartnerCommercialAssetInput = Readonly<{
  partnerId: string;
  assetId: string;
  mappings: readonly Readonly<{ partnerId: string; assetId: string; intakeId?: string | null }>[];
  assets: readonly Readonly<{
    assetId: string;
    status: StageAssetStatus;
    authoredWidthM: number;
    authoredHeightM: number;
    authoredDepthM: number;
  }>[];
  originalFileName?: string | null;
}>;

function commercialMessage(code: PartnerCommercialAssetErrorCode, assetId: string): string {
  switch (code) {
    case "PARTNER_ASSET_NOT_FOUND":
      return `Asset ${assetId} was not found.`;
    case "PARTNER_ASSET_NOT_READY":
      return `Asset ${assetId} is not ready.`;
    case "PARTNER_ASSET_UNMAPPED":
      return `Asset ${assetId} is not mapped to this Partner.`;
    case "PARTNER_ASSET_INVALID_DIMENSIONS":
      return `Asset ${assetId} technical dimensions are not valid.`;
    case "PARTNER_ASSET_INVALID_IDENTITY":
      return `Asset ${assetId} identity is not valid.`;
    default:
      return `Asset ${assetId} is not commercially eligible.`;
  }
}

export function isValidPartnerCommercialAssetId(assetId: string): boolean {
  const trimmed = asNonEmptyString(assetId);
  if (!trimmed) return false;
  if (trimmed.includes("\0") || trimmed.includes("..")) return false;
  if (isValidatorIntakeAssetId(trimmed)) return false;
  return true;
}

export function partnerCommercialAssetOriginFromIntakeId(
  intakeId: string | null | undefined,
): PartnerCommercialAssetOrigin {
  return intakeId ? "partner_intake" : "catalog_linked";
}

export function shortenPartnerCommercialAssetId(assetId: string): string {
  const trimmed = assetId.trim();
  if (trimmed.length <= 36) return trimmed;
  const slash = trimmed.lastIndexOf("/");
  if (slash >= 0 && slash < trimmed.length - 1) {
    return trimmed.slice(slash + 1);
  }
  return `${trimmed.slice(0, 12)}…${trimmed.slice(-8)}`;
}

export function partnerCommercialAssetLabel(input: Readonly<{
  assetId: string;
  originalFileName?: string | null;
  referencedProductName?: string | null;
  referencedFinishLabel?: string | null;
}>): string {
  const productName = asNonEmptyString(input.referencedProductName ?? "");
  if (productName) {
    const finish = asNonEmptyString(input.referencedFinishLabel ?? "");
    return finish ? `${productName} · ${finish}` : productName;
  }
  const fileName = asNonEmptyString(input.originalFileName ?? "");
  if (fileName) return fileName;
  return shortenPartnerCommercialAssetId(input.assetId);
}

export function partnerCommercialAssetKindLabel(
  origin: PartnerCommercialAssetOrigin,
): "Uploaded Asset" | "Existing Catalog Asset" {
  return origin === "partner_intake" ? "Uploaded Asset" : "Existing Catalog Asset";
}

export function buildPartnerCommercialAssetRecord(input: PartnerCommercialAssetInput): PartnerCommercialAssetRecord | null {
  const partnerId = asNonEmptyString(input.partnerId);
  const assetId = asNonEmptyString(input.assetId);
  if (!partnerId || !assetId) return null;
  const mapping = input.mappings.find((row) => (
    row.partnerId === partnerId && row.assetId === assetId
  ));
  const asset = input.assets.find((row) => row.assetId === assetId);
  if (!mapping || !asset) return null;
  return {
    partnerId,
    assetId,
    status: asset.status,
    authoredWidthM: asset.authoredWidthM,
    authoredHeightM: asset.authoredHeightM,
    authoredDepthM: asset.authoredDepthM,
    origin: partnerCommercialAssetOriginFromIntakeId(mapping.intakeId),
    originalFileName: asNonEmptyString(input.originalFileName ?? "") ?? null,
  };
}

export function evaluatePartnerCommercialAssetEligibility(input: PartnerCommercialAssetInput): PartnerCommercialAssetEligibilityResult {
  const partnerId = asNonEmptyString(input.partnerId);
  const assetId = asNonEmptyString(input.assetId);
  if (!partnerId || !assetId || !isValidPartnerCommercialAssetId(assetId)) {
    return {
      ok: false,
      code: "PARTNER_ASSET_INVALID_IDENTITY",
      message: commercialMessage("PARTNER_ASSET_INVALID_IDENTITY", input.assetId || "(empty)"),
    };
  }
  const asset = input.assets.find((row) => row.assetId === assetId) ?? null;
  if (!asset) {
    return {
      ok: false,
      code: "PARTNER_ASSET_NOT_FOUND",
      message: commercialMessage("PARTNER_ASSET_NOT_FOUND", assetId),
    };
  }
  const mapped = input.mappings.some((row) => (
    row.partnerId === partnerId && row.assetId === assetId
  ));
  if (!mapped) {
    return {
      ok: false,
      code: "PARTNER_ASSET_UNMAPPED",
      message: commercialMessage("PARTNER_ASSET_UNMAPPED", assetId),
    };
  }
  if (asset.status !== "ready") {
    return {
      ok: false,
      code: "PARTNER_ASSET_NOT_READY",
      message: commercialMessage("PARTNER_ASSET_NOT_READY", assetId),
    };
  }
  if (
    !isPositiveFiniteMetres(asset.authoredWidthM)
    || !isPositiveFiniteMetres(asset.authoredHeightM)
    || !isPositiveFiniteMetres(asset.authoredDepthM)
  ) {
    return {
      ok: false,
      code: "PARTNER_ASSET_INVALID_DIMENSIONS",
      message: commercialMessage("PARTNER_ASSET_INVALID_DIMENSIONS", assetId),
    };
  }
  const record = buildPartnerCommercialAssetRecord(input);
  if (!record) {
    return {
      ok: false,
      code: "PARTNER_ASSET_NOT_FOUND",
      message: commercialMessage("PARTNER_ASSET_NOT_FOUND", assetId),
    };
  }
  return { ok: true, record };
}

export function isPartnerCommercialAssetEligible(input: PartnerCommercialAssetInput): boolean {
  return evaluatePartnerCommercialAssetEligibility(input).ok;
}

export function assertPartnerCommercialAssetEligible(
  input: PartnerCommercialAssetInput,
  errors: Array<{ code: string; message: string }>,
): void {
  const result = evaluatePartnerCommercialAssetEligibility(input);
  if (result.ok) return;
  errors.push(commercialIssue(result.code, result.message));
}

export function commercialEligibilityInputFromContext(
  context: PartnerCommercialEligibilityContext,
  assetId: string,
): PartnerCommercialAssetInput {
  return {
    partnerId: context.partnerId,
    assetId,
    mappings: context.mappings,
    assets: context.assets,
    originalFileName: context.originalFileNames?.[assetId] ?? null,
  };
}

export function partnerCommercialAssetIdSet(
  context: PartnerCommercialEligibilityContext,
): ReadonlySet<string> {
  return new Set(
    listPartnerCommercialAssets({
      partnerId: context.partnerId,
      mappings: context.mappings,
      assets: context.assets,
      originalFileNames: context.originalFileNames,
    }).map((item) => item.assetId),
  );
}

export function listPartnerCommercialAssets(input: Readonly<{
  partnerId: string;
  mappings: readonly Readonly<{ partnerId: string; assetId: string; intakeId?: string | null }>[];
  assets: readonly StageAsset[];
  originalFileNames?: Readonly<Record<string, string | null>>;
  products?: readonly StageProduct[];
  variants?: readonly StageVariant[];
}>): readonly PartnerCommercialAssetOption[] {
  const partnerId = asNonEmptyString(input.partnerId);
  if (!partnerId) return [];
  const options: PartnerCommercialAssetOption[] = [];
  const seen = new Set<string>();
  for (const mapping of input.mappings) {
    if (mapping.partnerId !== partnerId) continue;
    if (seen.has(mapping.assetId)) continue;
    seen.add(mapping.assetId);
    const result = evaluatePartnerCommercialAssetEligibility({
      partnerId,
      assetId: mapping.assetId,
      mappings: input.mappings,
      assets: input.assets,
      originalFileName: input.originalFileNames?.[mapping.assetId] ?? null,
    });
    if (!result.ok) continue;
    const refs = referencesFor(mapping.assetId, input.variants ?? [], input.products ?? []);
    const first = refs[0];
    options.push({
      assetId: result.record.assetId,
      status: "ready",
      authoredWidthM: result.record.authoredWidthM,
      authoredHeightM: result.record.authoredHeightM,
      authoredDepthM: result.record.authoredDepthM,
      origin: result.record.origin,
      originalFileName: result.record.originalFileName,
      label: partnerCommercialAssetLabel({
        assetId: result.record.assetId,
        originalFileName: result.record.originalFileName,
        referencedProductName: first?.productName ?? null,
        referencedFinishLabel: first?.finishLabel ?? null,
      }),
      referencedBy: refs.length,
    });
  }
  return options.sort((left, right) => (
    left.label.localeCompare(right.label) || left.assetId.localeCompare(right.assetId)
  ));
}

function referencesFor(
  assetId: string,
  variants: readonly StageVariant[],
  products: readonly StageProduct[],
): Array<{ productName: string; finishLabel: string | null }> {
  const refs: Array<{ productName: string; finishLabel: string | null }> = [];
  for (const variant of variants) {
    if (variant.assetId !== assetId) continue;
    const product = products.find((item) => item.productId === variant.productId);
    refs.push({
      productName: product?.name ?? variant.productId,
      finishLabel: variant.finishLabel,
    });
  }
  return refs;
}

export function partnerCommercialPickerSelection(input: Readonly<{
  options: readonly PartnerCommercialAssetOption[];
  selectedAssetId: string | null | undefined;
}>): Readonly<{
  selectedAssetId: string | null;
  selected: PartnerCommercialAssetOption | null;
  invalid: boolean;
}> {
  const selectedAssetId = asNonEmptyString(input.selectedAssetId ?? "");
  if (!selectedAssetId) {
    return { selectedAssetId: null, selected: null, invalid: false };
  }
  const selected = input.options.find((item) => item.assetId === selectedAssetId) ?? null;
  return {
    selectedAssetId,
    selected,
    invalid: selected == null,
  };
}

export function evaluatePartnerPublishAssetGate(input: Readonly<{
  partnerId: string;
  assetId: string;
  asset: Readonly<{ assetId: string; status: StageAssetStatus }> | null;
  mapped: boolean;
}>): PartnerPublishAssetGateResult {
  const partnerId = asNonEmptyString(input.partnerId);
  const assetId = asNonEmptyString(input.assetId);
  if (!partnerId || !assetId) {
    return { ok: false, code: "PARTNER_ASSET_NOT_FOUND" };
  }
  if (!input.asset || input.asset.assetId !== assetId) {
    return { ok: false, code: "PARTNER_ASSET_NOT_FOUND" };
  }
  if (input.asset.status !== "ready") {
    return { ok: false, code: "ASSET_NOT_READY" };
  }
  if (!input.mapped) {
    return { ok: false, code: "PARTNER_ASSET_UNMAPPED" };
  }
  return { ok: true };
}

export function createPartnerCommercialEligibilityContext(input: Readonly<{
  partnerId: string;
  mappings: readonly Readonly<{ partnerId: string; assetId: string; intakeId?: string | null }>[];
  assets: readonly StageAsset[];
  originalFileNames?: Readonly<Record<string, string | null>>;
}>): PartnerCommercialEligibilityContext {
  return {
    partnerId: input.partnerId,
    mappings: input.mappings,
    assets: input.assets,
    originalFileNames: input.originalFileNames,
  };
}

export function commercialAssetRecordsFromRows(input: Readonly<{
  partnerId: string;
  mappings: readonly Readonly<{ partnerId: string; assetId: string; intakeId?: string | null }>[];
  assets: readonly StageAsset[];
  originalFileNames?: Readonly<Record<string, string | null>>;
}>): PartnerCommercialAssetRecord[] {
  const records: PartnerCommercialAssetRecord[] = [];
  const seen = new Set<string>();
  for (const mapping of input.mappings) {
    if (mapping.partnerId !== input.partnerId) continue;
    if (seen.has(mapping.assetId)) continue;
    seen.add(mapping.assetId);
    const record = buildPartnerCommercialAssetRecord({
      partnerId: input.partnerId,
      assetId: mapping.assetId,
      mappings: input.mappings,
      assets: input.assets,
      originalFileName: input.originalFileNames?.[mapping.assetId] ?? null,
    });
    if (record) records.push(record);
  }
  return records;
}

export function collectAssetIdsFromUnknownPatch(document: unknown): string[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) return [];
  const variants = (document as { variants?: unknown }).variants;
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return [];
  const ids = new Set<string>();
  const create = (variants as { create?: unknown }).create;
  const update = (variants as { update?: unknown }).update;
  for (const list of [create, update]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const assetId = asNonEmptyString((item as { currentAssetId?: unknown }).currentAssetId);
      if (assetId) ids.add(assetId);
    }
  }
  return [...ids];
}

export function pickerDtoLeakKeys(): readonly string[] {
  return Object.freeze([
    "storageBucket",
    "storagePath",
    "storageObjectPath",
    "sha256",
    "sha",
    "signedUrl",
    "objectPath",
    "intakeObjectPath",
    "intakeId",
    "partnerMapping",
  ]);
}
