"use client";

import type { RoomEnvelopeReconciliationResult, RoomEnvelopeSupportKind } from "./room-envelope-types";
import {
  ROOM_ENVELOPE_DERIVATION_VERSION,
  ROOM_ENVELOPE_NUMERIC_POLICY_VERSION,
} from "./room-envelope-identity";

export type RoomEnvelopePanelSupport = {
  present: boolean;
  runtimeUsable: boolean;
  included: boolean;
  blockers: readonly string[];
  identityKey: string | null;
};

type RoomEnvelopePanelProps = {
  reconciliation: RoomEnvelopeReconciliationResult;
  supports: Readonly<Record<RoomEnvelopeSupportKind, RoomEnvelopePanelSupport>>;
  contextKey: string | null;
  contextUnavailableReason: string | null;
  wireframeVisible: boolean;
  onWireframeVisibleChange: (visible: boolean) => void;
  omittedProjectionSegmentCount: number;
};

const SUPPORT_LABELS: Readonly<Record<RoomEnvelopeSupportKind, string>> = {
  floor: "Floor",
  wall_back: "Back wall",
  wall_left: "Left wall",
  wall_right: "Right wall",
  ceiling: "Ceiling",
};

function formatWorld(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(3)} world units` : "unavailable";
}

function formatDegrees(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(3)}°` : "unavailable";
}

