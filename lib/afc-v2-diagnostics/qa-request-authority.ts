/**
 * Authoritative identity for a QA browser-state request.
 *
 * A response may commit only while this identity is still current. Room,
 * reload key, nonce, and generation are compared together so a resolution
 * that lands after the room becomes null cannot repopulate settled state.
 */

import type { AfcQaBrowserState } from "./tester-report.client";

export type QaRequestAuthority = Readonly<{
  roomId: string | null;
  reloadKey: number;
  nonce: number;
  generation: number;
}>;

export type QaCommittedLoad = Readonly<{
  roomId: string;
  reloadKey: number;
  nonce: number;
  generation: number;
  error: boolean;
  state: AfcQaBrowserState | null;
}>;

export type QaResponseIdentity = Readonly<{
  roomId: string;
  reloadKey: number;
  nonce: number;
  generation: number;
}>;

export function advanceQaRequestAuthority(
  current: QaRequestAuthority,
  next: Readonly<{ roomId: string | null; reloadKey: number; nonce: number }>,
): QaRequestAuthority {
  if (
    current.roomId === next.roomId &&
    current.reloadKey === next.reloadKey &&
    current.nonce === next.nonce
  ) {
    return current;
  }
  return {
    roomId: next.roomId,
    reloadKey: next.reloadKey,
    nonce: next.nonce,
    generation: current.generation + 1,
  };
}

export function qaResponseMayCommit(
  authority: QaRequestAuthority,
  request: QaResponseIdentity,
): boolean {
  return (
    authority.roomId != null &&
    authority.roomId === request.roomId &&
    authority.reloadKey === request.reloadKey &&
    authority.nonce === request.nonce &&
    authority.generation === request.generation
  );
}

export function selectQaLoadView(input: Readonly<{
  roomId: string | null;
  reloadKey: number;
  nonce: number;
  authority: QaRequestAuthority;
  committed: QaCommittedLoad | null;
}>): Readonly<{
  loading: boolean;
  error: boolean;
  state: AfcQaBrowserState | null;
}> {
  if (input.roomId == null) {
    return { loading: false, error: false, state: null };
  }
  const committed = input.committed;
  const settled =
    committed != null &&
    committed.roomId === input.roomId &&
    committed.reloadKey === input.reloadKey &&
    committed.nonce === input.nonce &&
    committed.generation === input.authority.generation;
  if (!settled || committed == null) {
    return {
      loading: true,
      error: false,
      state:
        committed != null && committed.roomId === input.roomId
          ? committed.state
          : null,
    };
  }
  return {
    loading: false,
    error: committed.error,
    state: committed.state,
  };
}
