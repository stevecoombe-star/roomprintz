import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPPORT_EDIT_KIND_ORDER,
  canFocusSupport,
  createUnlockedSupportEditLocks,
  resolveSupportEditFocusAfterLockToggle,
  resolveSupportEditInteraction,
  resolveSupportEditRenderOrder,
  toggleSupportEditFocus,
  toggleSupportEditLock,
  type SupportEditInteractionInput,
} from "./support-edit-interaction";
import type { SupportKind } from "./support-model";

function input(overrides: Partial<SupportEditInteractionInput> = {}): SupportEditInteractionInput {
  return {
    kind: "floor",
    visible: true,
    baseEditable: true,
    locked: false,
    activeFocus: null,
    ...overrides,
  };
}

function resolved(activeFocus: SupportKind | null = null) {
  const locks = createUnlockedSupportEditLocks();
  return Object.fromEntries(
    SUPPORT_EDIT_KIND_ORDER.map((kind) => [
      kind,
      resolveSupportEditInteraction(input({ kind, locked: locks[kind], activeFocus })),
    ])
  ) as Record<SupportKind, ReturnType<typeof resolveSupportEditInteraction>>;
}

test("all supports begin unlocked", () => {
  assert.deepEqual(createUnlockedSupportEditLocks(), {
    floor: false,
    wall_back: false,
    wall_left: false,
    wall_right: false,
    ceiling: false,
  });
});

test("no focus preserves base render order", () => {
  assert.deepEqual(resolveSupportEditRenderOrder(resolved()), SUPPORT_EDIT_KIND_ORDER);
});

test("no focus keeps visible editable supports interactive", () => {
  for (const kind of SUPPORT_EDIT_KIND_ORDER) {
    assert.equal(resolveSupportEditInteraction(input({ kind })).interactive, true);
  }
});

test("hidden supports are never interactive", () => {
  assert.equal(resolveSupportEditInteraction(input({ visible: false })).interactive, false);
});

test("existing non-editable supports remain non-interactive", () => {
  assert.equal(resolveSupportEditInteraction(input({ baseEditable: false })).interactive, false);
});

test("focusing Floor makes only Floor focused", () => {
  const states = resolved("floor");
  assert.equal(states.floor.focused, true);
  assert.equal(states.wall_back.focused, false);
});

test("focusing Back makes only Back focused", () => {
  const states = resolved("wall_back");
  assert.equal(states.wall_back.focused, true);
  assert.equal(states.floor.focused, false);
});

test("focusing Left makes only Left focused", () => {
  const states = resolved("wall_left");
  assert.equal(states.wall_left.focused, true);
  assert.equal(states.wall_back.focused, false);
});

test("focusing Right makes only Right focused", () => {
  const states = resolved("wall_right");
  assert.equal(states.wall_right.focused, true);
  assert.equal(states.wall_left.focused, false);
});

test("focusing Ceiling makes only Ceiling focused", () => {
  const states = resolved("ceiling");
  assert.equal(states.ceiling.focused, true);
  assert.equal(states.floor.focused, false);
});

test("an eligible focused support remains interactive", () => {
  assert.equal(resolveSupportEditInteraction(input({ activeFocus: "floor" })).interactive, true);
});

test("non-focused supports become non-interactive while focus exists", () => {
  assert.equal(
    resolveSupportEditInteraction(input({ kind: "wall_back", activeFocus: "floor" })).interactive,
    false
  );
});

test("non-focused supports remain visible while focus exists", () => {
  assert.equal(
    resolveSupportEditInteraction(input({ kind: "wall_back", activeFocus: "floor" })).showEditingControls,
    true
  );
});

test("focused editing controls render last", () => {
  const order = resolveSupportEditRenderOrder(resolved("wall_left"));
  assert.equal(order.at(-1), "wall_left");
});

test("every support appears exactly once in render order", () => {
  const order = resolveSupportEditRenderOrder(resolved("ceiling"));
  assert.equal(order.length, SUPPORT_EDIT_KIND_ORDER.length);
  assert.equal(new Set(order).size, SUPPORT_EDIT_KIND_ORDER.length);
});

