import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AfcDiagnosticMetricSpanContext } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay";
import {
  resolveVisualEvidenceViewportFrame,
  visualEvidenceMetricSpanDetailSlotClassName,
  visualEvidenceViewportStyle,
  type VisualEvidenceFrame,
} from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence";
import { AFC_DIAGNOSTIC_METRIC_SPAN_COPY } from "@/lib/afc-v2-diagnostics/admin-metric-span-overlay";
import { AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS } from "@/lib/afc-v2-diagnostics/admin-visual-evidence.client";

const VISUAL = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx",
);

const ORIGINAL = { width: 1200, height: 800 };
const EMPTY = { width: 600, height: 400 };
const TILED = { width: 2400, height: 1600 };
const SQUARE = { width: 800, height: 800 };
const GENERATION = { width: 1200, height: 800 };

function ratio(frame: VisualEvidenceFrame): number {
  return frame.width / frame.height;
}

function frameFor(
  kind: "original" | "empty" | "tiled",
  overlay: VisualEvidenceFrame | null,
  retained: VisualEvidenceFrame | null,
) {
  return resolveVisualEvidenceViewportFrame({
    overlayFrame: overlay,
    retainedFrame: retained,
    originalDecodedFrame: ORIGINAL,
    generationFrame: GENERATION,
    preferOriginalDecoded: kind === "original",
  });
}

