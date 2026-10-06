import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AfcDiagnosticEvidenceOverlaySvg,
  AfcDiagnosticMetricSpanContext,
} from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay";
import { buildDurableSourceFloorAuthorityKey } from "@/app/admin/3d-room-lab/floor-source-authority";
import { mapAfcDiagnosticAdminMetricDecision } from "@/lib/afc-v2-diagnostics/admin-metric-decision";
import {
  parseAfcDiagnosticAdminMetricDecisionDto,
  type AfcDiagnosticAdminMetricDecision,
  type AfcDiagnosticAdminMetricDecisionRecordedValue,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision-dto";
import type { AfcV2MetricDecisionDiagnosticV1 } from "@/lib/afc-v2-production/metric-decision-diagnostic";
import {
  hardFallbackMetricDecisionRaw,
  minimalMetricDecisionRaw,
  pathAAcceptedMetricDecisionRaw,
  pathBAcceptedMetricDecisionRaw,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision.fixture";
import {
  AFC_DIAGNOSTIC_METRIC_SPAN_COPY,
  AFC_DIAGNOSTIC_METRIC_SPAN_IMAGE_SPACE,
  AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE,
  afcDiagnosticMetricSpanDefaultSource,
  afcDiagnosticMetricSpanOptions,
  metricSpanContainedPixel,
  metricSpanViewBoxPoint,
  selectAfcDiagnosticMetricSpanOverlay,
  type AfcDiagnosticMetricSpanOverlayModel,
} from "@/lib/afc-v2-diagnostics/admin-metric-span-overlay";

const VISUAL = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx",
);
const OVERLAY = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticMetricSpanOverlay.tsx",
);
const SESSION = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/sessions/[sessionId]/AfcDiagnosticSessionInspector.tsx",
);

function recorded(raw: unknown): Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }> {
  const mapped = mapAfcDiagnosticAdminMetricDecision(raw);
  assert.equal(mapped?.kind, "recorded");
  if (mapped?.kind !== "recorded") throw new Error("expected recorded");
  return mapped;
}

function withSpanTrust(
  decision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>,
  trusted: boolean | null,
  reasonCodes: readonly string[] = decision.value.pathA.spanTrust.reasonCodes,
): Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }> {
  const value: AfcDiagnosticAdminMetricDecisionRecordedValue = {
    ...decision.value,
    pathA: {
      ...decision.value.pathA,
      spanTrust: {
        ...decision.value.pathA.spanTrust,
        trusted,
        reasonCodes,
      },
    },
  };
  return {
    kind: "recorded",
    schemaVersion: decision.schemaVersion,
    value,
  };
}

function withoutSelectedSpan(
  decision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>,
): AfcDiagnosticAdminMetricDecision {
  return {
    ...decision,
    value: {
      ...decision.value,
      finalDecision: {
        ...decision.value.finalDecision,
        selectedPath: "path_a",
        accepted: true,
      },
      pathA: {
        ...decision.value.pathA,
        geometryCorrespondence: {
          ...decision.value.pathA.geometryCorrespondence,
          selectedSpan: null,
        },
      },
    },
  };
}

function withEndpoint(
  decision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>,
  imageA: { x: number; y: number },
): AfcDiagnosticAdminMetricDecision {
  const span = decision.value.pathA.geometryCorrespondence.selectedSpan;
  assert.ok(span);
  return {
    ...decision,
    value: {
      ...decision.value,
      pathA: {
        ...decision.value.pathA,
        geometryCorrespondence: {
          ...decision.value.pathA.geometryCorrespondence,
          selectedSpan: { ...span, imageA },
        },
      },
    },
  };
}

function selectEmpty(decision: AfcDiagnosticAdminMetricDecision) {
  return selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "empty",
  });
}

function withFinalPath(
  decision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>,
  selectedPath: "path_a" | "path_b" | "none",
): Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }> {
  return {
    kind: "recorded",
    schemaVersion: decision.schemaVersion,
    value: {
      ...decision.value,
      finalDecision: {
        ...decision.value.finalDecision,
        selectedPath,
        accepted: selectedPath !== "none",
      },
    },
  };
}

function selectOriginal(decision: AfcDiagnosticAdminMetricDecision) {
  return selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "original",
  });
}

const trusted = recorded(pathAAcceptedMetricDecisionRaw());
const rejected = recorded(hardFallbackMetricDecisionRaw());

