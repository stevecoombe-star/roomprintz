import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ManualPerspectiveEditor } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective";
import { canonicalWorldRectangle } from "./manual-perspective-geometry";
import {
  MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS,
  type ManualPerspectiveSession,
} from "./manual-perspective";
import type { ManualPerspectiveSolveResult } from "./manual-perspective-solve";

const POINTS = {
  NL: { x: 0.1035, y: 0.8502 },
  NR: { x: 0.2857, y: 0.7848 },
  FR: { x: 0.2291, y: 0.7217 },
  FL: { x: 0.0822, y: 0.7656 },
} as const;

function session(
  status: ManualPerspectiveSession["status"],
  solution: ManualPerspectiveSolveResult | null,
  imagePoints: ManualPerspectiveSession["imagePoints"] = POINTS,
): ManualPerspectiveSession {
  return {
    baseGenerationId: "33333333-3333-4333-8333-333333333333",
    automaticPoints: POINTS,
    openedPoints: POINTS,
    imagePoints,
    sourceImageSize: { width: 1144, height: 1534 },
    frameSize: { width: 1144, height: 1534 },
    referenceDepthM: 4,
    baselineFovDeg: 84.9,
    mode: "adjust",
    runtime: "overlay",
    status,
    solveRequestId: 3,
    solution,
  };
}

function solvedResult(
  imagePoints: ManualPerspectiveSession["imagePoints"],
  verticalFovDeg: number,
): ManualPerspectiveSolveResult {
  const worldRectangle = canonicalWorldRectangle(verticalFovDeg === 84.9 ? 2.88 : 3.12, 4);
  if (!worldRectangle) throw new Error("rectangle");
  return {
    status: "converged",
    imagePoints,
    worldRectangle,
    verticalFovDeg,
    pose: {
      position: { x: 0, y: verticalFovDeg === 84.9 ? 1.6 : 9.144, z: 4 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    objectivePx: verticalFovDeg === 84.9 ? 0.42 : 0.81,
    iterationCount: verticalFovDeg === 84.9 ? 11 : 20,
    convergenceReason: "apply_safe",
    elapsedMs: verticalFovDeg === 84.9 ? 21.5 : 19,
    applySafe: true,
  };
}

function markup(value: ManualPerspectiveSession) {
  return renderToStaticMarkup(createElement(ManualPerspectiveEditor, {
    session: value,
    hostGeometryVisible: true,
    applying: false,
    applyMessage: null,
    onEdit: () => {},
    onRevert: () => {},
    onApply: () => {},
  }));
}

function labels(html: string) {
  return [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1]);
}

function field(html: string, testId: string) {
  const match = html.match(new RegExp(`data-testid="${testId}"[^>]*>([^<]*)`));
  return match?.[1] ?? "";
}

test("diagnostics keep the same rows while solving, after solve, and when unrealizable", () => {
  const solved = session("converged", solvedResult(POINTS, 84.9));
  const dragged = {
    ...POINTS,
    FL: { x: 0.0862, y: 0.7636 },
  };
  const pending = session("solving", solved.solution, dragged);
  const completed = session("converged", solvedResult(dragged, 88.4), dragged);
  const unrealizable = session("unrealizable", {
    status: "unrealizable",
    imagePoints: dragged,
    worldRectangle: null,
    verticalFovDeg: null,
    pose: null,
    objectivePx: null,
    iterationCount: 12,
    convergenceReason: "no_apply_safe_candidate",
    elapsedMs: 18,
    applySafe: false,
  }, dragged);

  const pendingHtml = markup(pending);
  const completedHtml = markup(completed);
  const unrealizableHtml = markup(unrealizable);
  const expected = [...MANUAL_PERSPECTIVE_DIAGNOSTIC_LABELS];

  assert.deepEqual(labels(pendingHtml), expected);
  assert.deepEqual(labels(completedHtml), expected);
  assert.deepEqual(labels(unrealizableHtml), expected);
  assert.equal(field(pendingHtml, "manual-perspective-status"), "Solving…");
  assert.equal(field(pendingHtml, "manual-perspective-fov"), "84.9°");
  assert.equal(field(pendingHtml, "manual-perspective-camera-height"), "1.600 m");
  assert.equal(field(pendingHtml, "manual-perspective-solve-time"), "21.50 ms");
  assert.match(pendingHtml, /value="0\.0862"/);
  assert.match(pendingHtml, /value="0\.7636"/);
  assert.equal(field(completedHtml, "manual-perspective-status"), "Converged");
  assert.equal(field(completedHtml, "manual-perspective-fov"), "88.4°");
  assert.equal(field(completedHtml, "manual-perspective-ratio"), "0.780");
  assert.equal(field(unrealizableHtml, "manual-perspective-status"), "Unrealizable");
  assert.equal(field(unrealizableHtml, "manual-perspective-fov"), "—");
  assert.equal(field(unrealizableHtml, "manual-perspective-camera-height"), "—");
  for (const html of [pendingHtml, completedHtml, unrealizableHtml]) {
    assert.match(html, /data-testid="manual-perspective-unrealizable"/);
    assert.match(html, /data-testid="manual-perspective-diagnostics"/);
  }
  assert.match(noticeTag(pendingHtml), /invisible/);
  assert.match(noticeTag(completedHtml), /invisible/);
  assert.doesNotMatch(noticeTag(unrealizableHtml), /invisible/);
});

function noticeTag(html: string) {
  const match = html.match(/<p[^>]*data-testid="manual-perspective-unrealizable"[^>]*>/);
  assert.ok(match);
  return match[0];
}
