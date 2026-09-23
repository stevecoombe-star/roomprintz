import type {
  P2S2GCollisionSafeBlockerQualification,
} from "./p2-s2g-collision-safe-blocker-contract";

export const P2_S2H_LIVE_COLLISION_BLOCKERS_CONTRACT_VERSION =
  "p2-s2h-live-collision-blockers/v1" as const;

export type P2S2HLiveCollisionBlockersRequest = Readonly<{
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
  freezeReceipt: unknown;
}>;

export type P2S2HLiveCollisionBlockersFailureReason =
  | "attempt_evidence_unavailable"
  | "attempt_binding_unavailable"
  | "attempt_identity_mismatch"
  | "result_identity_mismatch"
  | "lab_load_generation_mismatch"
  | "freeze_receipt_invalid"
  | "original_identity_mismatch"
  | "empty_identity_mismatch"
  | "tiled_identity_mismatch"
  | "image_pair_incompatible"
  | "projection_camera_invalid"
  | "s2d_failed"
  | "s2f_input_invalid"
  | "pipeline_failed";

type P2S2HLiveCollisionBlockersResponseBinding = Readonly<{
  contractVersion: typeof P2_S2H_LIVE_COLLISION_BLOCKERS_CONTRACT_VERSION;
  attemptId: string;
  resultId: string;
  labLoadGeneration: number;
}>;

export type P2S2HLiveCollisionBlockersSuccess =
  P2S2HLiveCollisionBlockersResponseBinding &
  Readonly<{
    ok: true;
    freezeReceiptPayloadSha256: string;
    blockerQualification: P2S2GCollisionSafeBlockerQualification;
  }>;

export type P2S2HLiveCollisionBlockersFailure =
  P2S2HLiveCollisionBlockersResponseBinding &
  Readonly<{
    ok: false;
    reason: P2S2HLiveCollisionBlockersFailureReason;
  }>;

export type P2S2HLiveCollisionBlockersResponse =
  | P2S2HLiveCollisionBlockersSuccess
  | P2S2HLiveCollisionBlockersFailure;
