/**
 * Scene material resolution and image-space identification.
 *
 * Materials come only from the placed product and variant. Image left/right
 * is the certified camera's screen space, never the sign of world X.
 * Different variants of one product name are named in the prompt only when
 * their image positions can be told apart. A finish name does not replace that.
 */

import { buildProductionPerspectiveCamera } from "@/lib/afc-v2-runtime/frozen-camera";
import type { RealizedFrozenCamera } from "@/lib/afc-v2-runtime/types";
import { projectWorldPointToNormalizedImage } from "@/lib/afc-v2-runtime/world-to-image-projection";

import type { HarmonizeExportCamera, HarmonizeExportObject } from "./harmonize-export";
import { isPromptSafeMaterialText, storedMaterial } from "./material-text";
import type { StageProduct, StageVariant } from "./types";

export const HARMONIZE_IMAGE_SEPARATION = 0.08;

export type HarmonizeMaterialProvenance =
  | "variant"
  | "product"
  | "cleared"
  | "missing"
  | "unsafe"
  | "unresolved";

export type HarmonizeMaterialOmission =
  | "ambiguous"
  | "unsafe_text"
  | "unresolved_identity"
  | "no_material"
  | null;

export type HarmonizeMaterialProduct = Readonly<{
  productId: string;
  name: string;
  primaryMaterial: string | null;
  secondaryMaterial: string | null;
}>;

export type HarmonizeMaterialVariant = Readonly<{
  variantId: string;
  productId: string;
  finishLabel: string | null;
  primaryMaterial: string | null;
  secondaryMaterial: string | null;
}>;

export type HarmonizeMaterialCatalog = Readonly<{
  products: readonly HarmonizeMaterialProduct[];
  variants: readonly HarmonizeMaterialVariant[];
}>;

export type HarmonizeResolvedMaterial = Readonly<{
  text: string | null;
  provenance: HarmonizeMaterialProvenance;
}>;

export type HarmonizeResolvedObject = Readonly<{
  objectId: string;
  productId: string | null;
  variantId: string | null;
  productName: string | null;
  finishLabel: string | null;
  primary: HarmonizeResolvedMaterial;
  secondary: HarmonizeResolvedMaterial;
  imageSpace: Readonly<{ x: number; y: number }> | null;
  specKey: string | null;
  unsafe: boolean;
}>;

const PHRASE_ORDER = Object.freeze([
  "in the upper left of the image",
  "on the left of the image",
  "in the lower left of the image",
  "in the upper center of the image",
  "in the center of the image",
  "in the lower center of the image",
  "in the upper right of the image",
  "on the right of the image",
  "in the lower right of the image",
] as const);

export function harmonizeMaterialCatalogFromStage(input: Readonly<{
  products: readonly StageProduct[];
  variants: readonly StageVariant[];
  extraProducts?: readonly StageProduct[];
  extraVariants?: readonly StageVariant[];
}>): HarmonizeMaterialCatalog {
  const products = new Map<string, HarmonizeMaterialProduct>();
  const variants = new Map<string, HarmonizeMaterialVariant>();
  for (const product of [...input.products, ...(input.extraProducts ?? [])]) {
    products.set(product.productId, {
      productId: product.productId,
      name: product.name,
      primaryMaterial: storedMaterial(product.primaryMaterial),
      secondaryMaterial: storedMaterial(product.secondaryMaterial),
    });
  }
  for (const variant of [...input.variants, ...(input.extraVariants ?? [])]) {
    variants.set(variant.variantId, {
      variantId: variant.variantId,
      productId: variant.productId,
      finishLabel: variant.finishLabel,
      primaryMaterial: storedMaterial(variant.primaryMaterial),
      secondaryMaterial: storedMaterial(variant.secondaryMaterial),
    });
  }
  return {
    products: [...products.values()].sort((left, right) => left.productId.localeCompare(right.productId)),
    variants: [...variants.values()].sort((left, right) => left.variantId.localeCompare(right.variantId)),
  };
}

export function cloneHarmonizeMaterialCatalog(
  catalog: HarmonizeMaterialCatalog | null | undefined,
): HarmonizeMaterialCatalog | null {
  if (!catalog) return null;
  return {
    products: catalog.products.map((product) => ({ ...product })),
    variants: catalog.variants.map((variant) => ({ ...variant })),
  };
}