function formatSignedWorld(value: number): string {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(3)} world units` : "unavailable";
}

function DimensionRow({
  label,
  value,
  note,
}: {
  label: string;
  value: RoomEnvelopeReconciliationResult["dimensions"]["width"];
  note: string;
}) {
  return (
    <li className="flex flex-wrap justify-between gap-x-3 gap-y-1">
      <span className="text-slate-300">{label}</span>
      <span className="text-slate-100">{value.present ? formatWorld(value.value) : "not available"}</span>
      <span className="w-full text-[11px] text-slate-500">{note}</span>
    </li>
  );
}

export default function RoomEnvelopePanel({
  reconciliation,
  supports,
  contextKey,
  contextUnavailableReason,
  wireframeVisible,
  onWireframeVisibleChange,
  omittedProjectionSegmentCount,
}: RoomEnvelopePanelProps) {
  const statusLabel = reconciliation.status === "unavailable"
    ? "Unavailable"
    : reconciliation.status === "partial"
      ? "Partial"
      : reconciliation.status === "candidate"
        ? "Candidate"
        : "Inconsistent";
  const statusColor = reconciliation.status === "inconsistent"
    ? "text-amber-300"
    : reconciliation.status === "candidate"
      ? "text-cyan-200"
      : "text-slate-300";

  return (
    <section className="space-y-4 rounded-xl border border-cyan-800/70 bg-slate-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-cyan-100">Room Envelope</h3>
          <p className="mt-1 text-xs text-slate-400">Read-only reconciliation of current reviewed support patches.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
          <input
            type="checkbox"
            checked={wireframeVisible}
            onChange={(event) => onWireframeVisibleChange(event.target.checked)}
            className="accent-cyan-400"
          />
          Show wireframe
        </label>
      </div>

      <div className="rounded border border-slate-800 bg-slate-950/60 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-400">Envelope status</span>
          <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
        </div>
        <dl className="mt-2 grid gap-1 sm:grid-cols-2">
          <div><dt className="inline text-slate-500">Front: </dt><dd className="inline text-slate-200">{reconciliation.hasForegroundCap ? "complete capped" : "open front"}</dd></div>
          <div><dt className="inline text-slate-500">Ceiling: </dt><dd className="inline text-slate-200">{reconciliation.hasCeiling ? "present" : "absent"}</dd></div>
          <div><dt className="inline text-slate-500">Anchor: </dt><dd className="inline text-slate-200">{reconciliation.resolvedAnchor?.kind ?? "unavailable"}</dd></div>
          <div><dt className="inline text-slate-500">Anchor provenance: </dt><dd className="inline text-slate-200">{reconciliation.resolvedAnchor?.selection === "default" ? "default selection" : "unavailable"}</dd></div>
          <div><dt className="inline text-slate-500">Wireframe: </dt><dd className="inline text-slate-200">{wireframeVisible ? "visible" : "hidden (derivation remains active)"}</dd></div>
        </dl>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-200">Input support eligibility</h4>
        <ul className="mt-2 space-y-2 text-xs">
          {(["floor", "wall_back", "wall_left", "wall_right", "ceiling"] as const).map((kind) => {
            const support = supports[kind];
            return (
              <li key={kind} className="rounded border border-slate-800 bg-slate-950/40 p-2">
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                  <span className="font-medium text-slate-200">{SUPPORT_LABELS[kind]} <span className="font-normal text-slate-500">({kind})</span></span>
                  <span className={support.included ? "text-cyan-200" : "text-slate-400"}>{support.included ? "included" : "not included"}</span>
                </div>
                <p className="mt-1 text-slate-400">
                  present: {support.present ? "yes" : "no"} · runtime usable: {support.runtimeUsable ? "yes" : "no"}
                </p>
                {!support.included && support.blockers.length > 0 ? (
                  <p className="mt-1 text-amber-200">Existing blockers: {support.blockers.join(" · ")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-200">Dimensions</h4>
        <ul className="mt-2 space-y-2 rounded border border-slate-800 bg-slate-950/40 p-3 text-xs">
          <DimensionRow label="Width" value={reconciliation.dimensions.width} note="Derived from reviewed wall faces." />
          <DimensionRow label="Visible reviewed depth" value={reconciliation.dimensions.visibleReviewedDepth} note="Finite extent of reviewed support patches; not a foreground boundary." />
          <DimensionRow label="Room height" value={reconciliation.dimensions.roomHeight} note="Inherited operator assumption from Ceiling support." />
          <DimensionRow label="Foreground depth" value={reconciliation.dimensions.assumedCappedDepth} note="Not supplied." />
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-200">Blocking consistency diagnostics</h4>
        <ul className="mt-2 space-y-1 rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300">
          <li>Left/Right parallelism: {reconciliation.residuals.leftRightParallelism.available ? formatDegrees(reconciliation.residuals.leftRightParallelism.degrees) : "not available"}</li>
          <li>Back/Left orthogonality: {reconciliation.residuals.adjacentWallOrthogonality.backLeft.available ? formatDegrees(reconciliation.residuals.adjacentWallOrthogonality.backLeft.degrees) : "not available"}</li>
          <li>Back/Right orthogonality: {reconciliation.residuals.adjacentWallOrthogonality.backRight.available ? formatDegrees(reconciliation.residuals.adjacentWallOrthogonality.backRight.degrees) : "not available"}</li>
          <li>Floor/Ceiling parallelism: {reconciliation.residuals.floorCeilingParallelism.available ? formatDegrees(reconciliation.residuals.floorCeilingParallelism.degrees) : "not available"}</li>
          {reconciliation.residuals.wallVerticality.map((item) => <li key={item.wallKind}>{SUPPORT_LABELS[item.wallKind]} verticality: {formatDegrees(item.degreesFromVerticalPlane)}</li>)}
          {reconciliation.residuals.wallFloorSeams.map((item) => <li key={item.wallKind}>{SUPPORT_LABELS[item.wallKind]} / Floor seam error: max Y {formatWorld(item.maxAbsY)}, offset spread {formatWorld(item.faceOffsetSpread)}</li>)}
          {reconciliation.residuals.supportPlaneOffsets.map((item) => <li key={item.wallKind}>{SUPPORT_LABELS[item.wallKind]} support-to-candidate face offset: {formatSignedWorld(item.signedOffset)} (absolute {formatWorld(item.absoluteOffset)})</li>)}
          {reconciliation.residuals.cornerClosure.map((item) => <li key={item.pair}>{item.pair} room-corner closure: {item.available ? formatWorld(item.worldDistanceError) : "not available"} · conditioning sinθ {item.intersectionSinTheta.toFixed(6)}</li>)}
          <li>Maximum boundary distance: {formatWorld(reconciliation.residuals.maxBoundaryToEnvelopeDistance)}</li>
          <li>RMS boundary distance: {formatWorld(reconciliation.residuals.rmsBoundaryToEnvelopeDistance)}</li>
          {reconciliation.residuals.wallCeilingPlaneOrthogonality.map((item, index) => <li key={`wall-ceiling-plane-${index}`}>Wall/Ceiling plane consistency: {item.available ? formatDegrees(item.degrees) : "not available"}</li>)}
        </ul>
        <h4 className="mt-3 text-xs font-medium text-slate-200">Diagnostic-only finite-patch coverage</h4>
        <ul className="mt-2 space-y-1 rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
          {reconciliation.residuals.wallCeilingCoverage.length > 0 ? reconciliation.residuals.wallCeilingCoverage.map((item) => (
            <li key={item.wallKind}>{SUPPORT_LABELS[item.wallKind]} / Ceiling upper-corner gaps: {item.upperCornerGaps.map(formatWorld).join(" · ") || "none"}</li>
          )) : <li>No finite wall/Ceiling patch coverage facts available.</li>}
          <li>Positive gap: reviewed wall patch stops below Ceiling. Negative gap: reviewed wall patch extends above Ceiling.</li>
          <li>Cropped support patches are diagnostic coverage facts, not plane failures.</li>
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-medium text-slate-200">Blockers</h4>
        {reconciliation.blockers.length > 0 ? (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-amber-200">
            {reconciliation.blockers.map((blocker) => <li key={blocker}><code>{blocker}</code></li>)}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-slate-400">No machine consistency blockers under Room Envelope v1 policy.</p>
        )}
      </div>

      <details className="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-200">Conditioning and provenance</summary>
        <ul className="mt-3 space-y-1 text-slate-400">
          <li>Included support kinds: {reconciliation.conditioning.includedSupportKinds.join(", ") || "none"}</li>
          {reconciliation.conditioning.wallSeamLengths.map((item) => <li key={item.wallKind}>{SUPPORT_LABELS[item.wallKind]} seam length: {formatWorld(item.length)}</li>)}
          {reconciliation.conditioning.cornerIntersectionSinTheta.map((item) => <li key={item.pair}>{item.pair} intersection conditioning sinθ: {item.value.toFixed(6)}</li>)}
          {reconciliation.conditioning.candidateDimensionBounds.map((item) => <li key={item.name}>{item.name}: {item.value === null ? "not available" : formatWorld(item.value)} · {item.valid ? "within policy bounds" : "outside policy bounds"}</li>)}
          {reconciliation.conditioning.normalizationFailures.map((failure) => <li key={failure}>Normalization: {failure}</li>)}
          <li>Omitted projection segments: {omittedProjectionSegmentCount}</li>
          <li>Derivation version: {ROOM_ENVELOPE_DERIVATION_VERSION}</li>
          <li>Numerical-policy version: {ROOM_ENVELOPE_NUMERIC_POLICY_VERSION}</li>
          <li>Context key: {contextKey ? `${contextKey.slice(0, 96)}…` : contextUnavailableReason ?? "unavailable"}</li>
        </ul>
      </details>

      <div className="rounded border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
        <h4 className="font-medium text-slate-200">Assumptions and non-claims</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>The envelope is derived from reviewed supports.</li>
          <li>Dimensions are in the current assumed world scale.</li>
          <li>Consistency does not prove the physical room is rectangular.</li>
          <li>No hidden foreground wall is being claimed.</li>
          <li>No operator envelope confirmation exists in Package 2.</li>
        </ul>
      </div>
    </section>
  );
}
