import type {
  AfcSr1LiveAuthoritativeGeometry,
} from "./afc-sr1-live-product-contract";
import type {
  AfcFixedSeamCalibrationSuccess,
} from "./afc-fixed-seam-calibration";
import type {
  AfcLabCameraApplyToken,
} from "./afc-lab-apply-transaction";
import type {
  CalibratedCameraApplyCandidate,
  CalibratedCameraApplyEvaluation,
} from "./calibrated-camera-apply";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
  type AuthorityCameraPose,
  type AuthorityFloorPolygon,
  type CalibratedCameraAppliedAuthority,
} from "./calibrated-camera-applied-authority";
import {
  createCalibratedCameraFreezeReceipt,
  type CalibratedCameraFreezeReceiptResult,
} from "./calibrated-camera-freeze-receipt";
import type { CalibrationImageBasis } from "./calibration-image-basis";

export type AppliedCalibratedCameraSnapshot = Readonly<{
  pose: AuthorityCameraPose;
  fovDeg: number;
  frameSize: Readonly<{ width: number; height: number }>;
  diagnosticsSummary: string;
  appliedAtIso: string;
  imageBasis: CalibrationImageBasis;
  sourceFloorPolygon: readonly { x: number; y: number }[];
}>;

export type AppliedTiledAfcCameraFreezeInput = Readonly<{
  appliedSnapshot: AppliedCalibratedCameraSnapshot | null;
  liveResult: AfcSr1LiveAuthoritativeGeometry | null;
  pending: AfcLabCameraApplyToken;
  settle: AfcFixedSeamCalibrationSuccess;
  candidate: CalibratedCameraApplyCandidate;
  candidateEvaluation: CalibratedCameraApplyEvaluation;
  basisQualified: boolean;
  frozenAtIso: string;
  perspectiveAdjustment: Readonly<{
    mode: "tiled_symmetric_near_edge_v1";
    committedDelta: number;
    adjustmentCount: number;
  }> | null;
}>;

export type AppliedTiledAfcCameraFreezeResult =
  | CalibratedCameraFreezeReceiptResult
  | Readonly<{
      ok: false;
      reason:
        | "camera_apply_not_successful"
        | "tiled_provenance_unavailable"
        | "apply_evidence_unavailable";
      detail: string;
    }>;

function polygon(
  points: readonly { x: number; y: number }[]
): AuthorityFloorPolygon | null {
  if (points.length !== 4) return null;
  return points.map((point) => ({
    x: point.x,
    y: point.y,
  })) as unknown as AuthorityFloorPolygon;
}

/**
 * Captures one already-applied TILED AFC camera. It accepts no solver inputs
 * and has no camera mutation surface.
 */
