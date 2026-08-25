import "server-only";

import {
  getAfcSr1LiveAttemptEvidence,
} from "./afc-sr1-live-product";
import {
  extractCalibratedCameraAppliedAuthority,
  parseCalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceiptFailureReason,
  type CalibratedCameraFreezeImageIdentity,
} from "./calibrated-camera-freeze-receipt";
import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "./calibrated-camera-readonly-projection";
import {
  P2_S2H_LIVE_COLLISION_BLOCKERS_CONTRACT_VERSION,
  type P2S2HLiveCollisionBlockersFailure,
  type P2S2HLiveCollisionBlockersFailureReason,
  type P2S2HLiveCollisionBlockersRequest,
  type P2S2HLiveCollisionBlockersResponse,
} from "./p2-s2h-live-collision-blockers-contract";
import {
  classifyAfcR3cImagePairCompatibility,
} from "./research/afc-r3c-image-pair-compatibility";
import {
  projectVisibleFloorBlockersToWorldXZ,
} from "./research/empty-visible-floor-blocker-world-projection";
import {
  readCertifiedVisibleFloorTerminationFragments,
} from "./research/empty-visible-floor-contact-localizer";
import {
  classifyP2S2ETerminationCollisionPolicies,
} from "./research/empty-visible-floor-termination-collision-policy";
import {
  qualifyP2S2FCollisionSafeBlockers,
} from "./research/p2-s2g-collision-safe-blocker-qualification";

type Dependencies = Readonly<{
  getEvidence?: typeof getAfcSr1LiveAttemptEvidence;
  parseFreezeReceipt?: typeof parseCalibratedCameraFreezeReceipt;
  buildProjectionCamera?: typeof buildCalibratedReadOnlyProjectionCamera;
  classifyCompatibility?: typeof classifyAfcR3cImagePairCompatibility;
  readFragments?: typeof readCertifiedVisibleFloorTerminationFragments;
  classifyPolicies?: typeof classifyP2S2ETerminationCollisionPolicies;
  projectBlockers?: typeof projectVisibleFloorBlockersToWorldXZ;
  qualifyBlockers?: typeof qualifyP2S2FCollisionSafeBlockers;
}>;

function responseBinding(request: P2S2HLiveCollisionBlockersRequest) {
  return {
    contractVersion: P2_S2H_LIVE_COLLISION_BLOCKERS_CONTRACT_VERSION,
    attemptId: request.attemptId,
    resultId: request.resultId,
    labLoadGeneration: request.labLoadGeneration,
  } as const;
}

function failure(
  request: P2S2HLiveCollisionBlockersRequest,
  reason: P2S2HLiveCollisionBlockersFailureReason
): P2S2HLiveCollisionBlockersFailure {
  return Object.freeze({
    ...responseBinding(request),
    ok: false,
    reason,
  });
}

function freezeIdentity(
  basis: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>
): CalibratedCameraFreezeImageIdentity {
  return {
    sha256: basis.sha256,
    decodedWidth: basis.decodedWidth,
    decodedHeight: basis.decodedHeight,
    orientation: basis.orientation,
  };
}

function sameImageIdentity(
  left: CalibratedCameraFreezeImageIdentity,
  right: CalibratedCameraFreezeImageIdentity
): boolean {
  return (
    left.sha256 === right.sha256 &&
    left.decodedWidth === right.decodedWidth &&
    left.decodedHeight === right.decodedHeight &&
    left.orientation === right.orientation
  );
}

function receiptFailureReason(
  reason: CalibratedCameraFreezeReceiptFailureReason
): P2S2HLiveCollisionBlockersFailureReason {
  if (reason === "expected_original_mismatch") {
    return "original_identity_mismatch";
  }
  if (reason === "expected_empty_mismatch") {
    return "empty_identity_mismatch";
  }
  if (reason === "expected_tiled_mismatch") {
    return "tiled_identity_mismatch";
  }
  return "freeze_receipt_invalid";
}