const floorPoints = [
  { x: 0.1, y: 0.8 },
  { x: 0.9, y: 0.8 },
  { x: 0.7, y: 0.4 },
  { x: 0.3, y: 0.4 },
];
const collisionEdges = [
  {
    id: "wall-1",
    points: [
      { x: 0.2, y: 0.7 },
      { x: 0.8, y: 0.7 },
    ],
  },
];

function svgMarkup(input: {
  showFloor?: boolean;
  showCollision?: boolean;
  metricSpan?: AfcDiagnosticMetricSpanOverlayModel | null;
}) {
  return renderToStaticMarkup(createElement(AfcDiagnosticEvidenceOverlaySvg, {
    showFloor: input.showFloor ?? false,
    floorPoints,
    showCollision: input.showCollision ?? false,
    collisionEdges,
    metricSpan: input.metricSpan ?? null,
  }));
}

test("recorded trusted selected span is drawable on ORIGINAL only", () => {
  const span = selectOriginal(trusted);
  assert.ok(span);
  assert.equal(span.sourcePath, "path_a");
  assert.equal(span.lineStyle, "solid");
  assert.equal(span.spanId, "span-back");
  assert.equal(span.imageSpace, AFC_DIAGNOSTIC_METRIC_SPAN_IMAGE_SPACE);
  assert.deepEqual(span.imageA, { x: 0.123, y: 0.842 });
  assert.deepEqual(span.imageB, { x: 0.774, y: 0.837 });
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: trusted,
    artifactKind: "empty",
  }), null);
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: trusted,
    artifactKind: "tiled",
  }), null);
});

test("recorded rejected selected span stays drawable", () => {
  const span = selectOriginal(rejected);
  assert.ok(span);
  assert.equal(span.lineStyle, "dashed");
  assert.ok(span.reasonCodes.includes("lab_trust_not_enabled"));
  assert.ok(span.reasonCodes.includes("completeness_not_certified"));
});

test("missing selected span is unavailable even if the conclusion says Path A", () => {
  assert.equal(selectOriginal(recorded(minimalMetricDecisionRaw())), null);
  assert.equal(selectOriginal(withoutSelectedSpan(trusted)), null);
});

test("null, capture_failed, unsupported, and unreadable do not fabricate a span", () => {
  assert.equal(selectOriginal(null), null);
  assert.equal(selectOriginal({
    kind: "capture_failed",
    schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
    generationId: "95b0d26f-0056-4fd1-8e78-2c05abc5ed70",
  }), null);
  assert.equal(selectOriginal({
    kind: "unsupported_schema",
    schemaVersion: "other",
  }), null);
  assert.equal(selectOriginal({ kind: "unreadable" }), null);
});

test("malformed endpoints are not drawable", () => {
  assert.equal(selectOriginal(withEndpoint(trusted, { x: Number.NaN, y: 0.5 })), null);
  assert.equal(selectOriginal(withEndpoint(trusted, {
    x: 0.2,
    y: Number.POSITIVE_INFINITY,
  })), null);
});

test("legacy absence does not reconstruct a span from another conclusion", () => {
  assert.equal(selectOriginal(null), null);
  const span = trusted.value.pathA.geometryCorrespondence.selectedSpan;
  assert.ok(span);
  assert.equal("imageA" in (trusted.value.pathA.geometryCorrespondence.rejectedAlternatives[0] ?? {}), false);
});

test("null span trust is labeled unavailable and is not inferred", () => {
  const span = selectOriginal(withSpanTrust(trusted, null, ["lab_trust_not_enabled"]));
  assert.ok(span);
  assert.equal(span.lineStyle, "dotted");
  const html = renderToStaticMarkup(createElement(AfcDiagnosticMetricSpanContext, { span }));
  assert.match(html, /Path A — Trust unavailable/);
  assert.doesNotMatch(html, /afc-metric-span-reasons/);
  assert.doesNotMatch(html, /lab_trust_not_enabled/);
});

