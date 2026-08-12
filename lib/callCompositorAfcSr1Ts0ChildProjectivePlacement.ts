import "server-only";

import type {
  AfcSr1Ts0LineageIdentityV1,
} from "@/app/admin/3d-room-lab/research/afc-sr1-ts0-child-projective-placement";

import { callCompositorJson } from "./compositorTransportError";

export const AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_PATH =
  "/api/research/afc-sr1/ts0-child-projective-placement" as const;

export type AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1 =
  Readonly<{
    coordinateSpace: "source-normalized/v1";
    role: "registration_exclusion_support_only_not_placement_authority";
    evidenceLabel:
      "STRICT_EMPTY_POLYGON_USED_AS_REGISTRATION_EXCLUSION_MASK_ONLY";
    polygon: readonly (readonly [number, number])[];
  }>;

export type CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs = Readonly<{
  parentImageBytes: Uint8Array;
  childImageBytes: Uint8Array;
  policyVersion: "afc-sr1-ts0-child-projective-placement-policy/v1";
  registrationExclusion:
    AfcSr1Ts0ChildProjectivePlacementRegistrationExclusionV1;
  ts0Lineage: AfcSr1Ts0LineageIdentityV1;
  signal?: AbortSignal;
}>;

export async function callCompositorAfcSr1Ts0ChildProjectivePlacement(
  args: CallCompositorAfcSr1Ts0ChildProjectivePlacementArgs
): Promise<unknown> {
  const payload = {
    parentImageBase64: Buffer.from(args.parentImageBytes).toString("base64"),
    childImageBase64: Buffer.from(args.childImageBytes).toString("base64"),
    policyVersion: args.policyVersion,
    registrationExclusion: args.registrationExclusion,
    ts0Lineage: args.ts0Lineage,
  };
  return callCompositorJson({
    seam: "ts0-child-placement",
    path: AFC_SR1_TS0_CHILD_PROJECTIVE_PLACEMENT_PATH,
    method: "POST",
    payload,
    signal: args.signal,
  });
}
