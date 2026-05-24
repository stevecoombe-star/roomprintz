import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTimelineDerivedBaseVersionId,
  type TimelineDerivedBaseVersion,
} from "@/lib/vibode/timeline-derived-base";

function version(
  id: string,
  options?: {
    parentVersionId?: string | null;
    normalizedVersionKind?: TimelineDerivedBaseVersion["normalizedVersionKind"];
    asset_type?: string | null;
  }
): TimelineDerivedBaseVersion {
  return {
    id,
    parentVersionId: options?.parentVersionId ?? null,
    normalizedVersionKind: options?.normalizedVersionKind ?? null,
    asset_type: options?.asset_type ?? null,
  };
}

test("ORIGINAL selected returns selected_original", () => {
  const versions = [version("orig", { normalizedVersionKind: "original", asset_type: "base" })];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "orig" });
  assert.deepEqual(result, {
    ok: true,
    baseVersionId: "orig",
    selectedVersionId: "orig",
    strategy: "selected_original",
    ancestorPath: ["orig"],
  });
});

test("SET selected returns selected_set", () => {
  const versions = [version("set1", { normalizedVersionKind: "set", parentVersionId: "orig" })];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "set1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "set1");
  assert.equal(result.strategy, "selected_set");
});

test("STAGE child of SET resolves nearest_set_ancestor", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("set1", { normalizedVersionKind: "set", parentVersionId: "orig" }),
    version("stage1", { normalizedVersionKind: "stage", parentVersionId: "set1" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "stage1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "set1");
  assert.equal(result.strategy, "nearest_set_ancestor");
  assert.deepEqual(result.ancestorPath, ["stage1", "set1"]);
});

test("STYLE child of SET resolves nearest_set_ancestor", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("set1", { normalizedVersionKind: "set", parentVersionId: "orig" }),
    version("stage1", { normalizedVersionKind: "stage", parentVersionId: "set1" }),
    version("style1", { normalizedVersionKind: "style", parentVersionId: "stage1" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "style1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "set1");
  assert.equal(result.strategy, "nearest_set_ancestor");
});

test("STAGE branch with no SET ancestor resolves nearest_original_ancestor", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("stage1", { normalizedVersionKind: "stage", parentVersionId: "orig" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "stage1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "orig");
  assert.equal(result.strategy, "nearest_original_ancestor");
});

test("STYLE branch with no SET ancestor resolves nearest_original_ancestor", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("stage1", { normalizedVersionKind: "stage", parentVersionId: "orig" }),
    version("style1", { normalizedVersionKind: "style", parentVersionId: "stage1" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "style1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "orig");
  assert.equal(result.strategy, "nearest_original_ancestor");
});

test("SET sibling timelines resolve to timeline-local SET", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("setA", { normalizedVersionKind: "set", parentVersionId: "orig" }),
    version("stageA", { normalizedVersionKind: "stage", parentVersionId: "setA" }),
    version("setB", { normalizedVersionKind: "set", parentVersionId: "orig" }),
    version("stageB", { normalizedVersionKind: "stage", parentVersionId: "setB" }),
  ];

  const resultA = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "stageA" });
  const resultB = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "stageB" });
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  if (!resultA.ok || !resultB.ok) return;
  assert.equal(resultA.baseVersionId, "setA");
  assert.equal(resultB.baseVersionId, "setB");
});

test("UNKNOWN selected with SET ancestor resolves nearest_set_ancestor", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("set1", { normalizedVersionKind: "set", parentVersionId: "orig" }),
    version("u1", { normalizedVersionKind: "unknown", parentVersionId: "set1" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "u1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "set1");
  assert.equal(result.strategy, "nearest_set_ancestor");
});

test("UNKNOWN selected with ORIGINAL ancestor only resolves nearest_original_ancestor", () => {
  const versions = [
    version("orig", { normalizedVersionKind: "original", asset_type: "base" }),
    version("u1", { normalizedVersionKind: "unknown", parentVersionId: "orig" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "u1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "orig");
  assert.equal(result.strategy, "nearest_original_ancestor");
});

test("missing selectedVersionId returns missing_selected_version_id", () => {
  const result = resolveTimelineDerivedBaseVersionId({
    versions: [version("orig", { normalizedVersionKind: "original", asset_type: "base" })],
    selectedVersionId: null,
  });
  assert.deepEqual(result, {
    ok: false,
    selectedVersionId: null,
    reason: "missing_selected_version_id",
    ancestorPath: [],
  });
});

test("selected version not found returns selected_version_not_found", () => {
  const result = resolveTimelineDerivedBaseVersionId({
    versions: [version("orig", { normalizedVersionKind: "original", asset_type: "base" })],
    selectedVersionId: "missing",
  });
  assert.deepEqual(result, {
    ok: false,
    selectedVersionId: "missing",
    reason: "selected_version_not_found",
    ancestorPath: [],
  });
});

test("broken parent chain returns no_timeline_base_found", () => {
  const versions = [version("stage1", { normalizedVersionKind: "stage", parentVersionId: "missing-parent" })];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "stage1" });
  assert.deepEqual(result, {
    ok: false,
    selectedVersionId: "stage1",
    reason: "no_timeline_base_found",
    ancestorPath: ["stage1"],
  });
});

test("cycle safety: no infinite loop and returns no_timeline_base_found when no base exists", () => {
  const versions = [
    version("a", { normalizedVersionKind: "stage", parentVersionId: "b" }),
    version("b", { normalizedVersionKind: "unknown", parentVersionId: "a" }),
  ];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "a" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no_timeline_base_found");
  assert.deepEqual(result.ancestorPath, ["a", "b"]);
});

test("asset_type base fallback treats selected as ORIGINAL", () => {
  const versions = [version("orig", { asset_type: "base" })];
  const result = resolveTimelineDerivedBaseVersionId({ versions, selectedVersionId: "orig" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.baseVersionId, "orig");
  assert.equal(result.strategy, "selected_original");
});
