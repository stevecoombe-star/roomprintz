import { createHash } from "node:crypto";

import {
  AFC_SR1_DEFAULT_OVERLAY_STYLE_V1,
  buildAfcSr1CanonicalSvg,
  composeAfcSr1OriginalPlusOverlay,
  analyzeAfcSr1OverlayVisibility,
  digestAfcSr1OverlayStyle,
  rasterizeAfcSr1Overlay,
  verifyAfcSr1OriginalImage,
  type AfcSr1CanonicalSvgArtifactV1,
  type AfcSr1CompositeImageArtifactV1,
  type AfcSr1OverlayStyleV1,
  type AfcSr1RenderedOverlayArtifactV1,
  type AfcSr1VerifiedOriginalImageV1,
} from "./afc-sr1-overlay-evidence";
import {
  buildAfcSr1SemanticPriorRequest,
  buildAfcSr1SeamBindingToken,
  fingerprintAfcSr1OverlayDescriptor,
  fingerprintAfcSr1SemanticPriorRequest,
  validateAfcSr1OverlayDescriptor,
  validateAfcSr1SemanticPriorBinding,
  validateAfcSr1SemanticPriorRequest,
  type AfcSr1OverlayDescriptorV1,
  type AfcSr1SemanticPriorBindingV1,
  type AfcSr1SemanticPriorRequestV1,
} from "./afc-sr1-semantic-prior";
import {
  buildAfcSr1ResponseContractDocument,
  buildAfcSr1SemanticPriorPrompt,
  digestAfcSr1ResponseContract,
  validateAfcSr1ResponseContractDocument,
  validateAfcSr1SemanticPriorPrompt,
  type AfcSr1ResponseContractDocumentV1,
  type AfcSr1SemanticPriorPromptV1,
} from "./afc-sr1-semantic-prior-prompt";
import {
  canonicalizeRfc8785Jcs,
  sha256HexUtf8,
} from "../gemini-evidence-contract";

export const AFC_SR1_PROVIDER_NEUTRAL_REQUEST_VERSION =
  "afc-sr1-provider-neutral-request/v1" as const;
export const AFC_SR1_REQUEST_PACKAGE_VERSION =
  "afc-sr1-request-package/v1" as const;
export const AFC_SR1_REQUEST_PACKAGE_DIGEST_VERSION =
  "afc-sr1-request-package-digest/v1" as const;
export const AFC_SR1_REQUEST_PACKAGE_REPLAY_VERSION =
  "afc-sr1-request-package-replay/v1" as const;

export type AfcSr1ProviderNeutralRequestArtifactV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_PROVIDER_NEUTRAL_REQUEST_VERSION;
  /** Required to recompute the certified P0 token without a provider receipt. */
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  p0Request: AfcSr1SemanticPriorRequestV1;
  p0RequestDigest: string;
  seamBindingToken: string;
  originalImage: AfcSr1VerifiedOriginalImageV1 & Readonly<{
    role: "original_room_photograph";
  }>;
  overlayDescriptor: AfcSr1OverlayDescriptorV1;
  canonicalSvg: AfcSr1CanonicalSvgArtifactV1;
  renderedOverlay: AfcSr1RenderedOverlayArtifactV1;
  compositeImage: AfcSr1CompositeImageArtifactV1;
  prompt: AfcSr1SemanticPriorPromptV1;
  responseContract: AfcSr1ResponseContractDocumentV1;
  providerImagePolicy: "composite_only/v1";
}>;

export type AfcSr1RequestPackageDigestPreimageV1 = Readonly<{
  digestSchemaVersion: typeof AFC_SR1_REQUEST_PACKAGE_DIGEST_VERSION;
  packageSchemaVersion: typeof AFC_SR1_REQUEST_PACKAGE_VERSION;
  packageGenerationId: string;
  seamBindingToken: string;
  p0RequestDigest: string;
  originalImageSha256: string;
  overlayDescriptorFingerprint: string;
  styleDigest: string;
  svgUtf8Sha256: string;
  overlayPngSha256: string;
  compositePngSha256: string;
  promptSha256: string;
  responseContractDigest: string;
  overlayGenerationId: string;
  requestGenerationId: string;
}>;

export type AfcSr1RequestPackageV1 = Readonly<{
  schemaVersion: typeof AFC_SR1_REQUEST_PACKAGE_VERSION;
  packageGenerationId: string;
  artifact: AfcSr1ProviderNeutralRequestArtifactV1;
  packageDigest: string;
}>;

export type AfcSr1RequestPackageReplayResultV1 =
  | Readonly<{ ok: true; packageDigest: string }>
  | Readonly<{
      ok: false;
      failureClass:
        | "hard_invalid"
        | "stale"
        | "unsupported_visibility"
        | "nondeterministic_render";
      reasonCode: string;
    }>;