test("reserved viewport uses the committed overlay frame", () => {
  const frame = frameFor("empty", EMPTY, ORIGINAL);
  assert.deepEqual(frame, EMPTY);
  const style = visualEvidenceViewportStyle(frame!);
  assert.equal(style.aspectRatio, "600 / 400");
  assert.match(style.maxWidth, /min\(100%, calc\(min\(70vh, 32rem\)/);
  assert.doesNotMatch(style.aspectRatio, /px/);
  assert.doesNotMatch(style.maxWidth, /\b\d+px\b/);
});

test("loading keeps the previous frame instead of collapsing", () => {
  const duringEmpty = frameFor("empty", null, ORIGINAL);
  const duringTiled = frameFor("tiled", null, EMPTY);
  const duringOriginal = frameFor("original", null, TILED);
  assert.deepEqual(duringEmpty, ORIGINAL);
  assert.deepEqual(duringTiled, EMPTY);
  assert.deepEqual(duringOriginal, TILED);
});

test("shared artifact ratios resolve to one viewport ratio", () => {
  const original = frameFor("original", ORIGINAL, null);
  const empty = frameFor("empty", EMPTY, null);
  const tiled = frameFor("tiled", TILED, null);
  assert.ok(original && empty && tiled);
  assert.equal(ratio(original), ratio(empty));
  assert.equal(ratio(empty), ratio(tiled));
  assert.equal(
    visualEvidenceViewportStyle(original).aspectRatio,
    "1200 / 800",
  );
});

test("different source ratios stay source-specific", () => {
  const original = frameFor("original", ORIGINAL, null);
  const empty = frameFor("empty", SQUARE, null);
  assert.ok(original && empty);
  assert.notEqual(ratio(original), ratio(empty));
  assert.deepEqual(empty, SQUARE);
});

test("before any overlay, original uses decoded size and others use the generation frame", () => {
  assert.deepEqual(frameFor("original", null, null), ORIGINAL);
  assert.deepEqual(frameFor("empty", null, null), GENERATION);
  assert.deepEqual(frameFor("tiled", null, null), GENERATION);
  assert.equal(
    resolveVisualEvidenceViewportFrame({
      overlayFrame: null,
      retainedFrame: null,
      originalDecodedFrame: null,
      generationFrame: null,
      preferOriginalDecoded: false,
    }),
    null,
  );
});

test("viewport markup reserves the frame for loading, image, error, and overlay", () => {
  const visual = readFileSync(VISUAL, "utf8");
  assert.match(visual, /data-visual-evidence-viewport=""/);
  assert.match(visual, /style=\{viewportStyle\}/);
  assert.match(visual, /absolute inset-0 h-full w-full object-contain/);
  assert.match(visual, /AFC_DIAGNOSTIC_VISUAL_EVIDENCE_COPY\.loading/);
  assert.match(visual, /role="alert"/);
  assert.match(visual, /AfcDiagnosticEvidenceOverlaySvg/);
  assert.match(visual, /showImage &&/);
  assert.match(visual, /isCommitted && phase === "ready" && imageUrl/);
  assert.equal((visual.match(/await fetch\(/g) ?? []).length, 2);
  assert.doesNotMatch(visual, /h-\[500px\]|height:\s*500px|h-\[32rem\]/);
  assert.doesNotMatch(visual, /object-cover/);
  assert.doesNotMatch(visual, /prefetch|new Image\(/);
  for (const kind of AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS) {
    assert.match(visual, new RegExp(kind));
  }
  assert.match(
    visual,
    /aria-pressed=\{kind === candidate\}/,
  );
  assert.match(
    visual,
    /className=\{visualEvidenceSourceButtonClassName\(kind === candidate\)\}/,
  );
});

function metricSpanDetailRegion(source: string): string {
  const start = source.indexOf("data-metric-span-detail-slot");
  const end = source.indexOf("data-visual-evidence-viewport");
  assert.ok(start > 0);
  assert.ok(end > start);
  return source.slice(start, end);
}

test("metric span detail slot stays mounted with a shared minimum height", () => {
  const visual = readFileSync(VISUAL, "utf8");
  const slot = metricSpanDetailRegion(visual);
  assert.match(slot, /data-metric-span-detail-slot=""/);
  assert.match(slot, /visualEvidenceMetricSpanDetailSlotClassName/);
  assert.match(visualEvidenceMetricSpanDetailSlotClassName, /min-h-\[4\.5rem\]/);
  assert.doesNotMatch(visualEvidenceMetricSpanDetailSlotClassName, /\bheight\b|overflow-hidden|line-clamp|truncate|text-ellipsis/);
  assert.match(slot, /AFC_DIAGNOSTIC_METRIC_SPAN_COPY\.help/);
  assert.doesNotMatch(slot, /showMetricSpan[\s\S]{0,80}AFC_DIAGNOSTIC_METRIC_SPAN_COPY\.help/);
  assert.match(slot, /AFC_DIAGNOSTIC_METRIC_SPAN_COPY\.unavailable/);
  assert.match(slot, /AfcDiagnosticMetricSpanContext/);
  assert.match(slot, /!metricAvailable \?/);
  assert.match(slot, /showMetricOverlay && metricSpan \?/);
  assert.equal(slot.includes("—"), false);
  assert.doesNotMatch(slot, /Not available|placeholder/);
  assert.equal((visual.match(/await fetch\(/g) ?? []).length, 2);
  assert.match(visual, /resolveVisualEvidenceViewportFrame/);
  assert.match(visual, /object-contain/);
});

test("rejected reason codes stay fully visible and can grow the slot", () => {
  const overlay = readFileSync(
    path.join(
      process.cwd(),
      "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay.tsx",
    ),
    "utf8",
  );
  assert.match(overlay, /data-testid="afc-metric-span-reasons"/);
  assert.match(overlay, /span\.reasonCodes\.join\(", "\)/);
  assert.doesNotMatch(overlay, /overflow-hidden|line-clamp|text-ellipsis|truncate/);
  const markup = renderToStaticMarkup(
    createElement(AfcDiagnosticMetricSpanContext, {
      span: {
        sourcePath: "path_a",
        imageSpace: "original-source-normalized-image/v1",
        targetKind: "original",
        imageA: { x: 0.1, y: 0.2 },
        imageB: { x: 0.8, y: 0.9 },
        spanId: "rb_seam_floor_wall_back",
        reasonCodes: ["span_trust_rejected", "endpoint_incomplete", "grid_mismatch"],
        role: "back_floor_wall",
        canonicalLength: 11.134161,
        statusLabel: AFC_DIAGNOSTIC_METRIC_SPAN_COPY.rejected,
        lineStyle: "dashed",
      },
    }),
  );
  assert.match(markup, /Path A — Rejected/);
  assert.match(markup, /rb_seam_floor_wall_back/);
  assert.match(markup, /span_trust_rejected, endpoint_incomplete, grid_mismatch/);
  assert.doesNotMatch(markup, /overflow-hidden|line-clamp|text-ellipsis/);
});
