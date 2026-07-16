import assert from "node:assert/strict";
import test from "node:test";
import {
  beginSupportPointDragTransaction,
  canApplySupportPointUndo,
  consumeSupportPointUndo,
  finalizeSupportPointDragTransaction,
  isSupportPointUndoShortcut,
  type SupportPointUndoRecord,
} from "./support-point-undo";
import type { SupportKind } from "./support-model";

type Snapshot = {
  polygon: readonly { x: number; y: number }[];
  review: string;
  confirmation: string | null;
  presentation?: { visible: boolean; locked: boolean };
};

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    polygon: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }],
    review: "needs_review",
    confirmation: null,
    ...overrides,
  };
}

function materialKey(value: Snapshot): string {
  return JSON.stringify({
    polygon: value.polygon,
    review: value.review,
    confirmation: value.confirmation,
  });
}

function transaction(kind: SupportKind = "floor", before = snapshot()) {
  return beginSupportPointDragTransaction(kind, before, materialKey(before));
}

function record(
  kind: SupportKind = "floor",
  before = snapshot(),
  after = snapshot({ polygon: [{ x: 0.3, y: 0.2 }, { x: 0.8, y: 0.9 }] })
) {
  return finalizeSupportPointDragTransaction(transaction(kind, before), materialKey(after), null)!;
}

test("begins with the exact support kind", () => {
  assert.equal(transaction("wall_left").supportKind, "wall_left");
});

test("captures an immutable before snapshot", () => {
  const before = snapshot();
  const started = transaction("floor", before);
  assert.deepEqual(started.before, before);
  assert.notEqual(started.before, before);
});

test("does not mutate the supplied snapshot at transaction start", () => {
  const before = snapshot();
  const original = structuredClone(before);
  transaction("floor", before);
  assert.deepEqual(before, original);
});

test("beginning a transaction does not itself create an undo record", () => {
  const started = transaction();
  assert.equal("afterKey" in started, false);
});

test("a materially changed drag creates one record", () => {
  assert.ok(record());
});

test("a record retains the exact before snapshot", () => {
  const before = snapshot();
  assert.deepEqual(record("floor", before).before, before);
});

test("a record contains the exact after-state key", () => {
  const after = snapshot({ review: "manually_confirmed" });
  assert.equal(record("floor", snapshot(), after).afterKey, materialKey(after));
});

test("a no-op drag creates no new record", () => {
  const before = snapshot();
  assert.equal(finalizeSupportPointDragTransaction(transaction("floor", before), materialKey(before), null), null);
});

test("a no-op drag preserves the previous valid record", () => {
  const previous = record("wall_back");
  const before = snapshot();
  assert.equal(finalizeSupportPointDragTransaction(transaction("floor", before), materialKey(before), previous), previous);
});

test("a new material drag replaces the previous record", () => {
  const previous = record("floor");
  const next = record("floor", snapshot({ review: "suggested" }));
  assert.notEqual(next, previous);
});

test("a different support kind replaces the previous record", () => {
  const previous = record("floor");
  const next = finalizeSupportPointDragTransaction(
    transaction("wall_left"),
    materialKey(snapshot({ review: "manually_confirmed" })),
    previous
  )!;
  assert.equal(next.supportKind, "wall_left");
  assert.notEqual(next, previous);
});

test("repeated pointer-move-like updates still finalize to one record", () => {
  const started = transaction();
  const after = snapshot({ polygon: [{ x: 0.5, y: 0.2 }, { x: 0.8, y: 0.9 }] });
  const completed = finalizeSupportPointDragTransaction(started, materialKey(after), null);
  assert.ok(completed);
  assert.equal(completed?.afterKey, materialKey(after));
});

test("a matching after-state key is applicable", () => {
  const completed = record();
  assert.equal(canApplySupportPointUndo(completed, completed.afterKey, false), true);
});

test("a mismatching geometry key is stale", () => {
  const completed = record();
  assert.equal(canApplySupportPointUndo(completed, materialKey(snapshot({ polygon: [{ x: 0.4, y: 0.2 }] })), false), false);
});

test("a mismatching review key is stale", () => {
  const completed = record();
  assert.equal(canApplySupportPointUndo(completed, materialKey(snapshot({ review: "manually_confirmed" })), false), false);
});

test("a mismatching confirmation key is stale", () => {
  const completed = record();
  assert.equal(canApplySupportPointUndo(completed, materialKey(snapshot({ confirmation: "new-stamp" })), false), false);
});

