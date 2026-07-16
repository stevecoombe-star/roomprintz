import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BenchmarkFixtureReceipt } from "@/app/admin/3d-room-lab/benchmark-fixture-intake-contract";
import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "@/app/admin/3d-room-lab/calibration-image-basis";
import { canonicalStringify, sha256Hex, type Json } from "@/lib/sceneHash";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import {
  G0_PARENT_FIXTURE_LINEAGE,
  G0_PAYLOAD_FIXTURES,
  G0_SYNTHETIC_ASSETS,
  type G0PayloadFixtureId,
  type G0SyntheticAssetId,
} from "./assets-and-lineage";
import type { G0ProbeId } from "./package";
import { buildG0ProbeDeclarations } from "./probe-declarations";

export type NonPStaleProbeId = Exclude<G0ProbeId, "P-stale">;

type ProbeBinding =
  | {
      readonly bindingKind: "image";
      readonly declarationSourceAssetId: string;
      readonly registryAssetId: G0SyntheticAssetId;
      readonly requiredParentAssetId: G0SyntheticAssetId | null;
      readonly requiresParentLineage: boolean;
    }
  | {
      readonly bindingKind: "image_with_drift";
      readonly declarationSourceAssetId: string;
      readonly parentRegistryAssetId: "A-parent";
      readonly driftRegistryAssetId: "A-drift-b";
    }
  | {
      readonly bindingKind: "payload";
      readonly declarationPayloadIdentity: string;
      readonly payloadFixtureId: G0PayloadFixtureId;
    };

export const NON_P_STALE_DECLARATION_BINDINGS: Record<NonPStaleProbeId, ProbeBinding> = {
  "P-crop": {
    bindingKind: "image",
    declarationSourceAssetId: "A-crop-asset",
    registryAssetId: "A-crop",
    requiredParentAssetId: "A-parent",
    requiresParentLineage: true,
  },
  "P-empty": {
    bindingKind: "image",
    declarationSourceAssetId: "A-empty-asset",
    registryAssetId: "A-empty",
    requiredParentAssetId: "A-parent",
    requiresParentLineage: true,
  },
  "P-gen": {
    bindingKind: "image",
    declarationSourceAssetId: "A-gen-asset",
    registryAssetId: "A-gen",
    requiredParentAssetId: "A-parent",
    requiresParentLineage: true,
  },
  "P-url-drift": {
    bindingKind: "image_with_drift",
    declarationSourceAssetId: "A-parent-asset",
    parentRegistryAssetId: "A-parent",
    driftRegistryAssetId: "A-drift-b",
  },
  "P-dimension-mismatch": {
    bindingKind: "image",
    declarationSourceAssetId: "A-parent-asset",
    registryAssetId: "A-parent",
    requiredParentAssetId: null,
    requiresParentLineage: false,
  },
  "P-coordinate-space-drift": {
    bindingKind: "payload",
    declarationPayloadIdentity: "payload-coordinate-space-drift-v1",
    payloadFixtureId: "P-coordinate-space-drift",
  },
  "P-legacy": {
    bindingKind: "payload",
    declarationPayloadIdentity: "payload-legacy-v1",
    payloadFixtureId: "P-legacy",
  },
  X4: {
    bindingKind: "image",
    declarationSourceAssetId: "A-exif-asset",
    registryAssetId: "A-exif",
    requiredParentAssetId: "A-parent",
    requiresParentLineage: false,
  },
};

type ResolvedImageAsset = {
  readonly assetId: G0SyntheticAssetId;
  readonly digest: string;
  readonly decodedWidth: number;
  readonly decodedHeight: number;
  readonly encodedOrientation: number;
  readonly canonicalRepoRelativePath: string;
};

type ResolvedPayloadFixture = {
  readonly payloadIdentity: string;
  readonly payloadDigest: string;
  readonly payload: unknown;
  readonly canonicalRepoRelativePath: string;
};