export type AfcSr1RequestPackageEvidenceBytesV1 = Readonly<{
  originalBytes: Uint8Array;
  svgUtf8: string;
  overlayPngBytes: Uint8Array;
  compositePngBytes: Uint8Array;
}>;

function fail(reason: string): never {
  throw new Error(`AFC-SR1 request package: ${reason}`);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function stale(reasonCode: string): AfcSr1RequestPackageReplayResultV1 {
  return Object.freeze({ ok: false, failureClass: "stale", reasonCode });
}

function hardInvalid(reasonCode: string): AfcSr1RequestPackageReplayResultV1 {
  return Object.freeze({ ok: false, failureClass: "hard_invalid", reasonCode });
}

export function buildAfcSr1RequestPackageDigestPreimage(
  packageGenerationId: string,
  artifact: AfcSr1ProviderNeutralRequestArtifactV1
): AfcSr1RequestPackageDigestPreimageV1 {
  if (typeof packageGenerationId !== "string" || packageGenerationId.length === 0) {
    fail("package_generation_id_invalid");
  }
  return Object.freeze({
    digestSchemaVersion: AFC_SR1_REQUEST_PACKAGE_DIGEST_VERSION,
    packageSchemaVersion: AFC_SR1_REQUEST_PACKAGE_VERSION,
    packageGenerationId,
    seamBindingToken: artifact.seamBindingToken,
    p0RequestDigest: artifact.p0RequestDigest,
    originalImageSha256: artifact.originalImage.sha256,
    overlayDescriptorFingerprint: artifact.p0Request.overlayFingerprint,
    styleDigest: artifact.renderedOverlay.styleDigest,
    svgUtf8Sha256: artifact.canonicalSvg.svgUtf8Sha256,
    overlayPngSha256: artifact.renderedOverlay.overlayPngSha256,
    compositePngSha256: artifact.compositeImage.compositePngSha256,
    promptSha256: artifact.prompt.promptSha256,
    responseContractDigest: artifact.prompt.responseContractDigest,
    overlayGenerationId: artifact.renderedOverlay.overlayGenerationId,
    requestGenerationId: artifact.p0Request.requestGenerationId,
  });
}

export function digestAfcSr1RequestPackage(
  packageGenerationId: string,
  artifact: AfcSr1ProviderNeutralRequestArtifactV1
): string {
  return `sr1pkg1:${sha256HexUtf8(canonicalizeRfc8785Jcs(
    buildAfcSr1RequestPackageDigestPreimage(packageGenerationId, artifact)
  ))}`;
}

export async function buildAfcSr1RequestPackage(input: Readonly<{
  packageGenerationId: string;
  semanticPriorBinding: AfcSr1SemanticPriorBindingV1;
  overlayDescriptor: AfcSr1OverlayDescriptorV1;
  originalBytes: Uint8Array;
  style?: AfcSr1OverlayStyleV1;
}>): Promise<Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  evidenceBytes: AfcSr1RequestPackageEvidenceBytesV1;
}>> {
  validateAfcSr1SemanticPriorBinding(input.semanticPriorBinding);
  validateAfcSr1OverlayDescriptor(input.overlayDescriptor);
  if (typeof input.packageGenerationId !== "string" || input.packageGenerationId.length === 0) {
    fail("package_generation_id_invalid");
  }
  const style = input.style ?? AFC_SR1_DEFAULT_OVERLAY_STYLE_V1;
  digestAfcSr1OverlayStyle(style);
  if (input.semanticPriorBinding.placement.status !== "placed_on_original_basis") {
    fail("placement_not_original_basis");
  }
  const p0Request = buildAfcSr1SemanticPriorRequest({
    semanticPriorBinding: input.semanticPriorBinding,
    overlayDescriptor: input.overlayDescriptor,
  });
  const visibility = analyzeAfcSr1OverlayVisibility(input.overlayDescriptor);
  if (visibility.status !== "supported") fail("unsupported_visibility");
  const originalImage = await verifyAfcSr1OriginalImage({
    bytes: input.originalBytes,
    expectedBasis: input.semanticPriorBinding.placement.targetOriginalBasis,
  });
  const canonicalSvg = buildAfcSr1CanonicalSvg({
    descriptor: input.overlayDescriptor,
    placement: input.semanticPriorBinding.placement,
    style,
  });
  const renderedOverlay = await rasterizeAfcSr1Overlay({ canonicalSvg });
  const composite = await composeAfcSr1OriginalPlusOverlay({
    originalBytes: input.originalBytes,
    originalImage,
    renderedOverlay,
  });
  const responseContract = buildAfcSr1ResponseContractDocument();
  const prompt = buildAfcSr1SemanticPriorPrompt({
    seamBindingToken: p0Request.seamBindingToken,
    responseContract,
  });
  const artifact: AfcSr1ProviderNeutralRequestArtifactV1 = Object.freeze({
    schemaVersion: AFC_SR1_PROVIDER_NEUTRAL_REQUEST_VERSION,
    semanticPriorBinding: input.semanticPriorBinding,
    p0Request,
    p0RequestDigest: fingerprintAfcSr1SemanticPriorRequest(p0Request),
    seamBindingToken: p0Request.seamBindingToken,
    originalImage: Object.freeze({ ...originalImage, role: "original_room_photograph" }),
    overlayDescriptor: input.overlayDescriptor,
    canonicalSvg: canonicalSvg.metadata,
    renderedOverlay: renderedOverlay.metadata,
    compositeImage: composite.metadata,
    prompt,
    responseContract,
    providerImagePolicy: "composite_only/v1",
  });
  validateAfcSr1ProviderNeutralRequestArtifact(artifact);
  const requestPackage: AfcSr1RequestPackageV1 = Object.freeze({
    schemaVersion: AFC_SR1_REQUEST_PACKAGE_VERSION,
    packageGenerationId: input.packageGenerationId,
    artifact,
    packageDigest: digestAfcSr1RequestPackage(input.packageGenerationId, artifact),
  });
  return Object.freeze({
    requestPackage,
    evidenceBytes: Object.freeze({
      originalBytes: new Uint8Array(input.originalBytes),
      svgUtf8: canonicalSvg.svgUtf8,
      overlayPngBytes: new Uint8Array(renderedOverlay.pngBytes),
      compositePngBytes: new Uint8Array(composite.pngBytes),
    }),
  });
}