test("trusted span renders endpoints, status, and a solid segment", () => {
  const span = selectOriginal(trusted);
  assert.ok(span);
  const html = svgMarkup({ metricSpan: span });
  assert.match(html, /data-source-path="path_a"/);
  assert.match(html, /data-line-style="solid"/);
  assert.match(html, /data-evidence-kind="metric-span-segment"/);
  assert.doesNotMatch(html, /stroke-dasharray|strokeDasharray/);
  assert.match(html, /data-evidence-kind="metric-span-endpoint-a"/);
  assert.match(html, /data-evidence-kind="metric-span-endpoint-b"/);
  assert.match(html, />A</);
  assert.match(html, />B</);
  assert.match(html, /Path A — Trusted/);
  const context = renderToStaticMarkup(createElement(AfcDiagnosticMetricSpanContext, { span }));
  assert.match(context, /Path A — Trusted/);
  assert.match(context, /span-back/);
  assert.doesNotMatch(context, /\{/);
});

test("rejected span is dashed and shows recorded trust reason codes", () => {
  const span = selectOriginal(rejected);
  assert.ok(span);
  const html = svgMarkup({ metricSpan: span });
  assert.match(html, /data-source-path="path_a"/);
  assert.match(html, /data-line-style="dashed"/);
  assert.match(html, /stroke-dasharray="0\.02 0\.012"|strokeDasharray="0.02 0.012"/);
  assert.match(html, /Path A — Rejected/);
  const context = renderToStaticMarkup(createElement(AfcDiagnosticMetricSpanContext, { span }));
  assert.match(context, /Path A — Rejected/);
  assert.match(context, /lab_trust_not_enabled, completeness_not_certified/);
  assert.doesNotMatch(context, /prompt|provider payload|metric_decision/i);
});

test("Path B accepted host geometry draws on EMPTY only", () => {
  const decision = recorded(pathBAcceptedMetricDecisionRaw());
  const span = selectEmpty(decision);
  assert.ok(span);
  assert.equal(span.sourcePath, "path_b");
  assert.equal(span.targetKind, "empty");
  assert.equal(span.imageSpace, AFC_DIAGNOSTIC_METRIC_SPAN_PATH_B_IMAGE_SPACE);
  assert.equal(span.lineStyle, "solid");
  assert.equal(span.statusLabel, "Path B — Accepted");
  assert.deepEqual(span.imageA, { x: 0.21, y: 0.73 });
  assert.equal(selectOriginal(decision), null);
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "tiled",
  }), null);
  const html = svgMarkup({ metricSpan: span });
  assert.match(html, /data-source-path="path_b"/);
  assert.match(html, /data-line-style="solid"/);
  assert.match(html, /Path B — Accepted/);
});

test("Path B rejected host geometry stays drawable when the final path is none", () => {
  const accepted = recorded(pathBAcceptedMetricDecisionRaw());
  const decision = withFinalPath(accepted, "none");
  const rejectedPath = {
    ...decision,
    value: {
      ...decision.value,
      pathB: {
        ...decision.value.pathB,
        derivation: {
          ...decision.value.pathB.derivation,
          accepted: false,
          reasonCodes: ["host_rejected_observed_span"],
        },
        model: {
          ...decision.value.pathB.model,
          hostAcceptance: {
            class: "weak_rejected",
            reasonCodes: ["weak_estimate"],
            candidateScale: 0.4,
          },
        },
      },
    },
  } as Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>;
  const span = selectEmpty(rejectedPath);
  assert.ok(span);
  assert.equal(span.lineStyle, "dashed");
  assert.equal(span.statusLabel, "Path B — Rejected");
  assert.deepEqual(span.reasonCodes, ["weak_estimate"]);
  const html = svgMarkup({ metricSpan: span });
  assert.match(html, /data-line-style="dashed"/);
  const context = renderToStaticMarkup(createElement(AfcDiagnosticMetricSpanContext, { span }));
  assert.match(context, /Path B — Rejected/);
  assert.match(context, /weak_estimate/);
  assert.doesNotMatch(context, /lab_trust_not_enabled/);
});

test("Path B unusable and not-launched states stay distinct", () => {
  const accepted = recorded(pathBAcceptedMetricDecisionRaw());
  const unusable = {
    ...accepted,
    value: {
      ...accepted.value,
      pathB: {
        ...accepted.value.pathB,
        derivation: { ...accepted.value.pathB.derivation, accepted: false },
        model: {
          ...accepted.value.pathB.model,
          estimatedLengthM: null,
          hostAcceptance: {
            class: "unobservable_rejected",
            reasonCodes: ["estimate_unusable"],
            candidateScale: null,
          },
        },
      },
    },
  } as Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>;
  const unusableSpan = selectEmpty(unusable);
  assert.ok(unusableSpan);
  assert.equal(unusableSpan.statusLabel, "Path B — Unusable");
  assert.equal(unusableSpan.lineStyle, "dotted");
  const notLaunched = {
    ...accepted,
    value: {
      ...accepted.value,
      finalDecision: { ...accepted.value.finalDecision, selectedPath: "none" as const },
      pathB: {
        ...accepted.value.pathB,
        estimatorLaunched: false,
        launchDisposition: "not_launched_empty_bytes_missing" as const,
        derivation: { ...accepted.value.pathB.derivation, accepted: false, reasonCodes: [] },
        model: {
          ...accepted.value.pathB.model,
          estimatedLengthM: null,
          hostAcceptance: null,
        },
      },
    },
  } as Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>;
  const held = selectEmpty(notLaunched);
  assert.ok(held);
  assert.equal(held.statusLabel, "Path B — EMPTY missing");
  assert.equal(selectEmpty(recorded(minimalMetricDecisionRaw())), null);
});

