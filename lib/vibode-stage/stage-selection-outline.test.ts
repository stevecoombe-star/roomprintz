import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseStageGizmoAllowlist,
  stageDirectManipulationAvailable,
  stageTransformGizmosEnabled,
} from "./stage-gizmo-capability";
import {
  STAGE_OUTLINE_HOVER_OPACITY,
  STAGE_OUTLINE_HOVER_WHITE_MIX,
  STAGE_OUTLINE_KERNEL_RADIUS,
  STAGE_OUTLINE_SELECTED_OPACITY,
  STAGE_OUTLINE_WIDTH_PX,
  VIBODE_VIEWPORT_FRAME_VAR,
  normalizeCssColorToHex,
  readVibodeViewportFrameColor,
  stageOutlineDeviceRadius,
  stageOutlineHoverColor,
  stageOutlineStyle,
  stageOutlineTargets,
} from "./stage-selection-outline";

const viewportCss = readFileSync("app/globals.css", "utf8");
const viewportFrameMatch = viewportCss.match(
  /--vibode-viewport-frame:\s*(#[0-9A-Fa-f]{6})\s*;/,
);
const VIEWPORT_FRAME = viewportFrameMatch?.[1]?.toUpperCase() ?? "";

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const closed = {
  userId: USER,
  stageMode: undefined as string | undefined,
  stageAllowlist: new Set<string>(),
};

test("an idle object has no outline", () => {
  assert.deepEqual(stageOutlineTargets({
    selectedObjectId: null,
    hoveredObjectId: null,
  }), []);
});

test("hover uses the dim outline and leaves it when the pointer leaves", () => {
  const hovered = stageOutlineTargets({
    selectedObjectId: null,
    hoveredObjectId: "chair",
  });
  assert.equal(hovered.length, 1);
  assert.equal(hovered[0]?.role, "hover");
  assert.equal(stageOutlineStyle("hover", VIEWPORT_FRAME).opacity, STAGE_OUTLINE_HOVER_OPACITY);
  assert.ok(STAGE_OUTLINE_HOVER_OPACITY < STAGE_OUTLINE_SELECTED_OPACITY);
  assert.deepEqual(stageOutlineTargets({
    selectedObjectId: null,
    hoveredObjectId: null,
  }), []);
});

test("selection uses the brighter outline and clears on deselect", () => {
  const selected = stageOutlineTargets({
    selectedObjectId: "chair",
    hoveredObjectId: null,
  });
  assert.equal(selected[0]?.role, "selected");
  assert.equal(stageOutlineStyle("selected", VIEWPORT_FRAME).color, VIEWPORT_FRAME);
  assert.equal(
    stageOutlineStyle("hover", VIEWPORT_FRAME).color,
    stageOutlineHoverColor(VIEWPORT_FRAME),
  );
  assert.deepEqual(stageOutlineTargets({
    selectedObjectId: null,
    hoveredObjectId: null,
  }), []);
});

test("selection takes precedence and another object can still show hover", () => {
  const same = stageOutlineTargets({
    selectedObjectId: "chair",
    hoveredObjectId: "chair",
  });
  assert.deepEqual(same, [{ objectId: "chair", role: "selected" }]);

  const both = stageOutlineTargets({
    selectedObjectId: "chair",
    hoveredObjectId: "table",
  });
  assert.deepEqual(both, [
    { objectId: "chair", role: "selected" },
    { objectId: "table", role: "hover" },
  ]);
});

test("the outline is 10 CSS pixels in the viewport-frame blue", () => {
  assert.equal(VIEWPORT_FRAME, "#38BDF8");
  const aura = viewportCss.slice(
    viewportCss.indexOf(".vibe-aura::before"),
    viewportCss.indexOf(".paste-to-place-pulse-ring"),
  );
  assert.match(aura, new RegExp(`var\\(${VIBODE_VIEWPORT_FRAME_VAR}\\)`));
  assert.doesNotMatch(aura, /rgba\(\s*56\s*,\s*189\s*,\s*248/);
  assert.equal(STAGE_OUTLINE_WIDTH_PX, 10);
  const hover = stageOutlineStyle("hover", VIEWPORT_FRAME);
  const selected = stageOutlineStyle("selected", VIEWPORT_FRAME);
  assert.equal(hover.widthPx, 10);
  assert.equal(selected.widthPx, 10);
  assert.equal(hover.widthPx, selected.widthPx);
  assert.equal(stageOutlineDeviceRadius(hover.widthPx, 2), 20);
  assert.equal(
    stageOutlineDeviceRadius(hover.widthPx, 2),
    stageOutlineDeviceRadius(selected.widthPx, 2),
  );
  assert.equal(STAGE_OUTLINE_KERNEL_RADIUS, STAGE_OUTLINE_WIDTH_PX * 2);
  assert.equal(STAGE_OUTLINE_HOVER_OPACITY, 0.6);
  assert.equal(STAGE_OUTLINE_SELECTED_OPACITY, 0.92);
  assert.equal(stageOutlineStyle("selected", VIEWPORT_FRAME).color, "#38BDF8");
  assert.equal(stageOutlineStyle("hover", VIEWPORT_FRAME).color, "#CDEFFD");
  assert.equal(STAGE_OUTLINE_HOVER_WHITE_MIX, 0.75);
  assert.equal(stageOutlineStyle("hover", VIEWPORT_FRAME).opacity, 0.6);
  assert.equal(stageOutlineStyle("selected", VIEWPORT_FRAME).opacity, 0.92);
  assert.equal(readVibodeViewportFrameColor(() => " #38bdf8 "), "#38BDF8");
  assert.equal(readVibodeViewportFrameColor(() => "rgb(56, 189, 248)"), "#38BDF8");
  assert.equal(normalizeCssColorToHex("rgb(56, 189, 248)"), VIEWPORT_FRAME);
  assert.ok(STAGE_OUTLINE_KERNEL_RADIUS >= STAGE_OUTLINE_WIDTH_PX * 2);
  const outline = readFileSync("lib/vibode-stage/stage-selection-outline.ts", "utf8");
  assert.match(outline, /VIBODE_VIEWPORT_FRAME_VAR/);
  assert.doesNotMatch(outline, /#[0-9A-Fa-f]{3,8}/);
});

test("only the stage gizmo env gate enables gizmos", () => {
  assert.equal(stageTransformGizmosEnabled(closed), false);
  assert.equal(stageTransformGizmosEnabled({ ...closed, stageMode: "off" }), false);
  assert.equal(stageTransformGizmosEnabled({
    ...closed,
    stageMode: "allowlist",
    stageAllowlist: parseStageGizmoAllowlist(USER),
  }), true);
  assert.equal(stageTransformGizmosEnabled({
    ...closed,
    stageMode: "allowlist",
    stageAllowlist: parseStageGizmoAllowlist(OTHER),
  }), false);
  assert.equal(stageTransformGizmosEnabled({
    ...closed,
    stageMode: "all",
  }), true);
  assert.equal(stageTransformGizmosEnabled({
    ...closed,
    stageMode: "enabled",
  }), false);
  assert.equal(stageTransformGizmosEnabled({
    ...closed,
    userId: "not-a-user",
    stageMode: "all",
  }), false);
});

test("hiding the gizmo does not retire direct manipulation", () => {
  assert.equal(stageDirectManipulationAvailable(false), true);
  assert.equal(stageDirectManipulationAvailable(true), true);
  const viewer = readFileSync("components/afc-3d/AfcProductionRoomViewer.tsx", "utf8");
  assert.match(viewer, /planCanonicalMoveDrag/);
  assert.match(viewer, /resolveExplicitYaw/);
  assert.match(viewer, /commitUserSizeMultiplier/);
  assert.match(viewer, /showTransformGizmosRef\.current/);
  assert.match(viewer, /stageOutlineTargets/);
  assert.match(viewer, /let hoveredObjectId/);
  assert.doesNotMatch(viewer, /MeshBasicMaterial/);
  assert.doesNotMatch(viewer, /useState<[^>]*>\(.*hover/i);
});

test("gizmo entitlement is server-gated and outline chrome is not scene data", () => {
  const route = readFileSync("app/api/vibode/stage/transform-gizmos/route.ts", "utf8");
  const handler = readFileSync("lib/vibode-stage/stage-gizmo-capability.server.ts", "utf8");
  const outline = readFileSync("lib/vibode-stage/stage-selection-outline.ts", "utf8");
  const hook = readFileSync("lib/vibode-stage/use-stage-transform-gizmos.ts", "utf8");
  assert.doesNotMatch(`${route}\n${handler}\n${hook}`, /searchParams|URLSearchParams/);
  assert.match(handler, /authorizeProductionAfcUser/);
  assert.match(handler, /VIBODE_STAGE_GIZMOS/);
  assert.doesNotMatch(
    `${route}\n${handler}\n${readFileSync("lib/vibode-stage/stage-gizmo-capability.ts", "utf8")}`,
    /isAdminEmail|VIBODE_ADMIN_EMAIL|resolveAfcQaCapability|VIBODE_AFC_QA/,
  );
  assert.doesNotMatch(outline, /serializeRuntimeScene|canonicalTransform/);
  assert.doesNotMatch(
    readFileSync("app/internal/vibode-thumbnail-render/ThumbnailRenderFrame.tsx", "utf8"),
    /stageOutlineTargets|TransformControls/,
  );
  assert.doesNotMatch(
    readFileSync("app/editor/page.tsx", "utf8"),
    /\/api\/vibode\/afc\/qa\/capability|qa-capability/,
  );
});