export function validateAfcSr1ProviderNeutralRequestArtifact(
  artifact: unknown
): asserts artifact is AfcSr1ProviderNeutralRequestArtifactV1 {
  if (!artifact || typeof artifact !== "object" ||
      !sameKeys(artifact, [
        "schemaVersion", "semanticPriorBinding", "p0Request", "p0RequestDigest",
        "seamBindingToken", "originalImage", "overlayDescriptor", "canonicalSvg",
        "renderedOverlay", "compositeImage", "prompt", "responseContract",
        "providerImagePolicy",
      ])) {
    fail("provider_neutral_artifact_shape_invalid");
  }
  const value = artifact as AfcSr1ProviderNeutralRequestArtifactV1;
  if (value.schemaVersion !== AFC_SR1_PROVIDER_NEUTRAL_REQUEST_VERSION ||
      value.providerImagePolicy !== "composite_only/v1" ||
      value.originalImage.role !== "original_room_photograph") {
    fail("provider_neutral_artifact_values_invalid");
  }
  validateAfcSr1SemanticPriorBinding(value.semanticPriorBinding);
  validateAfcSr1OverlayDescriptor(value.overlayDescriptor);
  validateAfcSr1SemanticPriorRequest(value.p0Request);
  const expectedRequest = buildAfcSr1SemanticPriorRequest({
    semanticPriorBinding: value.semanticPriorBinding,
    overlayDescriptor: value.overlayDescriptor,
  });
  if (value.p0RequestDigest !== fingerprintAfcSr1SemanticPriorRequest(value.p0Request) ||
      value.seamBindingToken !== expectedRequest.seamBindingToken ||
      value.p0Request.seamBindingToken !== expectedRequest.seamBindingToken ||
      value.p0Request.overlayFingerprint !== fingerprintAfcSr1OverlayDescriptor(value.overlayDescriptor) ||
      value.p0Request.requestGenerationId !== value.semanticPriorBinding.requestGenerationId ||
      value.originalImage.sha256 !== value.semanticPriorBinding.placement.targetOriginalBasis.fingerprint ||
      value.originalImage.basis.fingerprint !== value.p0Request.originalImageEvidence.fingerprint ||
      value.originalImage.basis.decodedWidth !== value.p0Request.originalImageEvidence.decodedWidth ||
      value.originalImage.basis.decodedHeight !== value.p0Request.originalImageEvidence.decodedHeight ||
      value.renderedOverlay.overlayDescriptorFingerprint !== value.p0Request.overlayFingerprint ||
      value.canonicalSvg.overlayDescriptorFingerprint !== value.p0Request.overlayFingerprint ||
      value.renderedOverlay.svgUtf8Sha256 !== value.canonicalSvg.svgUtf8Sha256 ||
      value.renderedOverlay.overlayGenerationId !== value.semanticPriorBinding.overlayGenerationId ||
      value.canonicalSvg.overlayGenerationId !== value.semanticPriorBinding.overlayGenerationId ||
      value.compositeImage.originalImageSha256 !== value.originalImage.sha256 ||
      value.compositeImage.overlayPngSha256 !== value.renderedOverlay.overlayPngSha256 ||
      value.compositeImage.width !== value.originalImage.basis.decodedWidth ||
      value.compositeImage.height !== value.originalImage.basis.decodedHeight) {
    fail("provider_neutral_artifact_binding_mismatch");
  }
  validateAfcSr1ResponseContractDocument(value.responseContract);
  validateAfcSr1SemanticPriorPrompt(value.prompt, value.responseContract);
  if (value.prompt.responseContractDigest !== digestAfcSr1ResponseContract(value.responseContract)) {
    fail("provider_neutral_response_contract_mismatch");
  }
}

