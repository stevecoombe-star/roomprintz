/**
 * Per-room 2D / 3D editor mode.
 *
 * Same localStorage shape as the Catalog drawer preference: one map of
 * room id → choice. A missing or invalid entry uses the existing editor
 * default and must not block the editor from opening.
 */

import {
  createInitialEditorViewportMode,
  type EditorViewportMode,
} from "./editor-viewport-mode";

export const EDITOR_VIEWPORT_MODE_STORAGE_KEY = "vibode:editor-viewport-mode/v1";

const MODES = new Set<EditorViewportMode>(["2d", "3d"]);

function isMode(value: unknown): value is EditorViewportMode {
  return typeof value === "string" && MODES.has(value as EditorViewportMode);
}

function emptyStore(): Record<string, EditorViewportMode> {
  return {};
}

export function parseEditorViewportModeStore(
  value: unknown,
): Record<string, EditorViewportMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyStore();
  const rooms = (value as { rooms?: unknown }).rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) return emptyStore();
  const parsed: Record<string, EditorViewportMode> = {};
  for (const [roomId, mode] of Object.entries(rooms)) {
    if (!roomId.trim() || !isMode(mode)) continue;
    parsed[roomId] = mode;
  }
  return parsed;
}

export function readEditorViewportModePreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
  roomId: string | null | undefined,
): EditorViewportMode | null {
  if (!storage || !roomId?.trim()) return null;
  try {
    const raw = storage.getItem(EDITOR_VIEWPORT_MODE_STORAGE_KEY);
    if (!raw) return null;
    const rooms = parseEditorViewportModeStore(JSON.parse(raw));
    return rooms[roomId] ?? null;
  } catch {
    return null;
  }
}

export function writeEditorViewportModePreference(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  roomId: string | null | undefined,
  mode: EditorViewportMode,
): void {
  if (!storage || !roomId?.trim() || !isMode(mode)) return;
  let rooms = emptyStore();
  try {
    const raw = storage.getItem(EDITOR_VIEWPORT_MODE_STORAGE_KEY);
    if (raw) rooms = parseEditorViewportModeStore(JSON.parse(raw));
  } catch {
    rooms = emptyStore();
  }
  if (rooms[roomId] === mode) return;
  rooms[roomId] = mode;
  try {
    storage.setItem(
      EDITOR_VIEWPORT_MODE_STORAGE_KEY,
      JSON.stringify({ rooms }),
    );
  } catch {
    // Privacy mode or quota must not break the editor.
  }
}

/** Saved mode for this room, or the existing editor default. */
export function resolvePersistedEditorViewportMode(
  storage: Pick<Storage, "getItem"> | null | undefined,
  roomId: string | null | undefined,
): EditorViewportMode {
  return readEditorViewportModePreference(storage, roomId) ?? createInitialEditorViewportMode();
}

export function editorViewportModeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