test("both rejected paths are selectable and default to Path B", () => {
  const pathA = withFinalPath(withSpanTrust(trusted, false, ["lab_trust_not_enabled"]), "none");
  const pathB = recorded(pathBAcceptedMetricDecisionRaw());
  const decision = {
    ...pathA,
    value: {
      ...pathA.value,
      pathB: {
        ...pathB.value.pathB,
        derivation: { ...pathB.value.pathB.derivation, accepted: false },
      },
    },
  } as Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>;
  const options = afcDiagnosticMetricSpanOptions(decision);
  assert.deepEqual(options.map((span) => span.sourcePath), ["path_a", "path_b"]);
  assert.equal(afcDiagnosticMetricSpanDefaultSource(options), "path_b");
  assert.equal(selectEmpty(decision)?.sourcePath, "path_b");
  assert.equal(selectOriginal(decision), null);
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "original",
    sourcePath: "path_a",
  })?.sourcePath, "path_a");
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "empty",
    sourcePath: "path_a",
  }), null);
});

test("metric span toggle visibility is independent of floor and collision", () => {
  const span = selectOriginal(trusted);
  assert.ok(span);
  assert.equal(svgMarkup({ metricSpan: null }), "");
  const metricOnly = svgMarkup({ metricSpan: span });
  assert.match(metricOnly, /data-evidence-role="metric-span"/);
  assert.doesNotMatch(metricOnly, /<polygon/);
  assert.doesNotMatch(metricOnly, /<polyline/);
  const floorOnly = svgMarkup({ showFloor: true });
  assert.match(floorOnly, /<polygon/);
  assert.doesNotMatch(floorOnly, /metric-span/);
  const collisionOnly = svgMarkup({ showCollision: true });
  assert.match(collisionOnly, /<polyline/);
  assert.doesNotMatch(collisionOnly, /metric-span/);
  const all = svgMarkup({
    showFloor: true,
    showCollision: true,
    metricSpan: span,
  });
  assert.match(all, /<polygon/);
  assert.match(all, /<polyline/);
  assert.match(all, /data-evidence-role="metric-span"/);
  assert.ok(all.indexOf("<polygon") < all.indexOf("<polyline"));
  assert.ok(all.indexOf("<polyline") < all.indexOf("metric-span"));
});

test("viewBox mapping keeps normalized endpoints and contain-fit scales with the source aspect", () => {
  const point = { x: 0.123, y: 0.842 };
  assert.deepEqual(metricSpanViewBoxPoint(point), point);
  const container = { width: 900, height: 500 };
  const source = { width: 1200, height: 800 };
  const fitted = metricSpanContainedPixel(point, container, source);
  assert.ok(fitted);
  const narrow = metricSpanContainedPixel(point, { width: 300, height: 500 }, source);
  assert.ok(narrow);
  assert.notDeepEqual(narrow, fitted);
  assert.ok(narrow.x < fitted.x);
  assert.ok(narrow.y < fitted.y);
  assert.equal(metricSpanContainedPixel(
    { x: Number.NaN, y: 0.2 },
    container,
    source,
  ), null);
});