test("presentation-only state does not enter the pure currentness decision", () => {
  const completed = record();
  const displayChanged = snapshot({
    polygon: [{ x: 0.3, y: 0.2 }, { x: 0.8, y: 0.9 }],
    presentation: { visible: false, locked: true },
  });
  assert.equal(canApplySupportPointUndo(completed, materialKey(displayChanged), false), true);
});

test("a stale record is not applied", () => {
  const completed = record();
  assert.equal(consumeSupportPointUndo(canApplySupportPointUndo(completed, "stale", false) ? completed : null), null);
});

test("applying a current record returns the exact before snapshot", () => {
  const before = snapshot();
  assert.deepEqual(consumeSupportPointUndo(record("floor", before))?.snapshot, before);
});

test("applying consumes the record", () => {
  const consumed = consumeSupportPointUndo(record());
  assert.equal(consumed?.nextUndoRecord, null);
});

test("a consumed record cannot be applied again", () => {
  const consumed = consumeSupportPointUndo(record());
  assert.equal(consumeSupportPointUndo(consumed?.nextUndoRecord ?? null), null);
});

test("undo does not create redo", () => {
  const consumed = consumeSupportPointUndo(record());
  assert.deepEqual(Object.keys(consumed ?? {}).sort(), ["nextUndoRecord", "snapshot"]);
});

test("no record produces no action", () => {
  assert.equal(consumeSupportPointUndo(null), null);
});

test("an active drag condition refuses undo", () => {
  const completed = record();
  assert.equal(canApplySupportPointUndo(completed, completed.afterKey, true), false);
});

test("Meta-Z is recognized", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), true);
});

test("Ctrl-Z is recognized", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }), true);
});

test("Shift-Meta-Z is rejected", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false }), false);
});

test("Shift-Ctrl-Z is rejected", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false }), false);
});

test("Alt-Z is rejected", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: false, ctrlKey: true, shiftKey: false, altKey: true }), false);
});

test("plain Z is rejected", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }), false);
});

test("an unrelated key is rejected", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "y", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }), false);
});

test("shortcut case handling is deterministic", () => {
  const input = { key: "Z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(isSupportPointUndoShortcut(input), isSupportPointUndoShortcut(input));
  assert.equal(isSupportPointUndoShortcut(input), true);
});

test("repeated keydown is ignored", () => {
  assert.equal(isSupportPointUndoShortcut({ key: "z", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: true }), false);
});

test("creates a Floor record", () => {
  assert.equal(record("floor").supportKind, "floor");
});

test("creates a Back-wall record", () => {
  assert.equal(record("wall_back").supportKind, "wall_back");
});

test("creates a Left-wall record", () => {
  assert.equal(record("wall_left").supportKind, "wall_left");
});

test("creates a Right-wall record", () => {
  assert.equal(record("wall_right").supportKind, "wall_right");
});

test("creates a Ceiling record", () => {
  assert.equal(record("ceiling").supportKind, "ceiling");
});

test("repeated calls return deeply equal results", () => {
  const before = snapshot();
  const after = snapshot({ review: "manually_confirmed" });
  assert.deepEqual(
    finalizeSupportPointDragTransaction(transaction("floor", before), materialKey(after), null),
    finalizeSupportPointDragTransaction(transaction("floor", before), materialKey(after), null)
  );
});

test("transaction and finalization inputs are not mutated", () => {
  const before = snapshot();
  const started = transaction("floor", before);
  const previous = record("wall_back");
  const originalBefore = structuredClone(before);
  const originalStarted = structuredClone(started);
  const originalPrevious = structuredClone(previous);
  finalizeSupportPointDragTransaction(started, materialKey(snapshot({ review: "manually_confirmed" })), previous);
  assert.deepEqual(before, originalBefore);
  assert.deepEqual(started, originalStarted);
  assert.deepEqual(previous, originalPrevious);
});

test("finalization returns new material records", () => {
  const started = transaction();
  const completed = finalizeSupportPointDragTransaction(
    started,
    materialKey(snapshot({ review: "manually_confirmed" })),
    null
  );
  assert.notEqual(completed, started);
});

test("existing prior records are not mutated", () => {
  const previous: SupportPointUndoRecord<Snapshot> = record("wall_right");
  const original = structuredClone(previous);
  finalizeSupportPointDragTransaction(
    transaction("ceiling"),
    materialKey(snapshot({ confirmation: "changed" })),
    previous
  );
  assert.deepEqual(previous, original);
});