export async function validateAfcSr1RequestPackageReplay(input: Readonly<{
  requestPackage: AfcSr1RequestPackageV1;
  evidenceBytes: AfcSr1RequestPackageEvidenceBytesV1;
  /** Evidence independently generated from identical inputs, when available. */
  rerenderedEvidence?: Readonly<{
    svgUtf8Sha256: string;
    overlayPngSha256: string;
    compositePngSha256: string;
  }>;
}>): Promise<AfcSr1RequestPackageReplayResultV1> {
  const requestPackage = input.requestPackage;
  if (!requestPackage || typeof requestPackage !== "object" ||
      !sameKeys(requestPackage, ["schemaVersion", "packageGenerationId", "artifact", "packageDigest"]) ||
      requestPackage.schemaVersion !== AFC_SR1_REQUEST_PACKAGE_VERSION ||
      typeof requestPackage.packageGenerationId !== "string" ||
      requestPackage.packageGenerationId.length === 0) {
    return hardInvalid("package_shape_invalid");
  }
  try {
    validateAfcSr1ProviderNeutralRequestArtifact(requestPackage.artifact);
  } catch {
    return stale("artifact_binding_or_identity_mismatch");
  }
  const artifact = requestPackage.artifact;
  const visibility = analyzeAfcSr1OverlayVisibility(artifact.overlayDescriptor);
  if (visibility.status !== "supported") {
    return Object.freeze({
      ok: false,
      failureClass: "unsupported_visibility",
      reasonCode: "visibility_gate_failed",
    });
  }
  const expectedToken = buildAfcSr1SeamBindingToken({
    semanticPriorBinding: artifact.semanticPriorBinding,
    overlayFingerprint: artifact.p0Request.overlayFingerprint,
  });
  if (expectedToken !== artifact.seamBindingToken) return stale("p0_token_mismatch");
  if (fingerprintAfcSr1SemanticPriorRequest(artifact.p0Request) !== artifact.p0RequestDigest) {
    return stale("p0_request_digest_mismatch");
  }
  try {
    const verified = await verifyAfcSr1OriginalImage({
      bytes: input.evidenceBytes.originalBytes,
      expectedBasis: artifact.originalImage.basis,
    });
    if (verified.sha256 !== artifact.originalImage.sha256) return stale("original_bytes_mismatch");
  } catch {
    return stale("original_bytes_or_basis_mismatch");
  }
  if (sha256HexUtf8(input.evidenceBytes.svgUtf8) !== artifact.canonicalSvg.svgUtf8Sha256) {
    return stale("svg_digest_mismatch");
  }
  if (sha256Bytes(input.evidenceBytes.overlayPngBytes) !== artifact.renderedOverlay.overlayPngSha256) {
    return stale("overlay_png_digest_mismatch");
  }
  if (sha256Bytes(input.evidenceBytes.compositePngBytes) !== artifact.compositeImage.compositePngSha256) {
    return stale("composite_png_digest_mismatch");
  }
  if (artifact.prompt.promptSha256 !== sha256HexUtf8(artifact.prompt.promptText)) {
    return stale("prompt_digest_mismatch");
  }
  if (artifact.prompt.responseContractDigest !== digestAfcSr1ResponseContract(artifact.responseContract)) {
    return stale("response_contract_digest_mismatch");
  }
  if (requestPackage.packageDigest !== digestAfcSr1RequestPackage(
    requestPackage.packageGenerationId,
    artifact
  )) {
    return stale("package_digest_mismatch");
  }
  if (input.rerenderedEvidence &&
      (input.rerenderedEvidence.svgUtf8Sha256 !== artifact.canonicalSvg.svgUtf8Sha256 ||
        input.rerenderedEvidence.overlayPngSha256 !== artifact.renderedOverlay.overlayPngSha256 ||
        input.rerenderedEvidence.compositePngSha256 !== artifact.compositeImage.compositePngSha256)) {
    return Object.freeze({
      ok: false,
      failureClass: "nondeterministic_render",
      reasonCode: "identical_input_rerender_mismatch",
    });
  }
  return Object.freeze({ ok: true, packageDigest: requestPackage.packageDigest });
}