test("visual evidence wires Metric span without a new request or metric rerun", () => {
  const visual = readFileSync(VISUAL, "utf8");
  const overlay = readFileSync(OVERLAY, "utf8");
  const session = readFileSync(SESSION, "utf8");
  assert.match(visual, /Metric span|AFC_DIAGNOSTIC_METRIC_SPAN_COPY\.label/);
  assert.match(visual, /No metric span available|AFC_DIAGNOSTIC_METRIC_SPAN_COPY\.unavailable/);
  assert.match(visual, /disabled=\{!metricAvailable\}/);
  assert.match(visual, /setShowMetricSpan/);
  assert.match(visual, /setShowFloor\(event\.target\.checked\)/);
  assert.match(visual, /setShowCollision\(event\.target\.checked\)/);
  assert.doesNotMatch(visual, /setShowFloor\([\s\S]{0,40}setShowMetricSpan|setShowMetricSpan\([\s\S]{0,40}setShowFloor/);
  assert.match(visual, /showMetricOverlay \? metricSpan : null/);
  assert.match(visual, /selectAfcDiagnosticMetricSpanOverlay/);
  assert.doesNotMatch(visual, /evaluateTrustedBackWallWidthSpan|selectMetricCorrespondence/);
  assert.match(visual, /fetch\(/);
  assert.equal(visual.match(/fetch\(/g)?.length, 2);
  assert.doesNotMatch(overlay, /fetch\(|evaluateTrustedBackWallWidthSpan|JSON\.stringify/);
  assert.doesNotMatch(session, /AfcDiagnosticVisualEvidence|AfcDiagnosticMetricSpanOverlay/);
  assert.equal(AFC_DIAGNOSTIC_METRIC_SPAN_COPY.label, "Metric span");
  assert.notEqual(AFC_DIAGNOSTIC_METRIC_SPAN_COPY.label, "Trusted Metric Span");
});

const REAL_FLOOR_KEY = buildDurableSourceFloorAuthorityKey([
  { x: 0.12, y: 0.88 },
  { x: 0.81, y: 0.86 },
  { x: 0.74, y: 0.41 },
  { x: 0.19, y: 0.39 },
]);

function withProductionFloorKey(
  raw: AfcV2MetricDecisionDiagnosticV1,
): AfcV2MetricDecisionDiagnosticV1 {
  const geometry = raw.pathB.hostGeometry;
  if (!geometry) return raw;
  return {
    ...raw,
    pathB: {
      ...raw.pathB,
      hostGeometry: {
        ...geometry,
        floorAuthorityKey: REAL_FLOOR_KEY,
      },
    },
  };
}

function throughReadChain(raw: unknown): AfcDiagnosticAdminMetricDecision {
  const mapped = mapAfcDiagnosticAdminMetricDecision(raw);
  return parseAfcDiagnosticAdminMetricDecisionDto(JSON.parse(JSON.stringify(mapped)));
}

test("accepted Path B with a durable floor key survives the Admin read chain onto EMPTY", () => {
  assert.match(REAL_FLOOR_KEY, /,|\|/);
  const decision = throughReadChain(withProductionFloorKey(pathBAcceptedMetricDecisionRaw()));
  assert.equal(decision?.kind, "recorded");
  if (decision?.kind !== "recorded") return;
  const geometry = decision.value.pathB.hostGeometry;
  assert.ok(geometry);
  assert.equal(geometry?.floorAuthorityKey, REAL_FLOOR_KEY);
  assert.deepEqual(geometry?.imageA, { x: 0.21, y: 0.73 });
  assert.deepEqual(geometry?.imageB, { x: 0.68, y: 0.74 });
  assert.equal(decision.value.finalDecision.selectedPath, "path_b");
  assert.equal(decision.value.pathB.derivation.accepted, true);
  const empty = selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "empty",
  });
  assert.equal(empty?.sourcePath, "path_b");
  assert.equal(empty?.targetKind, "empty");
  assert.equal(empty?.statusLabel, "Path B — Accepted");
  assert.equal(empty?.lineStyle, "solid");
  assert.equal(selectOriginal(decision), null);
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "tiled",
  }), null);
});

test("rejected Path B with a durable floor key stays drawable when the final path is none", () => {
  const accepted = withProductionFloorKey(pathBAcceptedMetricDecisionRaw());
  const raw: AfcV2MetricDecisionDiagnosticV1 = {
    ...accepted,
    finalDecision: {
      ...accepted.finalDecision,
      selectedPath: "none",
      accepted: false,
      fallbackApplied: true,
    },
    pathB: {
      ...accepted.pathB,
      derivation: {
        ...accepted.pathB.derivation,
        accepted: false,
        reasonCodes: ["weak_estimate"],
      },
      modelEstimate: {
        ...accepted.pathB.modelEstimate,
        hostAcceptance: {
          class: "weak_rejected",
          reasonCodes: ["weak_estimate"],
          candidateScale: 1.1,
        },
      },
    },
  };
  const decision = throughReadChain(raw);
  assert.equal(decision?.kind, "recorded");
  if (decision?.kind !== "recorded") return;
  assert.ok(decision.value.pathB.hostGeometry);
  assert.equal(decision.value.fallback.used, false);
  const empty = selectEmpty(decision);
  assert.equal(empty?.sourcePath, "path_b");
  assert.equal(empty?.lineStyle, "dashed");
  assert.equal(empty?.statusLabel, "Path B — Rejected");
  assert.deepEqual(empty?.reasonCodes, ["weak_estimate"]);
  assert.equal(selectOriginal(decision), null);
});