test("active Edit action toggles focus clear", () => {
  assert.equal(toggleSupportEditFocus(input({ activeFocus: "floor" })), null);
});

test("locking a support disables its interaction", () => {
  const locks = toggleSupportEditLock(createUnlockedSupportEditLocks(), "wall_back");
  assert.equal(resolveSupportEditInteraction(input({ kind: "wall_back", locked: locks.wall_back })).interactive, false);
});

test("locking does not mark a support hidden", () => {
  const locked = resolveSupportEditInteraction(input({ locked: true }));
  assert.equal(locked.showEditingControls, true);
});

test("locking does not alter unrelated support states", () => {
  const before = createUnlockedSupportEditLocks();
  const after = toggleSupportEditLock(before, "wall_left");
  assert.equal(after.floor, false);
  assert.equal(after.ceiling, false);
});

test("locking the focused support clears focus", () => {
  assert.equal(resolveSupportEditFocusAfterLockToggle("floor", "floor", true), null);
});

test("unlocking does not auto-focus", () => {
  const locked = toggleSupportEditLock(createUnlockedSupportEditLocks(), "ceiling");
  const unlocked = toggleSupportEditLock(locked, "ceiling");
  assert.equal(unlocked.ceiling, false);
  assert.equal(resolveSupportEditInteraction(input({ kind: "ceiling", locked: unlocked.ceiling })).focused, false);
});

test("a locked support cannot be focused", () => {
  assert.equal(canFocusSupport(input({ locked: true })), false);
});

test("Floor lock follows the common interaction policy", () => {
  const locked = resolveSupportEditInteraction(input({ kind: "floor", locked: true }));
  assert.deepEqual(locked, {
    focused: false,
    interactive: false,
    renderPriority: "base",
    showEditingControls: true,
  });
});

test("a hidden focused support is not effectively interactive", () => {
  const states = resolved("floor");
  states.floor = resolveSupportEditInteraction(input({ visible: false, activeFocus: "floor" }));
  assert.equal(states.floor.interactive, false);
  assert.deepEqual(resolveSupportEditRenderOrder(states), SUPPORT_EDIT_KIND_ORDER);
});

test("a hidden locked support remains hidden and locked without affecting others", () => {
  const hiddenLocked = resolveSupportEditInteraction(input({ kind: "wall_right", visible: false, locked: true }));
  const other = resolveSupportEditInteraction(input({ kind: "ceiling" }));
  assert.equal(hiddenLocked.showEditingControls, false);
  assert.equal(other.interactive, true);
});

test("showing an unlocked support restores eligibility without auto-focus", () => {
  assert.equal(canFocusSupport(input({ visible: true })), true);
  assert.equal(resolveSupportEditInteraction(input({ visible: true })).focused, false);
});

test("showing a locked support leaves it non-interactive", () => {
  assert.equal(resolveSupportEditInteraction(input({ visible: true, locked: true })).interactive, false);
});

test("fixed support-kind order is deterministic", () => {
  assert.deepEqual([...SUPPORT_EDIT_KIND_ORDER], ["floor", "wall_back", "wall_left", "wall_right", "ceiling"]);
});

test("repeated resolution returns deeply equal results", () => {
  const value = input({ kind: "wall_right", activeFocus: "wall_right" });
  assert.deepEqual(resolveSupportEditInteraction(value), resolveSupportEditInteraction(value));
});

test("interaction resolution does not mutate its input", () => {
  const value = input({ kind: "wall_back" });
  const before = structuredClone(value);
  resolveSupportEditInteraction(value);
  assert.deepEqual(value, before);
});

test("lock updates return a new record", () => {
  const before = createUnlockedSupportEditLocks();
  const after = toggleSupportEditLock(before, "floor");
  assert.notEqual(after, before);
});

test("lock updates preserve unrelated lock values", () => {
  const before = { ...createUnlockedSupportEditLocks(), wall_right: true };
  const after = toggleSupportEditLock(before, "floor");
  assert.equal(after.wall_right, true);
  assert.equal(after.floor, true);
});
