import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createInitialEditorViewportMode } from "./editor-viewport-mode";
import {
  EDITOR_VIEWPORT_MODE_STORAGE_KEY,
  parseEditorViewportModeStore,
  readEditorViewportModePreference,
  resolvePersistedEditorViewportMode,
  writeEditorViewportModePreference,
} from "./editor-viewport-mode-preference";

const ROOT = process.cwd();
const ROOM_A = "room-a";
const ROOM_B = "room-b";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(EDITOR_VIEWPORT_MODE_STORAGE_KEY, initial);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    dump() {
      return values.get(EDITOR_VIEWPORT_MODE_STORAGE_KEY) ?? null;
    },
  };
}

test("a room with no saved mode uses the existing editor default", () => {
  const storage = memoryStorage();
  assert.equal(readEditorViewportModePreference(storage, ROOM_A), null);
  assert.equal(
    resolvePersistedEditorViewportMode(storage, ROOM_A),
    createInitialEditorViewportMode(),
  );
  assert.equal(createInitialEditorViewportMode(), "2d");
  assert.equal(resolvePersistedEditorViewportMode(null, ROOM_A), "2d");
  assert.equal(resolvePersistedEditorViewportMode(storage, null), "2d");
  assert.equal(resolvePersistedEditorViewportMode(storage, "   "), "2d");
});

test("switching a room to 3D restores 3D after editor state is recreated", () => {
  const storage = memoryStorage();
  assert.equal(resolvePersistedEditorViewportMode(storage, ROOM_A), "2d");
  writeEditorViewportModePreference(storage, ROOM_A, "3d");
  const reloaded = memoryStorage(storage.dump() ?? undefined);
  assert.equal(resolvePersistedEditorViewportMode(reloaded, ROOM_A), "3d");
});

test("switching a room back to 2D restores 2D after editor state is recreated", () => {
  const storage = memoryStorage();
  writeEditorViewportModePreference(storage, ROOM_A, "3d");
  writeEditorViewportModePreference(storage, ROOM_A, "2d");
  const reloaded = memoryStorage(storage.dump() ?? undefined);
  assert.equal(resolvePersistedEditorViewportMode(reloaded, ROOM_A), "2d");
});

test("rooms keep independent 2D and 3D preferences", () => {
  const storage = memoryStorage();
  writeEditorViewportModePreference(storage, ROOM_A, "3d");
  writeEditorViewportModePreference(storage, ROOM_B, "2d");
  assert.equal(resolvePersistedEditorViewportMode(storage, ROOM_A), "3d");
  assert.equal(resolvePersistedEditorViewportMode(storage, ROOM_B), "2d");
  assert.equal(resolvePersistedEditorViewportMode(storage, ROOM_A), "3d");
  writeEditorViewportModePreference(storage, ROOM_B, "3d");
  assert.equal(resolvePersistedEditorViewportMode(storage, ROOM_A), "3d");
});

test("malformed or unsupported stored modes fall back to the existing default", () => {
  assert.deepEqual(parseEditorViewportModeStore(null), {});
  assert.deepEqual(parseEditorViewportModeStore("3d"), {});
  assert.deepEqual(parseEditorViewportModeStore({ rooms: ["3d"] }), {});
  assert.deepEqual(
    parseEditorViewportModeStore({
      rooms: {
        [ROOM_A]: "perspective",
        [ROOM_B]: "3d",
        "  ": "2d",
      },
    }),
    { [ROOM_B]: "3d" },
  );

  const broken = memoryStorage("{not-json");
  assert.equal(readEditorViewportModePreference(broken, ROOM_A), null);
  assert.equal(resolvePersistedEditorViewportMode(broken, ROOM_A), "2d");
  writeEditorViewportModePreference(broken, ROOM_A, "3d");
  assert.equal(resolvePersistedEditorViewportMode(broken, ROOM_A), "3d");

  const unsupported = memoryStorage(JSON.stringify({ rooms: { [ROOM_A]: "orthographic" } }));
  assert.equal(resolvePersistedEditorViewportMode(unsupported, ROOM_A), "2d");

  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(readEditorViewportModePreference(throwing, ROOM_A), null);
  assert.equal(resolvePersistedEditorViewportMode(throwing, ROOM_A), "2d");
  writeEditorViewportModePreference(throwing, ROOM_A, "3d");
});

test("opening another room resolves that room and does not reuse the previous room mode", () => {
  const storage = memoryStorage();
  writeEditorViewportModePreference(storage, ROOM_A, "3d");
  writeEditorViewportModePreference(storage, ROOM_B, "2d");
  const openA = resolvePersistedEditorViewportMode(storage, ROOM_A);
  const openB = resolvePersistedEditorViewportMode(storage, ROOM_B);
  const returnA = resolvePersistedEditorViewportMode(storage, ROOM_A);
  assert.equal(openA, "3d");
  assert.equal(openB, "2d");
  assert.notEqual(openB, openA);
  assert.equal(returnA, "3d");
});

test("editor restores and writes viewport mode per room without skipping 3D setup", () => {
  const editor = source("app/editor/page.tsx");
  const roomSwitch = editor.slice(
    editor.indexOf("const previousEditorRoomIdRef"),
    editor.indexOf("usePrepare3dRoom(editorRoomId)"),
  );
  assert.match(roomSwitch, /resolvePersistedEditorViewportMode\(editorViewportModeStorage\(\), editorRoomId\)/);
  assert.match(roomSwitch, /setRuntimeTransformMode\("move"\)/);
  assert.match(roomSwitch, /setAfcRuntimeReloadKey\(0\)/);
  assert.doesNotMatch(roomSwitch, /useEffect/);
  assert.doesNotMatch(roomSwitch, /setViewportMode\(viewportMode\)/);

  assert.match(editor, /useLayoutEffect\(\(\) => \{/);
  assert.match(
    editor,
    /resolvePersistedEditorViewportMode\(\s*editorViewportModeStorage\(\),\s*editorRoomId,\s*\)/,
  );
  assert.match(editor, /writeEditorViewportModePreference\(\s*editorViewportModeStorage\(\),\s*editorRoomId,\s*mode,\s*\)/);
  assert.match(editor, /setViewportMode\(mode\)/);
  assert.match(editor, /onChange=\{selectEditorViewportMode\}/);
  assert.match(editor, /shouldAutoPrepareIntegrated3d\(\{/);
  assert.match(editor, /usePrepare3dRoom\(editorRoomId\)/);
  assert.match(editor, /createInitialEditorViewportMode/);
});
