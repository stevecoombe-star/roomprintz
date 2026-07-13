import type { SupportKind } from "./support-model";

export const SUPPORT_EDIT_KIND_ORDER: readonly SupportKind[] = [
  "floor",
  "wall_back",
  "wall_left",
  "wall_right",
  "ceiling",
];

export type SupportEditFocus = SupportKind | null;

export type SupportEditLocks = Record<SupportKind, boolean>;

export type SupportEditInteractionInput = {
  kind: SupportKind;
  visible: boolean;
  baseEditable: boolean;
  locked: boolean;
  activeFocus: SupportEditFocus;
};

export type SupportEditInteractionState = {
  focused: boolean;
  interactive: boolean;
  renderPriority: "base" | "focused";
  showEditingControls: boolean;
};

export function createUnlockedSupportEditLocks(): SupportEditLocks {
  return {
    floor: false,
    wall_back: false,
    wall_left: false,
    wall_right: false,
    ceiling: false,
  };
}

export function canFocusSupport(input: SupportEditInteractionInput): boolean {
  return input.visible && input.baseEditable && !input.locked;
}

export function toggleSupportEditFocus(input: SupportEditInteractionInput): SupportEditFocus {
  if (input.activeFocus === input.kind) return null;
  return canFocusSupport(input) ? input.kind : input.activeFocus;
}

export function resolveSupportEditFocusAfterLockToggle(
  activeFocus: SupportEditFocus,
  kind: SupportKind,
  willLock: boolean
): SupportEditFocus {
  return willLock && activeFocus === kind ? null : activeFocus;
}

export function resolveSupportEditInteraction(
  input: SupportEditInteractionInput
): SupportEditInteractionState {
  const focused = input.activeFocus === input.kind;
  const showEditingControls = input.visible && input.baseEditable;
  return {
    focused,
    interactive:
      showEditingControls &&
      !input.locked &&
      (input.activeFocus === null || focused),
    renderPriority: focused ? "focused" : "base",
    showEditingControls,
  };
}

export function toggleSupportEditLock(
  locks: Readonly<SupportEditLocks>,
  kind: SupportKind
): SupportEditLocks {
  return {
    ...locks,
    [kind]: !locks[kind],
  };
}

/**
 * The caller supplies resolved interaction facts, so unavailable focus can be
 * represented as base priority without changing support geometry or identity.
 */
export function resolveSupportEditRenderOrder(
  resolved: Readonly<Record<SupportKind, SupportEditInteractionState>>,
  baseOrder: readonly SupportKind[] = SUPPORT_EDIT_KIND_ORDER
): SupportKind[] {
  const focused = baseOrder.find((kind) => {
    const state = resolved[kind];
    return state.renderPriority === "focused" && state.showEditingControls && state.interactive;
  });
  return focused
    ? [...baseOrder.filter((kind) => kind !== focused), focused]
    : [...baseOrder];
}
