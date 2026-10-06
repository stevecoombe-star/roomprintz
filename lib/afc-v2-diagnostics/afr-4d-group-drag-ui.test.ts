import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AfcDiagnosticEvidenceOverlaySvg } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay";
import { ManualPerspectiveEditor } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective";
import {
  manualPerspectiveBootstrapQuad,
  manualPerspectiveOverlayPoints,
  translateManualPerspectiveImagePoints,
} from "./manual-perspective-geometry";
import {
  editManualPerspectiveImagePoints,
  type ManualPerspectiveSession,
} from "./manual-perspective";

const ROOT = process.cwd();
const OVERLAY = readFileSync(
  path.join(ROOT, "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay.tsx"),
  "utf8",
);
const UI = readFileSync(
  path.join(ROOT, "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective.tsx"),
  "utf8",
);
const VISUAL = readFileSync(
  path.join(ROOT, "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx"),
  "utf8",
);
const RECOVERY = readFileSync(
  path.join(ROOT, "lib/afc-v2-diagnostics/manual-perspective-recovery.server.ts"),
  "utf8",
);

function session(status: ManualPerspectiveSession["status"]): ManualPerspectiveSession {
  const opened = manualPerspectiveBootstrapQuad();
  const imagePoints = status === "solving"
    ? translateManualPerspectiveImagePoints(opened, 0.05, -0.03)
    : opened;
  return {
    baseGenerationId: "33333333-3333-4333-8333-333333333333",
    automaticPoints: opened,
    openedPoints: opened,
    imagePoints,
    sourceImageSize: { width: 1200, height: 800 },
    frameSize: { width: 1200, height: 800 },
    referenceDepthM: 4,
    baselineFovDeg: 0,
    mode: "bootstrap",
    runtime: "diagnostic_only",
    status,
    solveRequestId: status === "solving" ? 3 : 2,
    solution: null,
  };
}

function editorMarkup(status: ManualPerspectiveSession["status"]) {
  return renderToStaticMarkup(createElement(ManualPerspectiveEditor, {
    session: session(status),
    hostGeometryVisible: true,
    applying: false,
    applyMessage: null,
    recoveryEligible: true,
    onEdit: () => {},
    onRevert: () => {},
    onApply: () => {},
    onRecover: () => {},
  }));
}

function overlayMarkup(withGroup: boolean) {
  return renderToStaticMarkup(createElement(AfcDiagnosticEvidenceOverlaySvg, {
    showFloor: false,
    floorPoints: null,
    showCollision: false,
    collisionEdges: [],
    metricSpan: null,
    manualFloor: manualPerspectiveOverlayPoints(manualPerspectiveBootstrapQuad()),
    onManualPointChange: withGroup ? () => {} : null,
    onManualQuadChange: withGroup ? () => {} : null,
  }));
}

test("the quad body is a transparent hit target under the corner handles", () => {
  const html = overlayMarkup(true);
  assert.match(html, /data-evidence-role="manual-perspective-body"/);
  assert.match(html, /fill="rgba\(251, 191, 36, 0\.16\)"/);
  assert.match(html, /cursor:grab/);
  assert.match(html, /pointer-events:auto/);
  assert.doesNotMatch(html, /#7dd3fc/);
  const bodyAt = html.indexOf("manual-perspective-body");
  const handleAt = html.indexOf('r="0.018"');
  assert.ok(bodyAt >= 0 && handleAt > bodyAt);
  assert.match(html, /cx="0\.22"/);
  assert.match(html, />NL</);

  const idle = overlayMarkup(false);
  assert.doesNotMatch(idle, /manual-perspective-body/);
  assert.match(idle, /data-evidence-role="manual-perspective"/);
});

test("group drag keeps the diagnostics block mounted and leaves recovery unchanged", () => {
  const solving = editorMarkup("solving");
  const converged = editorMarkup("converged");
  const solvingDiagnostics = solving.match(/<dl[^>]*data-testid="manual-perspective-diagnostics"[^>]*>/);
  const convergedDiagnostics = converged.match(/<dl[^>]*data-testid="manual-perspective-diagnostics"[^>]*>/);
  assert.ok(solvingDiagnostics && convergedDiagnostics);
  assert.equal(solvingDiagnostics[0], convergedDiagnostics[0]);
  assert.match(solving, /disabled=""/);
  assert.match(solving, /data-testid="manual-perspective-apply"/);
  assert.match(solving, /data-testid="manual-perspective-recover"/);
  assert.match(UI, /editManualPerspectiveImagePoints/);
  assert.match(UI, /120/);
  assert.match(OVERLAY, /onManualQuadChange\(translateManualPerspectiveImagePoints/);
  assert.match(OVERLAY, /groupDragging \? "grabbing" : "grab"/);
  assert.doesNotMatch(OVERLAY, /<svg[^>]*\bkey=/);
  assert.doesNotMatch(VISUAL, /key=\{[^}]*manualOverlay/);
  assert.match(VISUAL, /editQuadRef\.current\?\.\(points\)/);
  assert.doesNotMatch(RECOVERY, /translateManualPerspectiveImagePoints|onManualQuadChange/);
  const dragged = editManualPerspectiveImagePoints(
    session("converged"),
    translateManualPerspectiveImagePoints(manualPerspectiveBootstrapQuad(), 0.05, -0.03),
  );
  assert.equal(dragged.solveRequestId, 3);
});