export async function freezeAppliedTiledAfcCamera(
  input: AppliedTiledAfcCameraFreezeInput
): Promise<AppliedTiledAfcCameraFreezeResult> {
  const snapshot = input.appliedSnapshot;
  if (!snapshot) {
    return {
      ok: false,
      reason: "camera_apply_not_successful",
      detail: "No successful applied camera snapshot was supplied.",
    };
  }
  const acceptedPolygon = polygon(snapshot.sourceFloorPolygon);
  const live = input.liveResult;
  const tiled = live?.geometry.tiledPerspective;
  const readerFloorQuad = live
    ? polygon(live.geometry.sourceNormalizedPolygon)
    : null;
  if (
    !live ||
    live.status !== "authoritative_geometry" ||
    live.geometry.mode !== "tiled-perspective-core" ||
    live.geometry.geometryAuthority !== "tiled_perspective_reader" ||
    live.metric.perspectiveAuthority !== "tiled_perspective_core" ||
    !tiled ||
    !readerFloorQuad ||
    !acceptedPolygon
  ) {
    return {
      ok: false,
      reason: "tiled_provenance_unavailable",
      detail:
        "Successful camera apply did not retain complete TILED AFC provenance.",
    };
  }
  if (
    !input.basisQualified ||
    snapshot.imageBasis.basisKind !== "original" ||
    !input.settle.applyObservability.available ||
    input.settle.applyObservability.firstFailingGate !== "none" ||
    !input.candidateEvaluation.available ||
    input.candidateEvaluation.firstFailingGate !== "none" ||
    input.candidate.confidence !== "high" ||
    input.candidate.displayAvgPx === null ||
    input.candidate.displayMaxPx === null
  ) {
    return {
      ok: false,
      reason: "apply_evidence_unavailable",
      detail:
        "Successful camera apply did not retain complete structured apply evidence.",
    };
  }

  const authority: CalibratedCameraAppliedAuthority = {
    authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
    appliedAtIso: snapshot.appliedAtIso,
    verticalFovDeg: snapshot.fovDeg,
    frameSize: { ...snapshot.frameSize },
    pose: {
      position: { ...snapshot.pose.position },
      lookAt: { ...snapshot.pose.lookAt },
      up: { ...snapshot.pose.up },
    },
    imageBasis: structuredClone(snapshot.imageBasis),
    sourceFloorPolygon: acceptedPolygon,
    floorMapping: {
      worldWidth: input.pending.worldWidthM,
      worldDepth: input.pending.worldDepthM,
    },
    calibrationVersion:
      CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
    solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
    diagnosticsSummary: snapshot.diagnosticsSummary,
  };

  return createCalibratedCameraFreezeReceipt({
    frozenAtIso: input.frozenAtIso,
    authority,
    original: {
      sha256: live.originalBasis.sha256,
      decodedWidth: live.originalBasis.decodedWidth,
      decodedHeight: live.originalBasis.decodedHeight,
      orientation: live.originalBasis.orientation,
      basisKind: "original",
    },
    empty: {
      sha256: live.emptyBasis.sha256,
      decodedWidth: live.emptyBasis.decodedWidth,
      decodedHeight: live.emptyBasis.decodedHeight,
      orientation: live.emptyBasis.orientation,
    },
    afc: {
      productVersion: live.schemaVersion,
      attemptId: live.attemptId,
      resultId: live.resultId,
      labLoadGeneration: live.labLoadGeneration,
      geometryMode: "tiled-perspective-core",
      geometryAuthority: "tiled_perspective_reader",
      perspectiveAuthority: "tiled_perspective_core",
      metricScaleAuthority: live.metric.metricScaleAuthority,
      referenceDepthM: live.metric.referenceDepthM,
      acceptedReferenceDepthEvidence: {
        kind: "afc-live-metric-reference-depth",
        referenceDepthM: live.metric.referenceDepthM,
      },
      tiled: {
        image: {
          sha256: tiled.tiledBasis.sha256,
          decodedWidth: tiled.tiledBasis.decodedWidth,
          decodedHeight: tiled.tiledBasis.decodedHeight,
          orientation: tiled.tiledBasis.orientation,
        },
        readerVersion: tiled.readerVersion,
        lineageDigest: tiled.emptyToTiledLineageDigest,
        transfer: tiled.emptyToTiledTransfer,
        originalCompatibilityTier:
          tiled.emptyToOriginalCompatibilityTier,
        readerSourceFloorQuad: readerFloorQuad,
        acceptanceBasis: {
          basisFingerprint:
            live.geometry.acceptanceBasis.basisFingerprint,
          decodedWidth:
            live.geometry.acceptanceBasis.decodedWidth,
          decodedHeight:
            live.geometry.acceptanceBasis.decodedHeight,
          orientation: live.geometry.acceptanceBasis.orientation,
          transferKind:
            live.geometry.acceptanceBasis.transferKind,
          transferProvenance:
            live.geometry.acceptanceBasis.transferProvenance,
        },
        perspectiveAdjustment: input.perspectiveAdjustment,
      },
    },
    acceptedCalibration: {
      sourceFloorPolygon: acceptedPolygon,
      worldWidth: input.pending.worldWidthM,
      worldDepth: input.pending.worldDepthM,
      verticalFovDeg: snapshot.fovDeg,
      applyFrame: { ...snapshot.frameSize },
      appliedPose: {
        position: { ...snapshot.pose.position },
        lookAt: { ...snapshot.pose.lookAt },
        up: { ...snapshot.pose.up },
      },
    },
    applyEvidence: {
      transaction: {
        validation: "passed",
        token: input.pending.token,
        floorAuthorityKey: input.pending.floorAuthorityKey,
        committedWorldWidth: input.pending.worldWidthM,
        committedWorldDepth: input.pending.worldDepthM,
        committedVerticalFovDeg: input.pending.verticalFovDeg,
        rendererFrame: {
          width: input.pending.frameWidth,
          height: input.pending.frameHeight,
        },
      },
      ratioFovSettle: {
        applySafe: true,
        winningCellId: input.settle.winningCellId,
        widthDepthRatio: input.settle.widthDepthRatio,
        referenceDepthM: input.settle.referenceDepthM,
        worldWidthM: input.settle.worldWidthM,
        worldDepthM: input.settle.worldDepthM,
        verticalFovDeg: input.settle.verticalFovDeg,
        evaluatedCellCount: input.settle.evaluatedCellCount,
        applySafeCellCount: input.settle.applySafeCellCount,
        observability: {
          available: true,
          firstFailingGate: "none",
          reason: input.settle.applyObservability.reason,
          displayAvgPx:
            input.settle.applyObservability.displayAvgPx,
          displayMaxPx:
            input.settle.applyObservability.displayMaxPx,
          averageDeltaPx:
            input.settle.applyObservability.averageDeltaPx,
          maximumDeltaPx:
            input.settle.applyObservability.maximumDeltaPx,
        },
      },
      freshCandidateValidation: {
        basisQualified: true,
        available: true,
        firstFailingGate: "none",
        reason: input.candidateEvaluation.reason,
        confidence: "high",
        cvAvgPx: input.candidate.cvAvgPx,
        cvMaxPx: input.candidate.cvMaxPx,
        displayAvgPx: input.candidate.displayAvgPx,
        displayMaxPx: input.candidate.displayMaxPx,
        averageDeltaPx: Math.abs(
          input.candidate.displayAvgPx - input.candidate.cvAvgPx
        ),
        maximumDeltaPx: Math.abs(
          input.candidate.displayMaxPx - input.candidate.cvMaxPx
        ),
        scaleRatio: input.candidate.scaleRatio,
        frameSize: { ...input.candidate.frameSize },
      },
      cameraApply: {
        writer: "applyCalibratedCameraSnapshotFromCandidate",
        succeeded: true,
        labState: "applied",
        imageBasisQualified: true,
        imageBasisKind: "original",
        snapshotFrameMatchedRenderer: true,
        capturedBeforeSubsequentMutation: true,
      },
    },
  });
}
