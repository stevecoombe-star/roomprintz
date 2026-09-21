import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  advanceQaRequestAuthority,
  qaResponseMayCommit,
  selectQaLoadView,
  type QaCommittedLoad,
  type QaRequestAuthority,
} from "./qa-request-authority";
import type { AfcQaBrowserState } from "./tester-report.client";

const HOOK = path.join(
  process.cwd(),
  "lib/afc-v2-diagnostics/use-afc-qa-state.ts",
);

const ROOM_A_STATE: AfcQaBrowserState = {
  enabled: true,
  canReport: true,
  offerFeedback: false,
  reportGenerationId: "generation-a",
};

function authority(
  roomId: string | null,
  generation: number,
  nonce = 0,
  reloadKey = 0,
): QaRequestAuthority {
  return { roomId, reloadKey, nonce, generation };
}

function committed(
  generation: number,
  state: AfcQaBrowserState | null,
  roomId = "room-a",
  nonce = 0,
  reloadKey = 0,
): QaCommittedLoad {
  return {
    roomId,
    reloadKey,
    nonce,
    generation,
    error: false,
    state,
  };
}

test("a room response cannot commit after the room stops being authoritative, and re-entry is not settled", () => {
  let current = authority("room-a", 1);
  const roomARequest = {
    roomId: "room-a",
    reloadKey: 0,
    nonce: 0,
    generation: 1,
  };
  assert.equal(qaResponseMayCommit(current, roomARequest), true);

  current = advanceQaRequestAuthority(current, {
    roomId: null,
    reloadKey: 0,
    nonce: 0,
  });
  assert.equal(current.roomId, null);
  assert.equal(current.generation, 2);
  assert.equal(qaResponseMayCommit(current, roomARequest), false);

  let stored: QaCommittedLoad | null = null;
  if (qaResponseMayCommit(current, roomARequest)) {
    stored = committed(roomARequest.generation, ROOM_A_STATE);
  }
  assert.equal(stored, null);
  assert.deepEqual(
    selectQaLoadView({
      roomId: null,
      reloadKey: 0,
      nonce: 0,
      authority: current,
      committed: stored,
    }),
    { loading: false, error: false, state: null },
  );

  current = advanceQaRequestAuthority(current, {
    roomId: "room-a",
    reloadKey: 0,
    nonce: 0,
  });
  assert.equal(current.generation, 3);
  assert.equal(qaResponseMayCommit(current, roomARequest), false);
  const freshRequest = {
    roomId: "room-a",
    reloadKey: 0,
    nonce: 0,
    generation: current.generation,
  };
  assert.equal(qaResponseMayCommit(current, freshRequest), true);
  const reentry = selectQaLoadView({
    roomId: "room-a",
    reloadKey: 0,
    nonce: 0,
    authority: current,
    committed: null,
  });
  assert.equal(reentry.loading, true);
  assert.equal(reentry.state, null);
  const resurrected = selectQaLoadView({
    roomId: "room-a",
    reloadKey: 0,
    nonce: 0,
    authority: current,
    committed: committed(1, ROOM_A_STATE),
  });
  assert.equal(resurrected.loading, true);
  assert.equal(resurrected.error, false);
});

test("same-room reload keeps the previous payload visible while the new generation loads", () => {
  const previous = committed(1, ROOM_A_STATE);
  const reloaded = advanceQaRequestAuthority(authority("room-a", 1), {
    roomId: "room-a",
    reloadKey: 0,
    nonce: 1,
  });
  const view = selectQaLoadView({
    roomId: "room-a",
    reloadKey: 0,
    nonce: 1,
    authority: reloaded,
    committed: previous,
  });
  assert.equal(view.loading, true);
  assert.equal(view.state, ROOM_A_STATE);
  assert.equal(
    qaResponseMayCommit(reloaded, {
      roomId: "room-a",
      reloadKey: 0,
      nonce: 0,
      generation: 1,
    }),
    false,
  );
});

test("a different room does not display the previous room payload", () => {
  const next = advanceQaRequestAuthority(authority("room-a", 1), {
    roomId: "room-b",
    reloadKey: 0,
    nonce: 0,
  });
  const view = selectQaLoadView({
    roomId: "room-b",
    reloadKey: 0,
    nonce: 0,
    authority: next,
    committed: committed(1, ROOM_A_STATE),
  });
  assert.equal(view.loading, true);
  assert.equal(view.state, null);
  assert.equal(
    qaResponseMayCommit(next, {
      roomId: "room-a",
      reloadKey: 0,
      nonce: 0,
      generation: 1,
    }),
    false,
  );
});

test("qa commits are gated by the authoritative request identity", () => {
  const source = readFileSync(HOOK, "utf8");
  assert.match(source, /qaResponseMayCommit\(authorityRef\.current, request\)/);
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /if \(roomId == null\) setCommitted\(null\)/);
  assert.match(source, /generation: request\.generation/);
  assert.match(source, /cache: "no-store"/);
});
