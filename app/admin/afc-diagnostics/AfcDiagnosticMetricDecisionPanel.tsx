"use client";

import { Fragment, type ReactNode } from "react";

import type {
  AfcDiagnosticAdminLegacyMetricConclusion,
  AfcDiagnosticAdminMetricDecision,
  AfcDiagnosticAdminMetricDecisionRecordedValue,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision-dto";
import {
  AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE,
  formatAfcDiagnosticMetricBoolean,
  formatAfcDiagnosticMetricConfidence,
  formatAfcDiagnosticMetricFailureState,
  formatAfcDiagnosticMetricLaunchDisposition,
  formatAfcDiagnosticMetricLineageStatus,
  formatAfcDiagnosticMetricNumber,
  formatAfcDiagnosticMetricPath,
  formatAfcDiagnosticMetricPathBOutcome,
  formatAfcDiagnosticMetricPoint,
  formatAfcDiagnosticMetricSanity,
  formatAfcDiagnosticMetricToken,
  formatAfcDiagnosticMetricTriple,
} from "@/lib/afc-v2-diagnostics/admin-metric-decision-format";

const summaryClassName =
  "cursor-pointer text-sm text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80";

const nestedDetailsClassName =
  "rounded-xl border border-slate-800 bg-slate-950/40 p-3";

function FieldGrid({
  rows,
}: {
  rows: readonly (readonly [string, ReactNode])[];
}) {
  return (
    <dl className="mt-2 grid grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2">
      {rows.map(([label, value], index) => (
        <Fragment key={`${label}-${index}`}>
          <dt className="text-sm text-slate-400">{label}</dt>
          <dd className="min-w-0 break-words text-sm text-slate-100">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function ReasonCodes({ codes }: { codes: readonly string[] }) {
  if (codes.length === 0) {
    return <span>None</span>;
  }
  return (
    <ul className="space-y-1">
      {codes.map((code, index) => (
        <li key={`${code}-${index}`} className="font-mono text-xs text-slate-100">
          {code}
        </li>
      ))}
    </ul>
  );
}

function Subsection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </div>
  );
}

function FinalResult({
  metricStatus,
  value,
}: {
  metricStatus: string | null;
  value: AfcDiagnosticAdminMetricDecisionRecordedValue;
}) {
  const decision = value.finalDecision;
  return (
    <section data-testid="metric-decision-final">
      <h3 className="text-xs uppercase tracking-wide text-slate-500">Final result</h3>
      <FieldGrid
        rows={[
          ["Metric status", formatAfcDiagnosticMetricPath(metricStatus)],
          ["Selected path", formatAfcDiagnosticMetricPath(decision.selectedPath)],
          ["Accepted", formatAfcDiagnosticMetricBoolean(decision.accepted)],
          ["Authority", formatAfcDiagnosticMetricToken(decision.authority)],
          ["Metric scale", formatAfcDiagnosticMetricNumber(decision.metricScale)],
          ["Auto metric scale", formatAfcDiagnosticMetricNumber(decision.autoMetricScale)],
          ["Fallback applied", formatAfcDiagnosticMetricBoolean(decision.fallbackApplied)],
          [
            "Safe failure state",
            formatAfcDiagnosticMetricFailureState(decision.safeFailureState),
          ],
        ]}
      />
      {decision.fallbackApplied ? (
        <p className="mt-2 text-sm text-slate-300">
          Fallback was applied. Numeric fallback value:{" "}
          {formatAfcDiagnosticMetricNumber(value.fallback.numericFallback)}
        </p>
      ) : null}
    </section>
  );
}

function PathASection({
  value,
}: {
  value: AfcDiagnosticAdminMetricDecisionRecordedValue;
}) {
  const prior = value.pathA.roomPrior;
  const span = value.pathA.geometryCorrespondence.selectedSpan;
  const derivation = value.pathA.derivation;
  const showCandidateNote = derivation.candidateScaleBeforeFallback != null &&
    (value.finalDecision.fallbackApplied || value.fallback.used);
  return (
    <details className={nestedDetailsClassName} data-testid="metric-decision-path-a">
      <summary className={summaryClassName}>Path A</summary>
      <div className="mt-3 space-y-4">
        <Subsection title="Room prior">
          <FieldGrid
            rows={[
              ["Attempted", formatAfcDiagnosticMetricBoolean(prior.attempted)],
              ["Provider", formatAfcDiagnosticMetricToken(prior.provider)],
              ["Model", formatAfcDiagnosticMetricToken(prior.model)],
              ["Prompt version", formatAfcDiagnosticMetricToken(prior.promptVersion)],
              ["Observability", formatAfcDiagnosticMetricToken(prior.observability)],
              ["Estimated room width", formatAfcDiagnosticMetricTriple(prior.estimatedRoomWidthM)],
              ["Estimated room depth", formatAfcDiagnosticMetricTriple(prior.estimatedRoomDepthM)],
              [
                "Ceiling estimate",
                formatAfcDiagnosticMetricNumber(prior.estimatedCeilingHeightM),
              ],
              ["Model confidence", formatAfcDiagnosticMetricConfidence(prior.modelConfidence)],
              [
                "Host acceptance class",
                formatAfcDiagnosticMetricToken(prior.hostAcceptance?.class ?? null),
              ],
              [
                "Host reason codes",
                <ReasonCodes
                  key="path-a-host-reasons"
                  codes={prior.hostAcceptance?.reasonCodes ?? []}
                />,
              ],
            ]}
          />
          {prior.failure ? (
            <FieldGrid
              rows={[
                ["Failure class", formatAfcDiagnosticMetricToken(prior.failure.failureClass)],
                ["Failure stage", formatAfcDiagnosticMetricToken(prior.failure.failureStage)],
                [
                  "Provider status",
                  formatAfcDiagnosticMetricNumber(prior.failure.providerStatus),
                ],
                [
                  "Contract validation reason",
                  formatAfcDiagnosticMetricToken(prior.failure.contractValidationReason),
                ],
                ["Safe detail", formatAfcDiagnosticMetricToken(prior.failure.safeDetail)],
              ]}
            />
          ) : null}
        </Subsection>
        <Subsection title="Correspondence">
          <FieldGrid
            rows={[
              [
                "Selection status",
                formatAfcDiagnosticMetricToken(
                  value.pathA.geometryCorrespondence.selectionStatus,
                ),
              ],
              ["Selected span id", formatAfcDiagnosticMetricToken(span?.id ?? null)],
              ["Source", formatAfcDiagnosticMetricToken(span?.source ?? null)],
              ["Role", formatAfcDiagnosticMetricToken(span?.role ?? null)],
              [
                "Canonical length",
                formatAfcDiagnosticMetricNumber(span?.canonicalLength ?? null),
              ],
              [
                "Correspondence trust",
                formatAfcDiagnosticMetricToken(span?.correspondenceSpanTrust ?? null),
              ],
              ["Endpoint A", formatAfcDiagnosticMetricPoint(span?.imageA ?? null)],
              ["Endpoint B", formatAfcDiagnosticMetricPoint(span?.imageB ?? null)],
              ["S4A candidate id", formatAfcDiagnosticMetricToken(span?.s4aCandidateId ?? null)],
              ["Source seam id", formatAfcDiagnosticMetricToken(span?.sourceSeamId ?? null)],
              [
                "Selection reason codes",
                <ReasonCodes
                  key="path-a-selection-reasons"
                  codes={value.pathA.geometryCorrespondence.selectionReasonCodes}
                />,
              ],
              [
                "Rejected alternatives",
                value.pathA.geometryCorrespondence.rejectedAlternatives.length === 0 ? (
                  <span key="path-a-alts-empty">None</span>
                ) : (
                  <ul key="path-a-alts" className="space-y-1">
                    {value.pathA.geometryCorrespondence.rejectedAlternatives.map((alternative) => (
                      <li key={alternative.id} className="font-mono text-xs">
                        {alternative.id} · {alternative.role} · {alternative.reasonCode}
                      </li>
                    ))}
                  </ul>
                ),
              ],
            ]}
          />
        </Subsection>
        <Subsection title="Trust and compatibility">
          <FieldGrid
            rows={[
              ["Geometry trusted", formatAfcDiagnosticMetricBoolean(value.pathA.spanTrust.trusted)],
              [
                "Trust reason codes",
                <ReasonCodes
                  key="path-a-trust-reasons"
                  codes={value.pathA.spanTrust.reasonCodes}
                />,
              ],
              [
                "S4A safety present",
                formatAfcDiagnosticMetricBoolean(value.pathA.spanTrust.s4aSafetyPresent),
              ],
              [
                "Observed span only",
                formatAfcDiagnosticMetricBoolean(value.pathA.spanTrust.observedSpanOnly),
              ],
              [
                "Hidden continuation",
                formatAfcDiagnosticMetricBoolean(value.pathA.spanTrust.hiddenContinuation),
              ],
              [
                "Geometry manufactured",
                formatAfcDiagnosticMetricBoolean(value.pathA.spanTrust.geometryManufactured),
              ],
              [
                "Consulted compatibility tier",
                formatAfcDiagnosticMetricToken(value.pathA.exactGrid.consultedTier),
              ],
              [
                "Exact grid compatible",
                formatAfcDiagnosticMetricBoolean(value.pathA.exactGrid.exactGridCompatible),
              ],
              [
                "Trust selected back span as full width",
                formatAfcDiagnosticMetricBoolean(
                  value.pathA.exactGrid.trustSelectedBackSpanAsFullWidth,
                ),
              ],
              [
                "Old compatibility tier",
                formatAfcDiagnosticMetricToken(value.pathA.exactGrid.oldCompatibilityTier),
              ],
              [
                "Empty-authoritative compatibility tier",
                formatAfcDiagnosticMetricToken(
                  value.pathA.exactGrid.emptyAuthoritativeCompatibilityTier,
                ),
              ],
              [
                "Room-boundary compatibility tier",
                formatAfcDiagnosticMetricToken(value.pathA.exactGrid.roomBoundaryCompatibilityTier),
              ],
            ]}
          />
        </Subsection>
        <Subsection title="Derivation">
          <FieldGrid
            rows={[
              ["Parsed width best", formatAfcDiagnosticMetricNumber(derivation.parsedWidthBest)],
              ["Physical metres used", formatAfcDiagnosticMetricNumber(derivation.physicalMetres)],
              [
                "Canonical gauge length",
                formatAfcDiagnosticMetricNumber(derivation.canonicalGaugeLength),
              ],
              [
                "Candidate scale before fallback",
                formatAfcDiagnosticMetricNumber(derivation.candidateScaleBeforeFallback),
              ],
              ["Candidate finite", formatAfcDiagnosticMetricBoolean(derivation.candidateFinite)],
              ["Sanity", formatAfcDiagnosticMetricSanity(derivation.catastrophicSanity)],
              ["Accepted", formatAfcDiagnosticMetricBoolean(derivation.accepted)],
              ["Authority", formatAfcDiagnosticMetricToken(derivation.authority)],
              ["Reason codes", <ReasonCodes key="path-a-derivation-reasons" codes={derivation.reasonCodes} />],
            ]}
          />
          {showCandidateNote ? (
            <p className="mt-2 text-sm text-slate-400">
              Candidate scale before fallback is recorded separately from the applied scale.
            </p>
          ) : null}
        </Subsection>
      </div>
    </details>
  );
}

function PathBSection({
  value,
}: {
  value: AfcDiagnosticAdminMetricDecisionRecordedValue;
}) {
  const pathB = value.pathB;
  const geometry = pathB.hostGeometry;
  return (
    <details className={nestedDetailsClassName} data-testid="metric-decision-path-b">
      <summary className={summaryClassName}>Path B</summary>
      <div className="mt-3 space-y-4">
        <p className="text-sm text-slate-100">
          Path B outcome: {formatAfcDiagnosticMetricPathBOutcome(pathB)}
        </p>
        <Subsection title="Selection">
          <FieldGrid
            rows={[
              [
                "Selection attempted",
                formatAfcDiagnosticMetricBoolean(pathB.selection.selectionAttempted),
              ],
              [
                "Selection status",
                formatAfcDiagnosticMetricToken(pathB.selection.selectionStatus),
              ],
              [
                "Selection reasons",
                <ReasonCodes
                  key="path-b-selection-reasons"
                  codes={pathB.selection.selectionReasonCodes}
                />,
              ],
              [
                "Selected candidate id",
                formatAfcDiagnosticMetricToken(pathB.selection.selectedCandidateId),
              ],
              [
                "Path A complete-geometry context",
                formatAfcDiagnosticMetricBoolean(pathB.selection.pathAGeometry.exists),
              ],
              [
                "Suppression configuration",
                formatAfcDiagnosticMetricBoolean(
                  pathB.selection.suppressWhenCompleteBackGeometryExists,
                ),
              ],
            ]}
          />
        </Subsection>
        <Subsection title="Launch">
          <FieldGrid
            rows={[
              [
                "Launch disposition",
                formatAfcDiagnosticMetricLaunchDisposition(pathB.launchDisposition),
              ],
              ["Estimator launched", formatAfcDiagnosticMetricBoolean(pathB.estimatorLaunched)],
            ]}
          />
        </Subsection>
        {geometry ? (
          <Subsection title="Host geometry">
            <FieldGrid
              rows={[
                ["Span id", formatAfcDiagnosticMetricToken(geometry.id)],
                ["Role", formatAfcDiagnosticMetricToken(geometry.role)],
                ["Canonical length", formatAfcDiagnosticMetricNumber(geometry.canonicalLength)],
                ["Endpoint A", formatAfcDiagnosticMetricPoint(geometry.imageA)],
                ["Endpoint B", formatAfcDiagnosticMetricPoint(geometry.imageB)],
                ["Source seam id", formatAfcDiagnosticMetricToken(geometry.sourceSeamId)],
                ["Floor authority key", formatAfcDiagnosticMetricToken(geometry.floorAuthorityKey)],
                ["S4A candidate id", formatAfcDiagnosticMetricToken(geometry.s4aCandidateId)],
                [
                  "Freeze version",
                  formatAfcDiagnosticMetricToken(geometry.freezeReceiptVersion),
                ],
                [
                  "Freeze hash",
                  formatAfcDiagnosticMetricToken(geometry.freezePayloadSha256),
                ],
                ["Overlay hash", formatAfcDiagnosticMetricToken(geometry.overlayImageHash)],
              ]}
            />
          </Subsection>
        ) : null}
        <Subsection title="Model">
          <FieldGrid
            rows={[
              ["Provider", formatAfcDiagnosticMetricToken(pathB.model.provider)],
              ["Model", formatAfcDiagnosticMetricToken(pathB.model.model)],
              ["Prompt version", formatAfcDiagnosticMetricToken(pathB.model.promptVersion)],
              ["Schema version", formatAfcDiagnosticMetricToken(pathB.model.schemaVersion)],
              ["Estimate status", formatAfcDiagnosticMetricToken(pathB.model.estimateStatus)],
              [
                "Estimated physical length",
                formatAfcDiagnosticMetricTriple(pathB.model.estimatedLengthM),
              ],
              [
                "Model confidence",
                formatAfcDiagnosticMetricConfidence(pathB.model.modelConfidence),
              ],
              [
                "Host acceptance class",
                formatAfcDiagnosticMetricToken(pathB.model.hostAcceptance?.class ?? null),
              ],
              [
                "Host reason codes",
                <ReasonCodes
                  key="path-b-host-reasons"
                  codes={pathB.model.hostAcceptance?.reasonCodes ?? []}
                />,
              ],
              [
                "Host candidate scale",
                formatAfcDiagnosticMetricNumber(
                  pathB.model.hostAcceptance?.candidateScale ?? null,
                ),
              ],
            ]}
          />
        </Subsection>
        <Subsection title="Derivation">
          <FieldGrid
            rows={[
              [
                "Candidate scale before fallback",
                formatAfcDiagnosticMetricNumber(pathB.derivation.candidateScaleBeforeFallback),
              ],
              [
                "Lineage status",
                formatAfcDiagnosticMetricLineageStatus(pathB.derivation.lineageStatus),
              ],
              ["Sanity", formatAfcDiagnosticMetricSanity(pathB.derivation.catastrophicSanity)],
              ["Accepted", formatAfcDiagnosticMetricBoolean(pathB.derivation.accepted)],
              ["Authority", formatAfcDiagnosticMetricToken(pathB.derivation.authority)],
              [
                "Reason codes",
                <ReasonCodes key="path-b-derivation-reasons" codes={pathB.derivation.reasonCodes} />,
              ],
            ]}
          />
        </Subsection>
      </div>
    </details>
  );
}

function FallbackSection({
  value,
}: {
  value: AfcDiagnosticAdminMetricDecisionRecordedValue;
}) {
  return (
    <section data-testid="metric-decision-fallback">
      <h3 className="text-xs uppercase tracking-wide text-slate-500">Fallback</h3>
      <FieldGrid
        rows={[
          ["Fallback used", formatAfcDiagnosticMetricBoolean(value.fallback.used)],
          ["Numeric fallback", formatAfcDiagnosticMetricNumber(value.fallback.numericFallback)],
          ["Constant name", value.fallback.constantName],
          ["Winning path", formatAfcDiagnosticMetricPath(value.fallback.winningPath)],
          ["Winning reason codes", <ReasonCodes key="fallback-reasons" codes={value.fallback.reasonCodes} />],
        ]}
      />
    </section>
  );
}

function RejectedCandidate({
  value,
}: {
  value: AfcDiagnosticAdminMetricDecisionRecordedValue;
}) {
  if (!value.finalDecision.rejectedCandidatePresent) return null;
  return (
    <section data-testid="metric-decision-rejected">
      <h3 className="text-xs uppercase tracking-wide text-slate-500">Rejected candidate</h3>
      <FieldGrid
        rows={[
          [
            "Rejected candidate scale",
            formatAfcDiagnosticMetricNumber(value.finalDecision.rejectedCandidateScale),
          ],
          [
            "Candidate finite",
            formatAfcDiagnosticMetricBoolean(value.finalDecision.rejectedCandidateFinite),
          ],
        ]}
      />
    </section>
  );
}

function LegacyState({
  legacy,
}: {
  legacy: AfcDiagnosticAdminLegacyMetricConclusion | null;
}) {
  return (
    <div data-testid="metric-decision-legacy">
      <p className="text-sm text-slate-100">Metric decision unavailable</p>
      {legacy ? (
        <FieldGrid
          rows={[
            ["Path", formatAfcDiagnosticMetricPath(legacy.path)],
            ["Accepted", formatAfcDiagnosticMetricBoolean(legacy.accepted)],
            ["Authority", formatAfcDiagnosticMetricToken(legacy.authority)],
            ["Metric scale", formatAfcDiagnosticMetricNumber(legacy.metricScale)],
            ["Auto metric scale", formatAfcDiagnosticMetricNumber(legacy.autoMetricScale)],
            ["Fallback applied", formatAfcDiagnosticMetricBoolean(legacy.fallbackApplied)],
            [
              "Safe failure state",
              formatAfcDiagnosticMetricFailureState(legacy.safeFailureState),
            ],
          ]}
        />
      ) : null}
      <p className="mt-2 text-sm text-slate-400">
        Path-level metric evidence was not retained for this generation.
      </p>
    </div>
  );
}

function RecordedState({
  metricStatus,
  metricDecision,
}: {
  metricStatus: string | null;
  metricDecision: Extract<AfcDiagnosticAdminMetricDecision, { kind: "recorded" }>;
}) {
  const value = metricDecision.value;
  return (
    <div className="space-y-4">
      <FinalResult metricStatus={metricStatus} value={value} />
      <PathASection value={value} />
      <PathBSection value={value} />
      <FallbackSection value={value} />
      <RejectedCandidate value={value} />
    </div>
  );
}

export default function AfcDiagnosticMetricDecisionPanel({
  metricStatus,
  metricDecision,
  legacyMetricConclusion,
}: {
  metricStatus: string | null;
  metricDecision: AfcDiagnosticAdminMetricDecision;
  legacyMetricConclusion: AfcDiagnosticAdminLegacyMetricConclusion | null;
}) {
  let body: ReactNode;
  if (metricDecision == null) {
    body = <LegacyState legacy={legacyMetricConclusion} />;
  } else if (metricDecision.kind === "recorded") {
    body = <RecordedState metricStatus={metricStatus} metricDecision={metricDecision} />;
  } else if (metricDecision.kind === "capture_failed") {
    body = (
      <div data-testid="metric-decision-message">
        <p className="text-sm text-slate-100">Metric decision capture failed</p>
        <FieldGrid
          rows={[
            ["Generation id", metricDecision.generationId],
            ["Schema version", metricDecision.schemaVersion],
          ]}
        />
      </div>
    );
  } else if (metricDecision.kind === "unsupported_schema") {
    body = (
      <div data-testid="metric-decision-message">
        <p className="text-sm text-slate-100">
          Metric decision schema not supported by this Inspector version
        </p>
        <FieldGrid rows={[["Schema version", metricDecision.schemaVersion]]} />
      </div>
    );
  } else {
    body = (
      <p className="text-sm text-slate-100" data-testid="metric-decision-message">
        Metric decision could not be read
      </p>
    );
  }

  return (
    <details
      className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40 p-3"
      data-testid="metric-decision"
    >
      <summary className={summaryClassName}>Metric Decision</summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}

export { AFC_DIAGNOSTIC_METRIC_NOT_AVAILABLE };
