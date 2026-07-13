import type { SupportKind } from "./support-model";

export type SupportPointDragTransaction<TSnapshot> = {
  supportKind: SupportKind;
  before: TSnapshot;
  beforeKey: string;
};

export type SupportPointUndoRecord<TSnapshot> = {
  supportKind: SupportKind;
  before: TSnapshot;
  beforeKey: string;
  afterKey: string;
};

export type SupportPointUndoConsumption<TSnapshot> = {
  snapshot: TSnapshot;
  nextUndoRecord: null;
};

export type SupportPointUndoShortcutInput = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
};

function cloneSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  return structuredClone(snapshot);
}

/**
 * Starts one drag transaction without modifying an existing completed record.
 * Callers own the material snapshot/key adapters for their support state.
 */
export function beginSupportPointDragTransaction<TSnapshot>(
  supportKind: SupportKind,
  before: TSnapshot,
  beforeKey: string
): SupportPointDragTransaction<TSnapshot> {
  return {
    supportKind,
    before: cloneSnapshot(before),
    beforeKey,
  };
}

/**
 * A no-op drag retains the prior completed record. A material drag replaces it
 * with exactly one record, regardless of how many pointer updates occurred.
 */
export function finalizeSupportPointDragTransaction<TSnapshot>(
  transaction: SupportPointDragTransaction<TSnapshot>,
  afterKey: string,
  previousUndoRecord: SupportPointUndoRecord<TSnapshot> | null
): SupportPointUndoRecord<TSnapshot> | null {
  if (transaction.beforeKey === afterKey) return previousUndoRecord;
  return {
    supportKind: transaction.supportKind,
    before: cloneSnapshot(transaction.before),
    beforeKey: transaction.beforeKey,
    afterKey,
  };
}

export function canApplySupportPointUndo<TSnapshot>(
  record: SupportPointUndoRecord<TSnapshot> | null,
  currentKey: string,
  hasActiveDrag: boolean
): boolean {
  return !!record && !hasActiveDrag && record.afterKey === currentKey;
}

/**
 * Returns the immutable restoration snapshot and explicitly leaves no undo
 * record. This package intentionally has no redo state.
 */
export function consumeSupportPointUndo<TSnapshot>(
  record: SupportPointUndoRecord<TSnapshot> | null
): SupportPointUndoConsumption<TSnapshot> | null {
  if (!record) return null;
  return {
    snapshot: cloneSnapshot(record.before),
    nextUndoRecord: null,
  };
}

export function isSupportPointUndoShortcut(input: SupportPointUndoShortcutInput): boolean {
  const isUndoKey = input.key === "z" || input.key === "Z";
  const hasExactlyOnePrimaryModifier = input.metaKey !== input.ctrlKey;
  return (
    isUndoKey &&
    hasExactlyOnePrimaryModifier &&
    !input.shiftKey &&
    !input.altKey &&
    input.repeat !== true
  );
}