export type NonPStaleResolvedProvenance = {
  readonly probeId: NonPStaleProbeId;
  readonly fixtureReceipt: BenchmarkFixtureReceipt;
  readonly fixtureDeclarationIdentity: {
    readonly fixtureId: string;
    readonly fixtureVersion: string;
    readonly declaredProbeId: NonPStaleProbeId;
  };
  readonly canonicalPublicUrl: null;
  readonly canonicalRepoRelativePaths: readonly string[];
  readonly runIdentityBasisFingerprint: string;
  readonly runIdentityCoordinateSpaceVersion: typeof CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION;
  readonly payloadIdentity: string | null;
  readonly payloadDigest: string | null;
  readonly evaluatedImageDigest: string | null;
  readonly driftImageDigest: string | null;
  readonly artifactReferences: readonly string[];
};

function toCanonicalJson(value: unknown): Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJson(entry));
  }
  if (typeof value === "object") {
    const output: { [k: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "undefined") continue;
      output[key] = toCanonicalJson(item);
    }
    return output;
  }
  return String(value);
}

function assertNonPStaleProbeId(probeId: G0ProbeId): asserts probeId is NonPStaleProbeId {
  if (probeId === "P-stale") {
    throw new Error("non_p_stale_resolver_rejects_p_stale");
  }
}

function buildCanonicalRelativePath(...parts: string[]): string {
  const relativePath = path.posix.join(...parts);
  if (relativePath.startsWith("/") || relativePath.includes("..")) {
    throw new Error("invalid_canonical_repo_relative_path");
  }
  return relativePath;
}

async function resolveAndValidateImageAsset(input: {
  assetId: G0SyntheticAssetId;
  requiredParentAssetId: G0SyntheticAssetId | null;
}): Promise<ResolvedImageAsset> {
  const registry = G0_SYNTHETIC_ASSETS[input.assetId];
  if (registry.assetId !== input.assetId) {
    throw new Error(`registry_asset_identity_mismatch:${input.assetId}`);
  }
  if (registry.parentAssetId !== input.requiredParentAssetId) {
    throw new Error(`registry_asset_parent_lineage_mismatch:${input.assetId}`);
  }
  const canonicalRepoRelativePath = buildCanonicalRelativePath(
    "app",
    "admin",
    "3d-room-lab",
    "g0-containment",
    "synthetic-assets",
    registry.fileName
  );
  const absolutePath = path.join(process.cwd(), canonicalRepoRelativePath);
  const bytes = await readFile(absolutePath);
  const digest = computeCalibrationImageFingerprint(bytes);
  if (digest !== registry.sha256) {
    throw new Error(`image_digest_drift:${input.assetId}`);
  }
  const metadata = await inspectImageMetadata(bytes);
  if (!metadata.ok) {
    throw new Error(`image_metadata_unreadable:${input.assetId}`);
  }
  if (
    metadata.width !== registry.decodedWidth ||
    metadata.height !== registry.decodedHeight ||
    metadata.orientation !== registry.encodedOrientation
  ) {
    throw new Error(`image_metadata_drift:${input.assetId}`);
  }
  if ((metadata.orientation === 1) !== registry.decodedOrientationNormal) {
    throw new Error(`image_orientation_normalization_drift:${input.assetId}`);
  }
  return {
    assetId: input.assetId,
    digest,
    decodedWidth: metadata.width,
    decodedHeight: metadata.height,
    encodedOrientation: metadata.orientation,
    canonicalRepoRelativePath,
  };
}

