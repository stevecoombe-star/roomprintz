/**
 * PI-5D2A furniture Asset validation pipeline.
 *
 * Uses production parse/placement/AABB helpers. Does not rescale,
 * bake transforms, or talk to Catalog / Supabase.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import * as THREE from "three";

import { parseFurnitureGlb } from "./furniture-glb-loader";
import { computeImportPlacement } from "./object-import-bounds";
import {
  attachImportedObject,
  createSceneObjectRoot,
  disposeObject3D,
  localAabbDimensions,
  measurePlacementLocalAabb,
} from "./object-runtime";
import {
  classifyAuthoredAxisMismatch,
  FURNITURE_ASSET_EXTREME_ORIGIN_ABS_M,
  FURNITURE_ASSET_INTAKE_MAX_BYTES,
  FURNITURE_ASSET_NON_UNIT_SCALE_WARN,
  FURNITURE_ASSET_PLAUSIBLE_MAX_M,
  FURNITURE_ASSET_PLAUSIBLE_MIN_M,
  FURNITURE_ASSET_ROOT_ROTATION_WARN_DEG,
  isAllowedRequiredExtension,
  isDecoderExtension,
  isPlausibleFurnitureAxisM,
} from "./furniture-asset-policy";
import {
  collectExternalUris,
  inspectGlbJsonChunk,
  matrixColumnScale,
  matrixLinearDet3,
  matrixTranslation,
  quaternionAngleDeg,
  type GlbJsonDocument,
} from "./glb-binary";

export type AssetValidationIssue = Readonly<{
  code: string;
  message: string;
}>;

export type AssetMeasuredSize = Readonly<{
  widthM: number;
  heightM: number;
  depthM: number;
}>;

export type AssetValidationResult = Readonly<{
  accepted: boolean;
  assetId: string;
  glbPath: string;
  fileSizeBytes: number;
  sha256: string;
  parseOk: boolean;
  measured: AssetMeasuredSize | null;
  declared: AssetMeasuredSize;
  placementScale: number | null;
  warnings: readonly AssetValidationIssue[];
  errors: readonly AssetValidationIssue[];
}>;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function issue(code: string, message: string): AssetValidationIssue {
  return { code, message };
}

function hasMesh(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (found || !mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (position && position.count > 0) found = true;
  });
  return found;
}

function objectHasNegativeScale(object: THREE.Object3D): boolean {
  let negative = false;
  object.traverse((child) => {
    if (child.scale.x < 0 || child.scale.y < 0 || child.scale.z < 0) {
      negative = true;
    }
  });
  return negative;
}

function inspectNodeTransforms(json: GlbJsonDocument): {
  errors: AssetValidationIssue[];
  warnings: AssetValidationIssue[];
} {
  const errors: AssetValidationIssue[] = [];
  const warnings: AssetValidationIssue[] = [];
  const nodes = json.nodes ?? [];
  const sceneIndex = json.scene ?? 0;
  const rootIndexes = new Set(json.scenes?.[sceneIndex]?.nodes ?? []);

  nodes.forEach((node, index) => {
    const scale = node.scale;
    if (scale && scale.some((value) => value < 0)) {
      errors.push(issue(
        "NEGATIVE_SCALE",
        `Node ${index} has a negative scale component.`,
      ));
    }
    if (node.matrix && node.matrix.length >= 16 && matrixLinearDet3(node.matrix) < 0) {
      errors.push(issue(
        "NEGATIVE_SCALE",
        `Node ${index} matrix has a negative determinant.`,
      ));
    }
    if (!rootIndexes.has(index)) return;

    if (scale && scale.some((value) => Math.abs(value - 1) > FURNITURE_ASSET_NON_UNIT_SCALE_WARN)) {
      warnings.push(issue(
        "NON_UNIT_ROOT_SCALE",
        `Root node ${index} scale is not 1.`,
      ));
    }
    if (node.rotation && quaternionAngleDeg(node.rotation) > FURNITURE_ASSET_ROOT_ROTATION_WARN_DEG) {
      warnings.push(issue(
        "SUSPICIOUS_ROOT_ROTATION",
        `Root node ${index} has a non-identity rotation.`,
      ));
    }
    const origin = node.translation
      ? { x: node.translation[0] ?? 0, y: node.translation[1] ?? 0, z: node.translation[2] ?? 0 }
      : node.matrix && node.matrix.length >= 16
        ? matrixTranslation(node.matrix)
        : null;
    if (
      origin &&
      Math.max(Math.abs(origin.x), Math.abs(origin.y), Math.abs(origin.z)) >
        FURNITURE_ASSET_EXTREME_ORIGIN_ABS_M
    ) {
      warnings.push(issue(
        "EXTREME_ORIGIN_OFFSET",
        `Root node ${index} origin offset exceeds ${FURNITURE_ASSET_EXTREME_ORIGIN_ABS_M} m.`,
      ));
    }
    if (node.matrix && node.matrix.length >= 16) {
      const columnScale = matrixColumnScale(node.matrix);
      if (
        Math.abs(columnScale.x - 1) > FURNITURE_ASSET_NON_UNIT_SCALE_WARN ||
        Math.abs(columnScale.y - 1) > FURNITURE_ASSET_NON_UNIT_SCALE_WARN ||
        Math.abs(columnScale.z - 1) > FURNITURE_ASSET_NON_UNIT_SCALE_WARN
      ) {
        warnings.push(issue(
          "NON_UNIT_ROOT_SCALE",
          `Root node ${index} matrix scale is not 1.`,
        ));
      }
      const linear = node.matrix.slice(0, 12);
      const identityish = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
      ];
      const rotated = linear.some((value, i) => Math.abs(value - (identityish[i] ?? 0)) > 1e-3);
      if (rotated) {
        warnings.push(issue(
          "SUSPICIOUS_ROOT_ROTATION",
          `Root node ${index} matrix is not a pure translation.`,
        ));
      }
    }
  });

  return { errors, warnings };
}

function validAssetId(assetId: string): AssetValidationIssue | null {
  const trimmed = assetId.trim();
  if (!trimmed || trimmed !== assetId) {
    return issue("INVALID_ASSET_ID", "assetId must be non-empty and trimmed.");
  }
  if (trimmed.length > 256) {
    return issue("INVALID_ASSET_ID", "assetId exceeds 256 characters.");
  }
  if (/\s/.test(trimmed)) {
    return issue("INVALID_ASSET_ID", "assetId must not contain whitespace.");
  }
  return null;
}

function validDeclared(size: AssetMeasuredSize): AssetValidationIssue | null {
  if (
    ![size.widthM, size.heightM, size.depthM].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return issue(
      "INVALID_DECLARED_DIMENSIONS",
      "Declared authored width, height, and depth must be finite and positive metres.",
    );
  }
  return null;
}

export async function validateFurnitureAsset(input: Readonly<{
  bytes: Uint8Array;
  glbPath: string;
  assetId: string;
  declaredWidthM: number;
  declaredHeightM: number;
  declaredDepthM: number;
}>): Promise<AssetValidationResult> {
  const declared: AssetMeasuredSize = {
    widthM: input.declaredWidthM,
    heightM: input.declaredHeightM,
    depthM: input.declaredDepthM,
  };
  const errors: AssetValidationIssue[] = [];
  const warnings: AssetValidationIssue[] = [];
  const assetIdIssue = validAssetId(input.assetId);
  if (assetIdIssue) errors.push(assetIdIssue);
  const declaredIssue = validDeclared(declared);
  if (declaredIssue) errors.push(declaredIssue);

  const fileSizeBytes = input.bytes.byteLength;
  const sha256 = sha256Hex(input.bytes);
  let parseOk = false;
  let measured: AssetMeasuredSize | null = null;
  let placementScale: number | null = null;

  if (fileSizeBytes > FURNITURE_ASSET_INTAKE_MAX_BYTES) {
    errors.push(issue(
      "FILE_TOO_LARGE",
      `GLB is ${fileSizeBytes} bytes; maximum intake size is ${FURNITURE_ASSET_INTAKE_MAX_BYTES} bytes.`,
    ));
  } else if (fileSizeBytes === 0) {
    errors.push(issue("MALFORMED_GLB", "GLB file is empty."));
  }

  if (errors.some((item) => item.code === "FILE_TOO_LARGE" || item.code === "MALFORMED_GLB")) {
    return {
      accepted: false,
      assetId: input.assetId,
      glbPath: input.glbPath,
      fileSizeBytes,
      sha256,
      parseOk,
      measured,
      declared,
      placementScale,
      warnings,
      errors,
    };
  }

  const inspected = inspectGlbJsonChunk(input.bytes);
  if (!inspected.ok) {
    errors.push(issue("MALFORMED_GLB", inspected.reason));
    return {
      accepted: false,
      assetId: input.assetId,
      glbPath: input.glbPath,
      fileSizeBytes,
      sha256,
      parseOk,
      measured,
      declared,
      placementScale,
      warnings,
      errors,
    };
  }

  const external = collectExternalUris(inspected.json);
  for (const uri of external) {
    errors.push(issue(
      "EXTERNAL_URI",
      `Self-contained GLB required; external URI is not allowed: ${uri}`,
    ));
  }

  for (const name of inspected.json.extensionsRequired ?? []) {
    if (!isAllowedRequiredExtension(name)) {
      errors.push(issue(
        "UNSUPPORTED_REQUIRED_EXTENSION",
        `Required glTF extension is not configured: ${name}`,
      ));
    }
  }
  for (const name of inspected.json.extensionsUsed ?? []) {
    if (isDecoderExtension(name)) {
      warnings.push(issue(
        "UNSUPPORTED_OPTIONAL_EXTENSION",
        `Decoder extension ${name} is used; runtime does not configure DRACO/KTX2/meshopt.`,
      ));
    }
  }

  const nodeIssues = inspectNodeTransforms(inspected.json);
  errors.push(...nodeIssues.errors);
  warnings.push(...nodeIssues.warnings);

  if (errors.length > 0 && errors.some((item) => (
    item.code === "EXTERNAL_URI" ||
    item.code === "UNSUPPORTED_REQUIRED_EXTENSION" ||
    item.code === "NEGATIVE_SCALE"
  ))) {
    return {
      accepted: false,
      assetId: input.assetId,
      glbPath: input.glbPath,
      fileSizeBytes,
      sha256,
      parseOk,
      measured,
      declared,
      placementScale,
      warnings,
      errors,
    };
  }

  const loaded = await parseFurnitureGlb(toArrayBuffer(input.bytes));
  parseOk = loaded.ok;
  if (!loaded.ok) {
    errors.push(issue("PARSE_FAILED", loaded.message));
    return {
      accepted: false,
      assetId: input.assetId,
      glbPath: input.glbPath,
      fileSizeBytes,
      sha256,
      parseOk,
      measured,
      declared,
      placementScale,
      warnings,
      errors,
    };
  }

  try {
    if (!hasMesh(loaded.scene)) {
      errors.push(issue("EMPTY_SCENE", "Furniture asset has no mesh geometry."));
    }
    if (objectHasNegativeScale(loaded.scene)) {
      errors.push(issue("NEGATIVE_SCALE", "Parsed scene contains a negative scale."));
    }

    const placement = computeImportPlacement(loaded.scene);
    placementScale = placement.scale;
    if (!placement.ok) {
      errors.push(issue(
        "PLACEMENT_FAILED",
        placement.reason ?? "Unable to measure import placement.",
      ));
    } else if (placement.scale !== 1) {
      errors.push(issue(
        "NON_UNIT_PLACEMENT_SCALE",
        `Import placement scale must remain 1, got ${placement.scale}.`,
      ));
    }

    const root = createSceneObjectRoot();
    attachImportedObject(root.importPlacement, loaded.scene);
    const aabb = measurePlacementLocalAabb(root.placement, root.importPlacement);
    if (!aabb) {
      errors.push(issue("EMPTY_SCENE", "Post-placement AABB is empty."));
    } else {
      const size = localAabbDimensions(aabb);
      measured = {
        widthM: size.width,
        heightM: size.height,
        depthM: size.depth,
      };
      const axes: Array<Readonly<{ axis: "width" | "height" | "depth"; declared: number; measured: number }>> = [
        { axis: "width", declared: declared.widthM, measured: size.width },
        { axis: "height", declared: declared.heightM, measured: size.height },
        { axis: "depth", declared: declared.depthM, measured: size.depth },
      ];
      for (const axis of axes) {
        if (!isPlausibleFurnitureAxisM(axis.measured)) {
          errors.push(issue(
            "IMPLAUSIBLE_SIZE",
            `Measured ${axis.axis} ${axis.measured} m is outside ${FURNITURE_ASSET_PLAUSIBLE_MIN_M}–${FURNITURE_ASSET_PLAUSIBLE_MAX_M} m.`,
          ));
        }
        if (!declaredIssue) {
          const klass = classifyAuthoredAxisMismatch(axis.declared, axis.measured);
          if (klass === "fail") {
            errors.push(issue(
              "DIMENSION_MISMATCH",
              `Measured ${axis.axis} ${axis.measured} m does not match declared ${axis.declared} m.`,
            ));
          } else if (klass === "warning") {
            warnings.push(issue(
              "DIMENSION_DRIFT",
              `Measured ${axis.axis} ${axis.measured} m differs slightly from declared ${axis.declared} m.`,
            ));
          }
        }
      }
    }
    disposeObject3D(root.placement);
  } finally {
    if (loaded.scene.parent == null) disposeObject3D(loaded.scene);
  }

  return {
    accepted: errors.length === 0,
    assetId: input.assetId,
    glbPath: input.glbPath,
    fileSizeBytes,
    sha256,
    parseOk,
    measured,
    declared,
    placementScale,
    warnings,
    errors,
  };
}

export async function validateFurnitureAssetFile(input: Readonly<{
  glbPath: string;
  assetId: string;
  declaredWidthM: number;
  declaredHeightM: number;
  declaredDepthM: number;
}>): Promise<AssetValidationResult> {
  try {
    const buffer = readFileSync(input.glbPath);
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return validateFurnitureAsset({
      bytes,
      glbPath: input.glbPath,
      assetId: input.assetId,
      declaredWidthM: input.declaredWidthM,
      declaredHeightM: input.declaredHeightM,
      declaredDepthM: input.declaredDepthM,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const missing = code === "ENOENT";
    return {
      accepted: false,
      assetId: input.assetId,
      glbPath: input.glbPath,
      fileSizeBytes: 0,
      sha256: "",
      parseOk: false,
      measured: null,
      declared: {
        widthM: input.declaredWidthM,
        heightM: input.declaredHeightM,
        depthM: input.declaredDepthM,
      },
      placementScale: null,
      warnings: [],
      errors: [
        issue(
          missing ? "FILE_MISSING" : "MALFORMED_GLB",
          missing
            ? `GLB file is missing: ${input.glbPath}`
            : error instanceof Error
              ? error.message
              : "Unable to read GLB file.",
        ),
      ],
    };
  }
}