async function execute(
  request: P2S2HLiveCollisionBlockersRequest,
  dependencies: Dependencies
): Promise<P2S2HLiveCollisionBlockersResponse> {
  const evidence = (
    dependencies.getEvidence ?? getAfcSr1LiveAttemptEvidence
  )(request.attemptId);
  if (!evidence?.floorRead) {
    return failure(request, "attempt_evidence_unavailable");
  }
  const binding = evidence.binding;
  if (!binding) {
    return failure(request, "attempt_binding_unavailable");
  }
  if (binding.attemptId !== request.attemptId) {
    return failure(request, "attempt_identity_mismatch");
  }
  if (binding.resultId !== request.resultId) {
    return failure(request, "result_identity_mismatch");
  }
  if (binding.labLoadGeneration !== request.labLoadGeneration) {
    return failure(request, "lab_load_generation_mismatch");
  }

  const emptyIdentity = freezeIdentity(evidence.floorRead.emptyBasis);
  if (!sameImageIdentity(emptyIdentity, freezeIdentity(binding.emptyBasis))) {
    return failure(request, "empty_identity_mismatch");
  }
  const tiled = evidence.tiledPerspective;
  if (!tiled || tiled.resultId !== binding.resultId) {
    return failure(request, "tiled_identity_mismatch");
  }

  const originalIdentity = freezeIdentity(binding.originalBasis);
  const tiledIdentity = freezeIdentity(tiled.tiledBasis);
  const parsed = await (
    dependencies.parseFreezeReceipt ?? parseCalibratedCameraFreezeReceipt
  )(request.freezeReceipt, {
    original: originalIdentity,
    empty: emptyIdentity,
    tiled: tiledIdentity,
  });
  if (!parsed.ok) {
    return failure(request, receiptFailureReason(parsed.reason));
  }

  const receipt = parsed.value;
  if (receipt.payload.afc.attemptId !== request.attemptId) {
    return failure(request, "attempt_identity_mismatch");
  }
  if (receipt.payload.afc.resultId !== request.resultId) {
    return failure(request, "result_identity_mismatch");
  }
  if (receipt.payload.afc.labLoadGeneration !== request.labLoadGeneration) {
    return failure(request, "lab_load_generation_mismatch");
  }

  const authority = extractCalibratedCameraAppliedAuthority(receipt);
  const camera = (
    dependencies.buildProjectionCamera ??
    buildCalibratedReadOnlyProjectionCamera
  )({
    fovDeg: authority.verticalFovDeg,
    pose: authority.pose,
    frameSize: authority.frameSize,
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  if (!camera.ok) {
    return failure(request, "projection_camera_invalid");
  }

  const compatibility = (
    dependencies.classifyCompatibility ??
    classifyAfcR3cImagePairCompatibility
  )(
    {
      fingerprint: originalIdentity.sha256,
      decodedWidth: originalIdentity.decodedWidth,
      decodedHeight: originalIdentity.decodedHeight,
      orientation: originalIdentity.orientation,
    },
    {
      fingerprint: emptyIdentity.sha256,
      decodedWidth: emptyIdentity.decodedWidth,
      decodedHeight: emptyIdentity.decodedHeight,
      orientation: emptyIdentity.orientation,
    }
  );
  if (compatibility.tier === "incompatible") {
    return failure(request, "image_pair_incompatible");
  }

  const localized = await (
    dependencies.readFragments ??
    readCertifiedVisibleFloorTerminationFragments
  )(
    evidence.floorRead.emptyBytes,
    {
      roomId: binding.attemptId,
      emptyImage: {
        sha256: emptyIdentity.sha256,
        dimensions: {
          width: emptyIdentity.decodedWidth,
          height: emptyIdentity.decodedHeight,
        },
      },
    }
  );
  if (!localized.ok) {
    return failure(request, "s2d_failed");
  }

  const fragments = localized.localization.fragments;
  const policies = (
    dependencies.classifyPolicies ??
    classifyP2S2ETerminationCollisionPolicies
  )(fragments);
  const projected = (
    dependencies.projectBlockers ?? projectVisibleFloorBlockersToWorldXZ
  )({
    fragments,
    policies,
    emptyIntrinsicSize: {
      width: emptyIdentity.decodedWidth,
      height: emptyIdentity.decodedHeight,
    },
    originalIntrinsicSize: {
      width: originalIdentity.decodedWidth,
      height: originalIdentity.decodedHeight,
    },
    compatibility,
    containerSize: authority.frameSize,
    calibratedCamera: camera.camera,
  });
  if (!projected.ok) {
    return failure(request, "s2f_input_invalid");
  }

  const blockerQualification = (
    dependencies.qualifyBlockers ?? qualifyP2S2FCollisionSafeBlockers
  )(projected.blockers);
  return Object.freeze({
    ...responseBinding(request),
    ok: true,
    freezeReceiptPayloadSha256: receipt.integrity.payloadSha256,
    blockerQualification,
  });
}

export async function produceP2S2HLiveCollisionBlockers(
  request: P2S2HLiveCollisionBlockersRequest,
  dependencies: Dependencies = {}
): Promise<P2S2HLiveCollisionBlockersResponse> {
  try {
    return await execute(request, dependencies);
  } catch {
    return failure(request, "pipeline_failed");
  }
}