async function resolveAndValidatePayloadFixture(
  fixtureId: G0PayloadFixtureId
): Promise<ResolvedPayloadFixture> {
  const fixture = G0_PAYLOAD_FIXTURES[fixtureId];
  if (fixture.fixtureId !== fixtureId) {
    throw new Error(`payload_fixture_identity_mismatch:${fixtureId}`);
  }
  const canonicalRepoRelativePath = buildCanonicalRelativePath(
    "app",
    "admin",
    "3d-room-lab",
    "g0-containment",
    "payload-fixtures",
    fixture.payloadPath
  );
  const absolutePath = path.join(process.cwd(), canonicalRepoRelativePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const canonicalPayload = canonicalStringify(toCanonicalJson(parsed));
  const payloadDigest = await sha256Hex(canonicalPayload);
  if (payloadDigest !== fixture.payloadDigest) {
    throw new Error(`payload_digest_drift:${fixtureId}`);
  }
  return {
    payloadIdentity: fixture.payloadIdentity,
    payloadDigest,
    payload: parsed,
    canonicalRepoRelativePath,
  };
}

function resolveFixtureReceipt(probeId: NonPStaleProbeId): BenchmarkFixtureReceipt {
  const fixtureReceipt = buildG0ProbeDeclarations()[probeId];
  if (!fixtureReceipt) {
    throw new Error(`missing_fixture_receipt:${probeId}`);
  }
  return fixtureReceipt;
}

function assertDeclarationBindingMatches(
  probeId: NonPStaleProbeId,
  fixtureReceipt: BenchmarkFixtureReceipt,
  binding: ProbeBinding
): void {
  if (fixtureReceipt.declaredProbeId !== probeId) {
    throw new Error(`fixture_declaration_identity_mismatch:${probeId}`);
  }
  if (!fixtureReceipt.expectedRefusalOrContainmentResult?.trim()) {
    throw new Error(`missing_expected_result:${probeId}`);
  }
  if (!fixtureReceipt.expectedPipelineStage?.trim()) {
    throw new Error(`missing_expected_pipeline_stage:${probeId}`);
  }
  if (binding.bindingKind === "payload") {
    if (fixtureReceipt.sourceAssetIdentity.kind !== "payload_identity") {
      throw new Error(`payload_identity_declaration_required:${probeId}`);
    }
    if (
      fixtureReceipt.sourceAssetIdentity.kind !== "payload_identity" ||
      fixtureReceipt.sourceAssetIdentity.payloadId !== binding.declarationPayloadIdentity
    ) {
      throw new Error(`payload_identity_mapping_drift:${probeId}`);
    }
    if (fixtureReceipt.basisBinding.kind !== "payload_only_probe") {
      throw new Error(`payload_basis_binding_mismatch:${probeId}`);
    }
    if (
      fixtureReceipt.basisBinding.payloadIdentity.kind !== "payload_identity" ||
      fixtureReceipt.basisBinding.payloadIdentity.payloadId !== binding.declarationPayloadIdentity
    ) {
      throw new Error(`payload_basis_identity_mapping_drift:${probeId}`);
    }
    return;
  }

  const declaredSourceFromReceipt =
    fixtureReceipt.sourceAssetIdentity.kind === "source_asset"
      ? fixtureReceipt.sourceAssetIdentity.sourceAssetId
      : null;
  const declaredSourceFromBasisBinding =
    fixtureReceipt.basisBinding.kind === "expected_basis_refusal" &&
    fixtureReceipt.basisBinding.sourceAssetIdentity.kind === "source_asset"
      ? fixtureReceipt.basisBinding.sourceAssetIdentity.sourceAssetId
      : null;
  const declaredSourceAssetId = declaredSourceFromBasisBinding ?? declaredSourceFromReceipt;
  if (!declaredSourceAssetId) {
    throw new Error(`source_asset_declaration_required:${probeId}`);
  }
  if (declaredSourceAssetId !== binding.declarationSourceAssetId) {
    throw new Error(`source_asset_identity_mapping_drift:${probeId}`);
  }
  if (binding.bindingKind === "image" && binding.requiresParentLineage) {
    if (fixtureReceipt.basisBinding.kind !== "derivative_basis_probe") {
      throw new Error(`derivative_basis_binding_required:${probeId}`);
    }
    if (
      fixtureReceipt.basisBinding.parentFixtureId !== G0_PARENT_FIXTURE_LINEAGE.fixtureId ||
      fixtureReceipt.basisBinding.parentBasisId !== G0_PARENT_FIXTURE_LINEAGE.basisId
    ) {
      throw new Error(`derivative_lineage_binding_drift:${probeId}`);
    }
  }
}

export async function resolveNonPStaleProvenance(
  probeId: G0ProbeId
): Promise<NonPStaleResolvedProvenance> {
  assertNonPStaleProbeId(probeId);
  const binding = NON_P_STALE_DECLARATION_BINDINGS[probeId];
  if (!binding) {
    throw new Error(`unknown_non_p_stale_probe:${probeId}`);
  }
  const fixtureReceipt = resolveFixtureReceipt(probeId);
  assertDeclarationBindingMatches(probeId, fixtureReceipt, binding);

  if (binding.bindingKind === "payload") {
    const fixture = G0_PAYLOAD_FIXTURES[binding.payloadFixtureId];
    const resolvedPayload = await resolveAndValidatePayloadFixture(binding.payloadFixtureId);
    if (resolvedPayload.payloadIdentity !== binding.declarationPayloadIdentity) {
      throw new Error(`payload_identity_drift:${probeId}`);
    }
    if (fixture.payloadPath !== path.basename(resolvedPayload.canonicalRepoRelativePath)) {
      throw new Error(`payload_path_mapping_drift:${probeId}`);
    }
    return {
      probeId,
      fixtureReceipt,
      fixtureDeclarationIdentity: {
        fixtureId: fixtureReceipt.fixtureId,
        fixtureVersion: fixtureReceipt.fixtureVersion,
        declaredProbeId: probeId,
      },
      canonicalPublicUrl: null,
      canonicalRepoRelativePaths: [resolvedPayload.canonicalRepoRelativePath],
      runIdentityBasisFingerprint: resolvedPayload.payloadDigest,
      runIdentityCoordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      payloadIdentity: resolvedPayload.payloadIdentity,
      payloadDigest: resolvedPayload.payloadDigest,
      evaluatedImageDigest: null,
      driftImageDigest: null,
      artifactReferences: [
        `fixture_payload_path:${resolvedPayload.canonicalRepoRelativePath}`,
        `payload_identity:${resolvedPayload.payloadIdentity}`,
        `payload_digest:${resolvedPayload.payloadDigest}`,
      ],
    };
  }

  if (binding.bindingKind === "image_with_drift") {
    const parent = await resolveAndValidateImageAsset({
      assetId: binding.parentRegistryAssetId,
      requiredParentAssetId: null,
    });
    const drift = await resolveAndValidateImageAsset({
      assetId: binding.driftRegistryAssetId,
      requiredParentAssetId: "A-parent",
    });
    if (parent.digest === drift.digest) {
      throw new Error(`url_drift_digest_mismatch_missing:${probeId}`);
    }
    return {
      probeId,
      fixtureReceipt,
      fixtureDeclarationIdentity: {
        fixtureId: fixtureReceipt.fixtureId,
        fixtureVersion: fixtureReceipt.fixtureVersion,
        declaredProbeId: probeId,
      },
      canonicalPublicUrl: null,
      canonicalRepoRelativePaths: [parent.canonicalRepoRelativePath, drift.canonicalRepoRelativePath],
      runIdentityBasisFingerprint: parent.digest,
      runIdentityCoordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
      payloadIdentity: null,
      payloadDigest: null,
      evaluatedImageDigest: parent.digest,
      driftImageDigest: drift.digest,
      artifactReferences: [
        `fixture_image_path:${parent.canonicalRepoRelativePath}`,
        `fixture_image_digest:${parent.digest}`,
        `drift_image_path:${drift.canonicalRepoRelativePath}`,
        `drift_image_digest:${drift.digest}`,
      ],
    };
  }

  const resolvedAsset = await resolveAndValidateImageAsset({
    assetId: binding.registryAssetId,
    requiredParentAssetId: binding.requiredParentAssetId,
  });
  return {
    probeId,
    fixtureReceipt,
    fixtureDeclarationIdentity: {
      fixtureId: fixtureReceipt.fixtureId,
      fixtureVersion: fixtureReceipt.fixtureVersion,
      declaredProbeId: probeId,
    },
    canonicalPublicUrl: null,
    canonicalRepoRelativePaths: [resolvedAsset.canonicalRepoRelativePath],
    runIdentityBasisFingerprint: resolvedAsset.digest,
    runIdentityCoordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    payloadIdentity: null,
    payloadDigest: null,
    evaluatedImageDigest: resolvedAsset.digest,
    driftImageDigest: null,
    artifactReferences: [
      `fixture_image_path:${resolvedAsset.canonicalRepoRelativePath}`,
      `fixture_image_digest:${resolvedAsset.digest}`,
      `fixture_image_dimensions:${resolvedAsset.decodedWidth}x${resolvedAsset.decodedHeight}`,
      `fixture_image_orientation:${resolvedAsset.encodedOrientation}`,
    ],
  };
}
