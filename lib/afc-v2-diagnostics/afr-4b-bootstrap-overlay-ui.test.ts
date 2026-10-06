import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AfcDiagnosticEvidenceOverlaySvg } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay";
import { ManualPerspectiveEditor } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective";
import { visualEvidenceViewportStyle } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence";
import { bootstrapManualHostKind } from "./admin-visual-overlay.client";
import {
  manualPerspectiveBootstrapQuad,
  manualPerspectiveOverlayPoints,
} from "./manual-perspective-geometry";
import {
  editManualPerspectivePoint,
  type ManualPerspectiveSession,
} from "./manual-perspective";

const VISUAL = readFileSync(
  path.join(
    process.cwd(),
    "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx",
  ),
  "utf8",
);
const UI = readFileSync(
  path.join(
    process.cwd(),
    "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticManualPerspective.tsx",
  ),
  "utf8",
);

function session(
  status: ManualPerspectiveSession["status"],
  imagePoints = manualPerspectiveBootstrapQuad(),
): ManualPerspectiveSession {
  return {
    baseGenerationId: "33333333-3333-4333-8333-333333333333",
    automaticPoints: manualPerspectiveBootstrapQuad(),
    openedPoints: manualPerspectiveBootstrapQuad(),
    imagePoints,
    sourceImageSize: { width: 1200, height: 800 },
    frameSize: { width: 1200, height: 800 },
    referenceDepthM: 4,
    baselineFovDeg: 0,
    mode: "bootstrap",
    runtime: "diagnostic_only",
    status,
    solveRequestId: 1,
    solution: null,
  };
}

function overlayMarkup(
  points: ReturnType<typeof manualPerspectiveOverlayPoints>,
  floor: ReadonlyArray<{ x: number; y: number }> | null,
) {
  return renderToStaticMarkup(createElement(AfcDiagnosticEvidenceOverlaySvg, {
    showFloor: floor != null,
    floorPoints: floor,
    showCollision: false,
    collisionEdges: [],
    metricSpan: null,
    manualFloor: points,
    onManualPointChange: () => {},
  }));
}

test("bootstrap quad renders four handles without an automatic floor", () => {
  const points = manualPerspectiveOverlayPoints(manualPerspectiveBootstrapQuad());
  const html = overlayMarkup(points, null);
  assert.match(html, /data-evidence-role="manual-perspective"/);
  assert.doesNotMatch(html, /#7dd3fc/);
  for (const label of ["NL", "NR", "FR", "FL"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /cx="0\.22"/);
  assert.match(html, /cy="0\.9"/);
  assert.match(html, /cx="0\.78"/);
  assert.match(html, /cx="0\.64"/);
  assert.match(html, /cy="0\.58"/);
  assert.match(html, /cx="0\.36"/);
});

test("bootstrap handles stay visible while solving and while unrealizable", () => {
  const solving = manualPerspectiveOverlayPoints(session("solving").imagePoints);
  const unrealizable = manualPerspectiveOverlayPoints(session("unrealizable").imagePoints);
  const solvingHtml = overlayMarkup(solving, null);
  const unrealizableHtml = overlayMarkup(unrealizable, null);
  assert.equal(solvingHtml, unrealizableHtml);
  assert.match(solvingHtml, /data-evidence-role="manual-perspective"/);
  assert.match(solvingHtml, />NL</);
});

test("an existing automatic quad still renders with the manual quad", () => {
  const automatic = [
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.9 },
    { x: 0.65, y: 0.55 },
    { x: 0.35, y: 0.55 },
  ];
  const html = overlayMarkup(
    manualPerspectiveOverlayPoints(manualPerspectiveBootstrapQuad()),
    automatic,
  );
  assert.match(html, /#7dd3fc/);
  assert.match(html, /data-evidence-role="manual-perspective"/);
  assert.match(html, /#fbbf24/);
});

test("an unsupported artifact explains why the manual quad is hidden", () => {
  const html = renderToStaticMarkup(createElement(ManualPerspectiveEditor, {
    session: session("solving"),
    hostGeometryVisible: false,
    applying: false,
    applyMessage: null,
    onEdit: () => {},
    onRevert: () => {},
    onApply: () => {},
  }));
  assert.match(html, /data-testid="manual-perspective-host-hidden"/);
  assert.match(html, /ORIGINAL can host these points/);
  const adjust = renderToStaticMarkup(createElement(ManualPerspectiveEditor, {
    session: { ...session("converged"), mode: "adjust", runtime: "overlay" },
    hostGeometryVisible: false,
    applying: false,
    applyMessage: null,
    onEdit: () => {},
    onRevert: () => {},
    onApply: () => {},
  }));
  assert.match(adjust, /does not share the accepted floor geometry/);
  assert.doesNotMatch(adjust, /ORIGINAL can host these points/);
});

test("a dragged bootstrap point updates the overlay before a solve result exists", () => {
  const solving = session("solving");
  const dragged = editManualPerspectivePoint(solving, "NL", 0.31, 0.88);
  assert.equal(dragged.status, "solving");
  assert.equal(dragged.solution, null);
  const points = manualPerspectiveOverlayPoints(dragged.imagePoints);
  assert.equal(points[0]?.label, "NL");
  assert.equal(points[0]?.x, 0.31);
  assert.equal(points[0]?.y, 0.88);
  assert.match(overlayMarkup(points, null), /cx="0\.31"/);
  assert.match(UI, /manualPerspectiveOverlayPoints\(session\.imagePoints\)/);
  assert.doesNotMatch(UI, /solution\.imagePoints/);
});

test("opening bootstrap on an unsupported tab selects ORIGINAL once", () => {
  assert.equal(bootstrapManualHostKind({
    current: "empty",
    sourceNormalizedHost: false,
    pinned: false,
  }), "original");
  assert.equal(bootstrapManualHostKind({
    current: "tiled",
    sourceNormalizedHost: false,
    pinned: false,
  }), "original");
  assert.equal(bootstrapManualHostKind({
    current: "empty",
    sourceNormalizedHost: true,
    pinned: false,
  }), null);
  assert.equal(bootstrapManualHostKind({
    current: "tiled",
    sourceNormalizedHost: false,
    pinned: true,
  }), null);
  assert.equal(bootstrapManualHostKind({
    current: "original",
    sourceNormalizedHost: false,
    pinned: false,
  }), null);
});

test("the visual evidence viewport is not keyed by the manual quad", () => {
  assert.match(
    VISUAL,
    /data-visual-evidence-viewport=""\s+className="relative w-full"\s+style=\{viewportStyle\}/,
  );
  assert.match(VISUAL, /hostGeometryVisible=\{sourceNormalizedHost\}/);
  assert.doesNotMatch(VISUAL, /Boolean\(committedOverlay\?\.floorQuad\)/);
  const frame = { width: 1200, height: 800 };
  assert.deepEqual(visualEvidenceViewportStyle(frame), visualEvidenceViewportStyle(frame));
});
