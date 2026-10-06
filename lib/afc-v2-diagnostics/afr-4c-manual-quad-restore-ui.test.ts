import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AfcDiagnosticEvidenceOverlaySvg } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay";
import { ManualPerspectiveEditor } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective";
import { manualPerspectiveOverlayPoints } from "./manual-perspective-geometry";
import {
  type ManualPerspectiveSession,
} from "./manual-perspective";

const RESTORED = {
  NL: { x: 0.1, y: 0.9 },
  NR: { x: 0.9, y: 0.9 },
  FR: { x: 0.65, y: 0.55 },
  FL: { x: 0.35, y: 0.55 },
} as const;

function session(): ManualPerspectiveSession {
  return {
    baseGenerationId: "11111111-1111-4111-8111-111111111111",
    automaticPoints: RESTORED,
    openedPoints: RESTORED,
    imagePoints: RESTORED,
    sourceImageSize: { width: 1200, height: 800 },
    frameSize: { width: 1200, height: 800 },
    referenceDepthM: 4,
    baselineFovDeg: 0,
    mode: "bootstrap",
    runtime: "diagnostic_only",
    status: "converged",
    solveRequestId: 2,
    solution: null,
  };
}

test("a restored recovery quad renders as amber manual handles without a cyan floor", () => {
  const html = renderToStaticMarkup(createElement(AfcDiagnosticEvidenceOverlaySvg, {
    showFloor: false,
    floorPoints: null,
    showCollision: false,
    collisionEdges: [],
    metricSpan: null,
    manualFloor: manualPerspectiveOverlayPoints(RESTORED),
    onManualPointChange: () => {},
  }));
  assert.match(html, /data-evidence-role="manual-perspective"/);
  assert.match(html, /#fbbf24/);
  assert.doesNotMatch(html, /#7dd3fc/);
  assert.match(html, /cx="0\.1"/);
  assert.match(html, /cx="0\.9"/);
  assert.match(html, />NL</);
  assert.match(html, />FL</);
});

test("the editor names a restored recovery quad and does not call it automatic", () => {
  const html = renderToStaticMarkup(createElement(ManualPerspectiveEditor, {
    session: session(),
    hostGeometryVisible: true,
    applying: false,
    applyMessage: null,
    restoredRecoveryQuad: true,
    onEdit: () => {},
    onRevert: () => {},
    onApply: () => {},
  }));
  assert.match(html, /data-testid="manual-perspective-restored-quad"/);
  assert.match(html, /Loaded the last manual recovery quad/);
  assert.match(html, /No AFC floor quad was available/);
  assert.doesNotMatch(html, /automatic AFC evidence/);
  assert.match(html, /value="0\.1000"/);
  assert.match(html, /value="0\.3500"/);
  const fresh = renderToStaticMarkup(createElement(ManualPerspectiveEditor, {
    session: session(),
    hostGeometryVisible: true,
    applying: false,
    applyMessage: null,
    onEdit: () => {},
    onRevert: () => {},
    onApply: () => {},
  }));
  assert.doesNotMatch(fresh, /data-testid="manual-perspective-restored-quad"/);
});