test("both retained spans survive a production floor key and stay on their own frames", () => {
  const pathB = withProductionFloorKey(pathBAcceptedMetricDecisionRaw());
  const pathA = pathAAcceptedMetricDecisionRaw();
  const raw: AfcV2MetricDecisionDiagnosticV1 = {
    ...pathB,
    finalDecision: {
      ...pathB.finalDecision,
      selectedPath: "none",
      accepted: false,
    },
    pathA: {
      ...pathA.pathA,
      spanTrust: {
        ...pathA.pathA.spanTrust,
        trusted: false,
        reasonCodes: ["lab_trust_not_enabled"],
      },
    },
    pathB: {
      ...pathB.pathB,
      derivation: {
        ...pathB.pathB.derivation,
        accepted: false,
        reasonCodes: ["weak_estimate"],
      },
    },
  };
  const decision = throughReadChain(raw);
  assert.equal(decision?.kind, "recorded");
  if (decision?.kind !== "recorded") return;
  assert.ok(decision.value.pathA.geometryCorrespondence.selectedSpan);
  assert.ok(decision.value.pathB.hostGeometry);
  const options = afcDiagnosticMetricSpanOptions(decision);
  assert.deepEqual(options.map((span) => span.sourcePath), ["path_a", "path_b"]);
  assert.equal(afcDiagnosticMetricSpanDefaultSource(options), "path_b");
  const empty = selectEmpty(decision);
  assert.equal(empty?.sourcePath, "path_b");
  assert.equal(empty?.targetKind, "empty");
  const original = selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "original",
    sourcePath: "path_a",
  });
  assert.equal(original?.sourcePath, "path_a");
  assert.equal(original?.targetKind, "original");
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "empty",
    sourcePath: "path_a",
  }), null);
  assert.equal(selectAfcDiagnosticMetricSpanOverlay({
    metricDecision: decision,
    artifactKind: "original",
    sourcePath: "path_b",
  }), null);
});

test("a durable floor key with whitespace or a URL does not publish host geometry", () => {
  for (const floorAuthorityKey of ["0.12, 0.88|0.81,0.86|0.74,0.41|0.19,0.39", "https://example.test/floor"]) {
    const accepted = pathBAcceptedMetricDecisionRaw();
    const geometry = accepted.pathB.hostGeometry;
    assert.ok(geometry);
    const decision = throughReadChain({
      ...accepted,
      pathB: {
        ...accepted.pathB,
        hostGeometry: geometry ? { ...geometry, floorAuthorityKey } : null,
      },
    });
    assert.equal(decision?.kind, "recorded");
    if (decision?.kind !== "recorded") continue;
    assert.equal(decision.value.pathB.hostGeometry, null);
    assert.equal(decision.value.pathB.derivation.accepted, true);
    assert.equal(selectEmpty(decision), null);
  }
});

test("malformed Path B endpoints stay unavailable through the read chain", () => {
  const accepted = pathBAcceptedMetricDecisionRaw();
  const geometry = accepted.pathB.hostGeometry;
  assert.ok(geometry);
  if (!geometry) return;
  const broken = [
    { ...geometry, imageA: { x: Number.NaN, y: 0.73 } },
    { ...geometry, imageB: { y: 0.74 } },
    { ...geometry, imageA: { x: "0.21", y: 0.73 } },
    {
      id: geometry.id,
      role: geometry.role,
      start: geometry.imageA,
      end: geometry.imageB,
      canonicalLength: geometry.canonicalLength,
      sourceSeamId: geometry.sourceSeamId,
      floorAuthorityKey: geometry.floorAuthorityKey,
      s4aCandidateId: geometry.s4aCandidateId,
      freezeReceiptVersion: geometry.freezeReceiptVersion,
      freezePayloadSha256: geometry.freezePayloadSha256,
      overlayImageHash: geometry.overlayImageHash,
      junctionType: geometry.junctionType,
    },
  ];
  for (const hostGeometry of broken) {
    const decision = throughReadChain({
      ...accepted,
      pathB: { ...accepted.pathB, hostGeometry },
    });
    const span = decision ? selectEmpty(decision) : null;
    assert.equal(span, null);
  }
});