function resolveField(
  variantValue: string | null | undefined,
  productValue: string | null | undefined,
  hasVariant: boolean,
): HarmonizeResolvedMaterial {
  if (hasVariant && variantValue === "") return { text: null, provenance: "cleared" };
  if (hasVariant && typeof variantValue === "string" && variantValue.length > 0) {
    if (!isPromptSafeMaterialText(variantValue)) return { text: null, provenance: "unsafe" };
    return { text: variantValue, provenance: "variant" };
  }
  if (typeof productValue === "string" && productValue.length > 0) {
    if (!isPromptSafeMaterialText(productValue)) return { text: null, provenance: "unsafe" };
    return { text: productValue, provenance: "product" };
  }
  return { text: null, provenance: "missing" };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function projectObjects(
  camera: HarmonizeExportCamera,
  objects: readonly HarmonizeExportObject[],
): Map<string, Readonly<{ x: number; y: number }> | null> {
  const points = new Map<string, Readonly<{ x: number; y: number }> | null>();
  const realized: RealizedFrozenCamera = {
    verticalFovDeg: camera.verticalFovDeg,
    aspect: camera.aspect,
    near: camera.near,
    far: camera.far,
    pose: camera.pose,
    frame: camera.frame,
  };
  const built = buildProductionPerspectiveCamera(realized);
  for (const object of objects) {
    if (!built.ok) {
      points.set(object.objectId, null);
      continue;
    }
    const projected = projectWorldPointToNormalizedImage(built.camera, object.positionM);
    if (
      !projected
      || !Number.isFinite(projected.x)
      || !Number.isFinite(projected.y)
      || projected.x < 0
      || projected.x > 1
      || projected.y < 0
      || projected.y > 1
    ) {
      points.set(object.objectId, null);
      continue;
    }
    points.set(object.objectId, { x: round6(projected.x), y: round6(projected.y) });
  }
  return points;
}

export function resolveHarmonizeMaterials(input: Readonly<{
  objects: readonly HarmonizeExportObject[];
  camera: HarmonizeExportCamera;
  catalog: HarmonizeMaterialCatalog | null;
}>): readonly HarmonizeResolvedObject[] {
  const products = new Map((input.catalog?.products ?? []).map((product) => [product.productId, product]));
  const variants = new Map((input.catalog?.variants ?? []).map((variant) => [variant.variantId, variant]));
  const images = projectObjects(input.camera, input.objects);
  return [...input.objects]
    .sort((left, right) => left.objectId.localeCompare(right.objectId))
    .map((object) => {
      const product = object.productId ? products.get(object.productId) ?? null : null;
      const variant = object.variantId ? variants.get(object.variantId) ?? null : null;
      const identityOk = Boolean(product)
        && (!object.variantId || (variant != null && variant.productId === product?.productId));
      if (!identityOk || !product) {
        return {
          objectId: object.objectId,
          productId: object.productId,
          variantId: object.variantId,
          productName: null,
          finishLabel: null,
          primary: { text: null, provenance: "unresolved" as const },
          secondary: { text: null, provenance: "unresolved" as const },
          imageSpace: images.get(object.objectId) ?? null,
          specKey: null,
          unsafe: false,
        };
      }
      const hasVariant = variant != null;
      const primary = resolveField(variant?.primaryMaterial, product.primaryMaterial, hasVariant);
      const secondary = resolveField(variant?.secondaryMaterial, product.secondaryMaterial, hasVariant);
      const unsafe = primary.provenance === "unsafe" || secondary.provenance === "unsafe";
      const specKey = unsafe
        ? null
        : `${product.productId}\u0000${variant?.variantId ?? ""}\u0000${primary.text ?? ""}\u0000${secondary.text ?? ""}`;
      return {
        objectId: object.objectId,
        productId: product.productId,
        variantId: variant?.variantId ?? null,
        productName: product.name,
        finishLabel: variant?.finishLabel ?? null,
        primary,
        secondary,
        imageSpace: images.get(object.objectId) ?? null,
        specKey,
        unsafe,
      };
    });
}

function imagePhrase(point: Readonly<{ x: number; y: number }>): string {
  const column = point.x < 1 / 3 ? "left" : point.x > 2 / 3 ? "right" : "center";
  const row = point.y < 1 / 3 ? "upper" : point.y > 2 / 3 ? "lower" : "middle";
  if (column === "left" && row === "upper") return "in the upper left of the image";
  if (column === "left" && row === "lower") return "in the lower left of the image";
  if (column === "left") return "on the left of the image";
  if (column === "right" && row === "upper") return "in the upper right of the image";
  if (column === "right" && row === "lower") return "in the lower right of the image";
  if (column === "right") return "on the right of the image";
  if (row === "upper") return "in the upper center of the image";
  if (row === "lower") return "in the lower center of the image";
  return "in the center of the image";
}

function pluralizeName(name: string, count: number): string {
  if (count <= 1) return name;
  const parts = name.split(" ");
  const last = parts[parts.length - 1] ?? name;
  if (/s$/i.test(last) || last.length === 0) return name;
  parts[parts.length - 1] = `${last}s`;
  return parts.join(" ");
}

function materialClause(primary: string | null, secondary: string | null, plural: boolean): string | null {
  if (primary && secondary) {
    return `${plural ? "have" : "has"} ${primary} with ${secondary}`;
  }
  const single = primary ?? secondary;
  if (!single) return null;
  return `${plural ? "are" : "is"} ${single}`;
}

type MaterialGroup = Readonly<{
  specKey: string;
  objects: readonly HarmonizeResolvedObject[];
}>;

function phrasesFor(group: MaterialGroup): readonly string[] | null {
  const phrases = new Set<string>();
  for (const object of group.objects) {
    if (!object.imageSpace) return null;
    phrases.add(imagePhrase(object.imageSpace));
  }
  return [...phrases].sort((left, right) => PHRASE_ORDER.indexOf(left as typeof PHRASE_ORDER[number]) - PHRASE_ORDER.indexOf(right as typeof PHRASE_ORDER[number]));
}

function spatiallySeparable(groups: readonly MaterialGroup[]): boolean {
  const located: Array<Readonly<{ specKey: string; point: Readonly<{ x: number; y: number }> }>> = [];
  for (const group of groups) {
    for (const object of group.objects) {
      if (!object.imageSpace) return false;
      located.push({ specKey: group.specKey, point: object.imageSpace });
    }
  }
  for (let index = 0; index < located.length; index += 1) {
    for (let other = index + 1; other < located.length; other += 1) {
      const left = located[index];
      const right = located[other];
      if (!left || !right || left.specKey === right.specKey) continue;
      if (
        Math.abs(left.point.x - right.point.x) < HARMONIZE_IMAGE_SEPARATION
        && Math.abs(left.point.y - right.point.y) < HARMONIZE_IMAGE_SEPARATION
      ) {
        return false;
      }
    }
  }
  const phraseOwners = new Map<string, string>();
  for (const group of groups) {
    const phrases = phrasesFor(group);
    if (!phrases) return false;
    for (const phrase of phrases) {
      const owner = phraseOwners.get(phrase);
      if (owner && owner !== group.specKey) return false;
      phraseOwners.set(phrase, group.specKey);
    }
  }
  return true;
}

function subjectLabel(
  group: MaterialGroup,
  kind: "plain" | "space",
): string {
  const name = group.objects[0]?.productName ?? "furniture";
  const plural = pluralizeName(name, group.objects.length);
  if (kind === "space") {
    const phrases = phrasesFor(group) ?? [];
    return phrases.length > 0 ? `${plural} ${phrases.join(" and ")}` : plural;
  }
  return plural;
}

export type HarmonizeMaterialLine = Readonly<{
  specKey: string;
  objectIds: readonly string[];
  line: string;
}>;

export function harmonizeMaterialLines(resolved: readonly HarmonizeResolvedObject[]): Readonly<{
  lines: readonly HarmonizeMaterialLine[];
  omissions: ReadonlyMap<string, HarmonizeMaterialOmission>;
}> {
  const omissions = new Map<string, HarmonizeMaterialOmission>();
  const candidates: HarmonizeResolvedObject[] = [];
  for (const object of resolved) {
    if (object.primary.provenance === "unresolved" || object.secondary.provenance === "unresolved") {
      omissions.set(object.objectId, "unresolved_identity");
      continue;
    }
    if (object.unsafe) {
      omissions.set(object.objectId, "unsafe_text");
      continue;
    }
    if (!object.primary.text && !object.secondary.text) {
      omissions.set(object.objectId, "no_material");
      continue;
    }
    candidates.push(object);
  }

  const byName = new Map<string, HarmonizeResolvedObject[]>();
  for (const object of candidates) {
    const name = object.productName ?? "";
    const cohort = byName.get(name) ?? [];
    cohort.push(object);
    byName.set(name, cohort);
  }

  const lines: HarmonizeMaterialLine[] = [];
  for (const cohort of byName.values()) {
    const groups = new Map<string, HarmonizeResolvedObject[]>();
    for (const object of cohort) {
      const key = object.specKey ?? object.objectId;
      const group = groups.get(key) ?? [];
      group.push(object);
      groups.set(key, group);
    }
    const materialGroups: MaterialGroup[] = [...groups.entries()]
      .map(([specKey, objects]) => ({ specKey, objects }))
      .sort((left, right) => left.objects[0]!.objectId.localeCompare(right.objects[0]!.objectId));
    const distinguished = materialGroups.length > 1;
    const bySpace = distinguished && spatiallySeparable(materialGroups);
    if (distinguished && !bySpace) {
      for (const object of cohort) omissions.set(object.objectId, "ambiguous");
      continue;
    }
    for (const group of materialGroups) {
      const sample = group.objects[0];
      if (!sample) continue;
      const clause = materialClause(sample.primary.text, sample.secondary.text, group.objects.length > 1);
      if (!clause) {
        for (const object of group.objects) omissions.set(object.objectId, "no_material");
        continue;
      }
      const label = subjectLabel(group, bySpace ? "space" : "plain");
      lines.push({
        specKey: group.specKey,
        objectIds: group.objects.map((object) => object.objectId).sort((left, right) => left.localeCompare(right)),
        line: `The ${label} ${clause}.`,
      });
      for (const object of group.objects) omissions.set(object.objectId, null);
    }
  }

  lines.sort((left, right) => (left.objectIds[0] ?? "").localeCompare(right.objectIds[0] ?? ""));
  return { lines, omissions };
}
