import type { RoomEnvelopeContextInput, RoomEnvelopeSupportKind } from "./room-envelope-types";

export const ROOM_ENVELOPE_CONTEXT_VERSION = "room-envelope-context/v1";
export const ROOM_ENVELOPE_DERIVATION_VERSION = "room-envelope-derivation/v1";
export const ROOM_ENVELOPE_NUMERIC_POLICY_VERSION = "room-envelope-numeric/v1";

const SUPPORT_ORDER: readonly RoomEnvelopeSupportKind[] = [
  "floor",
  "wall_back",
  "wall_left",
  "wall_right",
  "ceiling",
];

/**
 * Uses a fixed decimal receipt for the numeric operator assumption, matching
 * the established room-height identity convention. Invalid values are retained
 * as an explicit token so identity creation remains deterministic.
 */
export function buildRoomEnvelopeDepthKey(depthWorld: number): string {
  return Number.isFinite(depthWorld) ? depthWorld.toFixed(6) : "invalid";
}

export function buildRoomEnvelopeContextKey(input: RoomEnvelopeContextInput): string {
  const supports = Object.fromEntries(
    SUPPORT_ORDER.map((kind) => {
      const support = input.supports[kind];
      return [kind, {
        present: support.present,
        included: support.included,
        identityKey: support.identityKey,
      }];
    })
  ) as Record<RoomEnvelopeSupportKind, { present: boolean; included: boolean; identityKey: string | null }>;
  return JSON.stringify({
    contextVersion: ROOM_ENVELOPE_CONTEXT_VERSION,
    derivationVersion: ROOM_ENVELOPE_DERIVATION_VERSION,
    numericPolicyVersion: ROOM_ENVELOPE_NUMERIC_POLICY_VERSION,
    basis: {
      basisId: input.basis.basisId,
      basisFingerprint: input.basis.basisFingerprint,
    },
    camera: {
      appliedAtIso: input.camera.appliedAtIso,
      frameWidth: input.camera.frameWidth,
      frameHeight: input.camera.frameHeight,
    },
    supports,
    resolvedAnchor: {
      kind: input.resolvedAnchor.kind,
      selection: input.resolvedAnchor.selection,
    },
    foregroundCap: input.foregroundCap
      ? {
          mode: input.foregroundCap.mode,
          depthKey: input.foregroundCap.depthKey,
          assumptionId: input.foregroundCap.assumptionId,
          revision: input.foregroundCap.revision,
        }
      : null,
  });
}
