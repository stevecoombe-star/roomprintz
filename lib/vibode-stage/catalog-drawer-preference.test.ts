import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { stageDrawerLayout } from "./drawer-state";
import {
  STAGE_CATALOG_DRAWER_STORAGE_KEY,
  parseCatalogDrawerStore,
  readCatalogDrawerPreference,
  resolveCatalogDrawerOpen,
  writeCatalogDrawerPreference,
  type StageCatalogDrawerPreference,
} from "./catalog-drawer-preference";
import {
  STAGE_CANVAS_HEIGHT_CLASS,
  STAGE_CANVAS_WIDTH_CLASS,
} from "./types";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(STAGE_CATALOG_DRAWER_STORAGE_KEY, initial);
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    dump() {
      return values.get(STAGE_CATALOG_DRAWER_STORAGE_KEY) ?? null;
    },
  };
}

test("new uploaded room with a missing scene row starts Catalog expanded", () => {
  const resolution = resolveCatalogDrawerOpen({
    preference: null,
    baseline: "missing",
  });
  assert.equal(resolution.open, true);
  assert.equal(resolution.settled, true);
  assert.equal(resolution.establish, "expanded");
});

test("collapsed Catalog restores for the same room", () => {
  const storage = memoryStorage();
  writeCatalogDrawerPreference(storage, "room-a", "collapsed");
  assert.equal(readCatalogDrawerPreference(storage, "room-a"), "collapsed");
  const resolution = resolveCatalogDrawerOpen({
    preference: readCatalogDrawerPreference(storage, "room-a"),
    baseline: "missing",
  });
  assert.equal(resolution.open, false);
  assert.equal(resolution.settled, true);
  assert.equal(resolution.establish, null);
});

test("expanded Catalog restores for the same room", () => {
  const storage = memoryStorage();
  writeCatalogDrawerPreference(storage, "room-a", "expanded");
  const resolution = resolveCatalogDrawerOpen({
    preference: readCatalogDrawerPreference(storage, "room-a"),
    baseline: "persisted",
  });
  assert.equal(resolution.open, true);
  assert.equal(resolution.establish, null);
});

test("a new room still starts expanded when another room is collapsed", () => {
  const storage = memoryStorage();
  writeCatalogDrawerPreference(storage, "room-a", "collapsed");
  const roomB = resolveCatalogDrawerOpen({
    preference: readCatalogDrawerPreference(storage, "room-b"),
    baseline: "missing",
  });
  assert.equal(roomB.open, true);
  assert.equal(roomB.establish, "expanded");
  assert.equal(readCatalogDrawerPreference(storage, "room-a"), "collapsed");
});

test("an existing empty scene is not treated as a new-room first entry", () => {
  const resolution = resolveCatalogDrawerOpen({
    preference: null,
    baseline: "persisted",
  });
  assert.equal(resolution.open, false);
  assert.equal(resolution.settled, true);
  assert.equal(resolution.establish, null);
});

test("generation mismatch and failed loads do not force Catalog open", () => {
  for (const baseline of ["incompatible", "unavailable"] as const) {
    const resolution = resolveCatalogDrawerOpen({
      preference: null,
      baseline,
    });
    assert.equal(resolution.open, false);
    assert.equal(resolution.settled, true);
  }
  assert.equal(
    resolveCatalogDrawerOpen({ preference: null, baseline: "unresolved" }).settled,
    false,
  );
});

test("storage ignores malformed values and unavailable storage", () => {
  assert.deepEqual(parseCatalogDrawerStore(null), {});
  assert.deepEqual(parseCatalogDrawerStore("{"), {});
  assert.deepEqual(parseCatalogDrawerStore({ rooms: { "room-a": "wide-open", "room-b": "collapsed" } }), {
    "room-b": "collapsed",
  });
  const broken = memoryStorage("{not-json");
  assert.equal(readCatalogDrawerPreference(broken, "room-a"), null);
  writeCatalogDrawerPreference(broken, "room-a", "expanded");
  assert.equal(readCatalogDrawerPreference(broken, "room-a"), "expanded");
  assert.equal(readCatalogDrawerPreference(null, "room-a"), null);
  writeCatalogDrawerPreference(null, "room-a", "expanded");

  const throwing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(readCatalogDrawerPreference(throwing, "room-a"), null);
  writeCatalogDrawerPreference(throwing, "room-a", "collapsed");
});

test("drawer preference does not change the fixed canvas size", () => {
  for (const preference of ["expanded", "collapsed"] as StageCatalogDrawerPreference[]) {
    const open = preference === "expanded";
    const layout = stageDrawerLayout({ catalogOpen: open, summaryOpen: true });
    assert.equal(layout.canvasWidthClass, STAGE_CANVAS_WIDTH_CLASS);
    assert.equal(layout.canvasHeightClass, STAGE_CANVAS_HEIGHT_CLASS);
  }
  const closed = stageDrawerLayout({ catalogOpen: false, summaryOpen: false });
  const opened = stageDrawerLayout({ catalogOpen: true, summaryOpen: true });
  assert.equal(closed.canvasWidthClass, opened.canvasWidthClass);
  assert.equal(closed.canvasHeightClass, opened.canvasHeightClass);
});

test("STAGE applies the per-room resolver without resizing the canvas", () => {
  const context = source("components/stage/StageEditorContext.tsx");
  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const editor = source("app/editor/page.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");
  assert.match(context, /resolveCatalogDrawerOpen/);
  assert.match(context, /readCatalogDrawerPreference/);
  assert.match(context, /writeCatalogDrawerPreference/);
  assert.match(context, /STAGE_CATALOG_DRAWER_STORAGE_KEY|catalog-drawer-preference/);
  assert.match(drawer, /catalogSettled/);
  assert.match(drawer, /data-stage-catalog=\{/);
  assert.match(editor, /roomId=\{editorRoomId\}/);
  assert.match(editor, /h-\[70vh\] w-\[70vw\] max-w-\[1200px\]/);
  assert.match(shell, /StageSummaryDrawer/);
  assert.doesNotMatch(context, /objects\.length === 0/);
});
