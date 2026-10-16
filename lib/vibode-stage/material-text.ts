/**
 * Partner material / finish text.
 *
 * Two optional descriptions, stored exactly. Product blank becomes unset.
 * Variant blank is the intentional clear sentinel and does not inherit.
 */

export const MATERIAL_TEXT_MAX = 400;

export const MATERIAL_TEXT_MESSAGE =
  "Use 400 characters or fewer, without line breaks or links.";

const UNSAFE_MATERIAL_TEXT =
  /[\u0000-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069]|https?:\/\/|\bwww\./i;

export type MaterialTextRole = "product" | "variant";

export type MaterialParseResult =
  | Readonly<{ ok: true; value: string | null }>
  | Readonly<{ ok: false; message: string }>;

export function parseMaterialText(value: unknown, role: MaterialTextRole): MaterialParseResult {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: MATERIAL_TEXT_MESSAGE };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: role === "variant" ? "" : null };
  if (trimmed.length > MATERIAL_TEXT_MAX || UNSAFE_MATERIAL_TEXT.test(trimmed)) {
    return { ok: false, message: MATERIAL_TEXT_MESSAGE };
  }
  return { ok: true, value: trimmed };
}

export function isPromptSafeMaterialText(value: string): boolean {
  return value.length > 0
    && value.length <= MATERIAL_TEXT_MAX
    && !UNSAFE_MATERIAL_TEXT.test(value);
}

export function storedMaterial(value: string | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function withMaterialFields<T extends {
  primaryMaterial?: string | null;
  secondaryMaterial?: string | null;
}>(
  entity: T,
  source: Readonly<{ primaryMaterial?: string | null; secondaryMaterial?: string | null }>,
  touched: Readonly<{ primary: boolean; secondary: boolean }>,
): T {
  const next: T = { ...entity };
  if (touched.primary) {
    if (typeof source.primaryMaterial === "string") next.primaryMaterial = source.primaryMaterial;
    else delete next.primaryMaterial;
  }
  if (touched.secondary) {
    if (typeof source.secondaryMaterial === "string") next.secondaryMaterial = source.secondaryMaterial;
    else delete next.secondaryMaterial;
  }
  return next;
}

export function materialColumns(entity: Readonly<{
  primaryMaterial?: string | null;
  secondaryMaterial?: string | null;
}>): Readonly<{ primary_material?: string; secondary_material?: string }> {
  const columns: { primary_material?: string; secondary_material?: string } = {};
  if (typeof entity.primaryMaterial === "string") columns.primary_material = entity.primaryMaterial;
  if (typeof entity.secondaryMaterial === "string") columns.secondary_material = entity.secondaryMaterial;
  return columns;
}

export function displayProductMaterial(value: string | null | undefined): string {
  return typeof value === "string" && value.length > 0 ? value : "—";
}

export function displayVariantMaterial(value: string | null | undefined): string {
  if (value === "") return "No material";
  if (typeof value === "string" && value.length > 0) return value;
  return "Product default";
}

export type VariantMaterialMode = "inherit" | "custom" | "none";

export function variantMaterialMode(value: string | null | undefined): Readonly<{
  mode: VariantMaterialMode;
  text: string;
}> {
  if (value === "") return { mode: "none", text: "" };
  if (typeof value === "string" && value.length > 0) return { mode: "custom", text: value };
  return { mode: "inherit", text: "" };
}

export function variantMaterialStored(mode: VariantMaterialMode, text: string): string | null {
  if (mode === "none") return "";
  if (mode === "inherit") return null;
  return text.trim();
}
