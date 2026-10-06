"use client";

import { useEffect, useState } from "react";

import {
  MANUAL_PERSPECTIVE_CORNERS,
  MANUAL_PERSPECTIVE_CORRESPONDENCE_ORDER,
  imagePointsFromQuad,
  manualPerspectiveOverlayPoints,
  type ManualPerspectiveCorner,
  type ManualPerspectiveImagePoints,
  type ManualPerspectiveImageQuad,
} from "@/lib/afc-v2-diagnostics/manual-perspective-geometry";
import {
  buildManualPerspectiveRecoveryUrl,
  buildManualPerspectiveUrl,
  commitManualPerspectiveSolve,
  editManualPerspectiveCoordinate,
  editManualPerspectiveImagePoints,
  editManualPerspectivePoint,
  manualPerspectiveControlVisible,
  manualPerspectiveDiagnosticRows,
  manualPerspectiveRecoveryAllowed,
  manualPerspectiveStageApplyAllowed,
  nudgeManualPerspectiveCoordinate,
  openManualPerspectiveBootstrapSession,
  openManualPerspectiveSession,
  parseManualPerspectiveCoordinate,
  parseManualPerspectiveRecoveryEligibility,
  parseManualPerspectiveView,
  revertManualPerspectiveSession,
  type ManualPerspectiveRecord,
  type ManualPerspectiveSession,
  type ManualPerspectiveView,
} from "@/lib/afc-v2-diagnostics/manual-perspective";
import { solveManualPerspectiveCalibration } from "@/lib/afc-v2-diagnostics/manual-perspective-solve";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

const activeButtonClassName =
  "rounded-lg border border-emerald-400/80 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

export type ManualPerspectiveOverlayPoint = Readonly<{
  x: number;
  y: number;
  label: string;
}>;

export default function AfcDiagnosticManualPerspective({
  caseId,
  generationId,
  hostGeometryVisible,
  onProjectedQuad,
  onRegisterPointEdit,
  onRegisterQuadEdit,
}: {
  caseId: string;
  generationId: string;
  hostGeometryVisible: boolean;
  onProjectedQuad: (points: readonly ManualPerspectiveOverlayPoint[] | null) => void;
  onRegisterPointEdit: (
    edit: ((corner: ManualPerspectiveCorner, x: number, y: number) => void) | null,
    mode?: ManualPerspectiveSession["mode"],
  ) => void;
  onRegisterQuadEdit: (
    edit: ((points: ManualPerspectiveImagePoints) => void) | null,
  ) => void;
}) {
  const [view, setView] = useState<ManualPerspectiveView | null>(null);
  const [editing, setEditing] = useState(false);
  const [session, setSession] = useState<ManualPerspectiveSession | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [checkedRecoveryEligible, setCheckedRecoveryEligible] = useState(false);
  const [checkedRecoveryReason, setCheckedRecoveryReason] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const diagnosticRecovery = view?.runtime === "diagnostic_only";
  const recoveryEligible = diagnosticRecovery ? checkedRecoveryEligible : false;
  const recoveryReason = diagnosticRecovery ? checkedRecoveryReason : null;

  useEffect(() => {
    const controller = new AbortController();
    const url = buildManualPerspectiveUrl(caseId, generationId);
    fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return parseManualPerspectiveView(await response.json());
      })
      .then((next) => {
        if (!controller.signal.aborted) setView(next);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!controller.signal.aborted) setView(null);
      });
    return () => controller.abort();
  }, [caseId, generationId]);

  useEffect(() => {
    if (!diagnosticRecovery) return;
    const controller = new AbortController();
    fetch(buildManualPerspectiveRecoveryUrl(caseId, generationId), {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return parseManualPerspectiveRecoveryEligibility(await response.json());
      })
      .then((eligibility) => {
        if (controller.signal.aborted) return;
        setCheckedRecoveryEligible(eligibility?.eligible === true);
        setCheckedRecoveryReason(eligibility && !eligibility.eligible ? eligibility.blocker : null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setCheckedRecoveryEligible(false);
          setCheckedRecoveryReason("Recovery prerequisites could not be checked.");
        }
      });
    return () => controller.abort();
  }, [caseId, generationId, diagnosticRecovery]);

  useEffect(() => {
    if (!session || session.status !== "solving") return;
    const requestId = session.solveRequestId;
    const imagePoints = session.imagePoints;
    const sourceImageSize = session.sourceImageSize;
    const frameSize = session.frameSize;
    const referenceDepthM = session.referenceDepthM;
    let frame = 0;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        const result = solveManualPerspectiveCalibration({
          imagePoints,
          sourceImageSize,
          frameSize,
          referenceDepthM,
        });
        setSession((latest) =>
          latest ? commitManualPerspectiveSolve(latest, requestId, result) : latest,
        );
      });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [session]);

  const manualMode = session?.mode;
  useEffect(() => {
    if (!editing || !manualMode) {
      onRegisterPointEdit(null);
      onRegisterQuadEdit(null);
      return;
    }
    onRegisterPointEdit((corner, x, y) => {
      setSession((current) =>
        current ? editManualPerspectivePoint(current, corner, x, y) : current,
      );
    }, manualMode);
    onRegisterQuadEdit((points) => {
      setSession((current) =>
        current ? editManualPerspectiveImagePoints(current, points) : current,
      );
    });
    return () => {
      onRegisterPointEdit(null);
      onRegisterQuadEdit(null);
    };
  }, [editing, manualMode, onRegisterPointEdit, onRegisterQuadEdit]);

  const projected = overlayPoints(editing ? session : null, editing ? null : view?.applied ?? null);
  const visibleProjection = hostGeometryVisible ? projected : null;
  const projectionKey = visibleProjection
    ? visibleProjection.map((point) => `${point.label}:${point.x}:${point.y}`).join("|")
    : "";

  useEffect(() => {
    onProjectedQuad(visibleProjection);
  }, [projectionKey, onProjectedQuad, visibleProjection]);

  if (!manualPerspectiveControlVisible(view != null) || !view) return null;

  const baseline = view.automatic;
  const bootstrap = view.bootstrap;
  const canOpen = baseline != null || bootstrap != null;
  const appliedPoints = view.applied ? imagePointsFromApplied(view.applied) : null;

  return (
    <section className="mt-3" data-testid="manual-perspective">
      <button
        type="button"
        className={editing ? activeButtonClassName : buttonClassName}
        aria-pressed={editing}
        data-testid="manual-perspective-toggle"
        disabled={!canOpen}
        onClick={() => {
          if (!canOpen) return;
          if (editing) {
            setEditing(false);
            setSession(null);
            setApplyMessage(null);
            return;
          }
          if (baseline) {
            setSession(openManualPerspectiveSession(
              baseline,
              appliedPoints,
              view.runtime === "diagnostic_only" ? "diagnostic_only" : "overlay",
            ));
          } else if (bootstrap) {
            setSession(openManualPerspectiveBootstrapSession(bootstrap, appliedPoints));
          }
          setEditing(true);
          setApplyMessage(null);
        }}
      >
        {baseline ? "Edit Existing Quad" : bootstrap ? "Create Manual Quad" : "Manual Perspective"}
      </button>
      {!canOpen ? (
        <p className="mt-2 text-xs text-slate-500">No usable image frame on this generation.</p>
      ) : null}
      {view.appliedUnreadable ? (
        <p className="mt-2 text-xs text-amber-200">Stored manual perspective could not be read.</p>
      ) : null}
      {!editing && view.recovery ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="manual-perspective-recovery-provenance">
          Recovered from generation {view.recovery.sourceGenerationId} with a manual source quad
          {" · "}
          {view.recovery.recoveredAt}
        </p>
      ) : null}
      {!editing && view.applied ? <AppliedSummary record={view.applied} /> : null}
      {!editing && view.applied && !hostGeometryVisible ? (
        <p className="mt-2 text-xs text-amber-200">
          Manual projection is hidden on this image because it does not share the accepted floor geometry.
        </p>
      ) : null}
      {editing && session ? (
        <ManualPerspectiveEditor
          session={session}
          hostGeometryVisible={hostGeometryVisible}
          applying={applying}
          applyMessage={applyMessage}
          recoveryEligible={recoveryEligible}
          recoveryReason={recoveryReason}
          recovering={recovering}
          recoveryMessage={recoveryMessage}
          restoredRecoveryQuad={view.bootstrap?.restoredFromRecovery === true}
          onEdit={(corner, axis, value) => {
            setSession((current) =>
              current ? editManualPerspectiveCoordinate(current, corner, axis, value) : current,
            );
          }}
          onRevert={() => {
            setSession((current) => (current ? revertManualPerspectiveSession(current) : current));
            setApplyMessage(null);
          }}
          onApply={() => {
            if (!session || !manualPerspectiveStageApplyAllowed(session)) return;
            void applySession({
              caseId,
              generationId,
              session,
              setApplying,
              setApplyMessage,
              setView,
            });
          }}
          onRecover={() => {
            if (!session || !manualPerspectiveRecoveryAllowed(session, recoveryEligible)) return;
            void recoverSession({
              caseId,
              generationId,
              session,
              setRecovering,
              setRecoveryMessage,
            });
          }}
        />
      ) : null}
    </section>
  );
}

export function ManualPerspectiveEditor({
  session,
  hostGeometryVisible,
  applying,
  applyMessage,
  recoveryEligible = false,
  recoveryReason = null,
  recovering = false,
  recoveryMessage = null,
  restoredRecoveryQuad = false,
  onEdit,
  onRevert,
  onApply,
  onRecover,
}: {
  session: ManualPerspectiveSession;
  hostGeometryVisible: boolean;
  applying: boolean;
  applyMessage: string | null;
  recoveryEligible?: boolean;
  recoveryReason?: string | null;
  recovering?: boolean;
  recoveryMessage?: string | null;
  restoredRecoveryQuad?: boolean;
  onEdit: (corner: ManualPerspectiveCorner, axis: "x" | "y", value: number) => void;
  onRevert: () => void;
  onApply: () => void;
  onRecover?: () => void;
}) {
  const applyAllowed = manualPerspectiveStageApplyAllowed(session) && !applying;
  const recoverAllowed = onRecover != null &&
    manualPerspectiveRecoveryAllowed(session, recoveryEligible) &&
    !recovering &&
    !applying;
  const unrealizable = session.status === "unrealizable";
  const diagnosticOnly = session.runtime === "diagnostic_only";
  return (
    <div
      className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"
      data-testid="manual-perspective-panel"
    >
      <p className="text-xs text-slate-400">
        {session.mode === "bootstrap"
          ? "No AFC floor quad was available. Place the four floor points manually."
          : "Source-normalized image coordinates. These X/Y values stay as entered. Calibration derives the centered floor, FOV, and camera."}
      </p>
      {session.mode === "bootstrap" && restoredRecoveryQuad ? (
        <p className="mt-2 text-xs text-slate-400" data-testid="manual-perspective-restored-quad">
          Loaded the last manual recovery quad.
        </p>
      ) : null}
      {diagnosticOnly ? (
        <p className="mt-2 text-xs text-amber-200" data-testid="manual-perspective-stage-blocker">
          Apply stays off. This generation has no frozen production authority, so metric scale and collision were not recorded and cannot drive STAGE.
        </p>
      ) : null}
      {!hostGeometryVisible ? (
        <p className="mt-2 text-xs text-amber-200" data-testid="manual-perspective-host-hidden">
          {session.mode === "bootstrap"
            ? "This image does not share the source frame, so the manual quad is hidden. ORIGINAL can host these points."
            : "Projection is hidden on this image because it does not share the accepted floor geometry."}
        </p>
      ) : null}
      <table className="mt-3 w-full max-w-md text-left text-xs text-slate-200">
        <thead className="text-slate-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Point</th>
            <th className="py-1 pr-3 font-medium">Image X</th>
            <th className="py-1 font-medium">Image Y</th>
          </tr>
        </thead>
        <tbody>
          {MANUAL_PERSPECTIVE_CORNERS.map((corner) => (
            <tr key={corner}>
              <th className="py-1 pr-3 font-medium text-slate-300">{corner}</th>
              <td className="py-1 pr-3">
                <CoordinateField
                  label={`${corner} image x`}
                  value={session.imagePoints[corner].x}
                  onCommit={(value) => onEdit(corner, "x", value)}
                />
              </td>
              <td className="py-1">
                <CoordinateField
                  label={`${corner} image y`}
                  value={session.imagePoints[corner].y}
                  onCommit={(value) => onEdit(corner, "y", value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl
        className="mt-3 grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1 whitespace-nowrap text-xs"
        data-testid="manual-perspective-diagnostics"
      >
        {manualPerspectiveDiagnosticRows(session).map((row) => (
          <DiagnosticRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClassName} onClick={onRevert} data-testid="manual-perspective-revert">
          Revert
        </button>
        <button
          type="button"
          className={buttonClassName}
          disabled={!applyAllowed}
          onClick={onApply}
          data-testid="manual-perspective-apply"
        >
          Apply Manual Perspective
        </button>
        {onRecover && diagnosticOnly ? (
          <button
            type="button"
            className={buttonClassName}
            disabled={!recoverAllowed}
            onClick={onRecover}
            data-testid="manual-perspective-recover"
          >
            {recovering ? "Recovering room from the manual quad…" : "Recover Room From Manual Quad"}
          </button>
        ) : null}
      </div>
      {onRecover && diagnosticOnly ? (
        <p className="mt-2 text-xs text-slate-400">
          Recovery reuses the stored images, calibrates this quad, rereads room boundaries, derives metric scale, and builds collision. This failed generation stays unchanged.
        </p>
      ) : null}
      {onRecover && recoveryReason ? (
        <p className="mt-2 text-xs text-amber-200" data-testid="manual-perspective-recovery-blocker">
          {recoveryReason}
        </p>
      ) : null}
      <p
        className={`mt-2 text-xs text-amber-200 ${unrealizable ? "" : "invisible"}`}
        data-testid="manual-perspective-unrealizable"
        aria-hidden={unrealizable ? undefined : true}
      >
        This image quad has no realizable calibration. The entered coordinates are unchanged, and Apply stays off.
      </p>
      {applyMessage ? <p className="mt-2 text-xs text-slate-300">{applyMessage}</p> : null}
      {recoveryMessage ? (
        <p className="mt-2 text-xs text-slate-300" data-testid="manual-perspective-recovery-status">
          {recoveryMessage}
        </p>
      ) : null}
    </div>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd
        className="overflow-hidden text-ellipsis font-mono text-slate-300"
        data-testid={`manual-perspective-${diagnosticTestId(label)}`}
      >
        {value}
      </dd>
    </>
  );
}

function diagnosticTestId(label: string): string {
  if (label === "FOV") return "fov";
  if (label === "Width : Depth") return "ratio";
  if (label === "Solver") return "status";
  return label.toLowerCase().replace(/[^a-z]+/g, "-");
}

function AppliedSummary({ record }: { record: ManualPerspectiveRecord }) {
  return (
    <p className="mt-2 text-xs text-slate-400" data-testid="manual-perspective-applied">
      Applied manual perspective
      {" · "}
      FOV {record.resultingCamera.verticalFovDeg.toFixed(1)}°
      {" · "}
      width:depth {record.derivedFloor.widthDepthRatio.toFixed(3)}
      {" · "}
      {record.perspectiveSource}
    </p>
  );
}

function CoordinateField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value.toFixed(4);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="rounded border border-slate-700 px-1 text-slate-300"
        aria-label={`Decrease ${label}`}
        onClick={() => onCommit(nudgeManualPerspectiveCoordinate(value, -0.001))}
      >
        −
      </button>
      <input
        aria-label={label}
        inputMode="decimal"
        className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
        value={shown}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = parseManualPerspectiveCoordinate(next);
          if (parsed.ok) onCommit(parsed.value);
        }}
        onBlur={() => setDraft(null)}
      />
      <button
        type="button"
        className="rounded border border-slate-700 px-1 text-slate-300"
        aria-label={`Increase ${label}`}
        onClick={() => onCommit(nudgeManualPerspectiveCoordinate(value, 0.001))}
      >
        +
      </button>
    </span>
  );
}

function overlayPoints(
  session: ManualPerspectiveSession | null,
  applied: ManualPerspectiveRecord | null,
): readonly ManualPerspectiveOverlayPoint[] | null {
  if (session) return manualPerspectiveOverlayPoints(session.imagePoints);
  if (applied) return labelQuad(applied.adjustedSourceQuad);
  return null;
}

function imagePointsFromApplied(record: ManualPerspectiveRecord) {
  return imagePointsFromQuad(record.adjustedSourceQuad);
}

function labelQuad(quad: ManualPerspectiveImageQuad): readonly ManualPerspectiveOverlayPoint[] {
  return MANUAL_PERSPECTIVE_CORRESPONDENCE_ORDER.map((label, index) =>
    Object.freeze({
      x: quad[index].x,
      y: quad[index].y,
      label,
    }),
  );
}

async function recoverSession(input: {
  caseId: string;
  generationId: string;
  session: ManualPerspectiveSession;
  setRecovering: (value: boolean) => void;
  setRecoveryMessage: (value: string | null) => void;
}) {
  input.setRecovering(true);
  input.setRecoveryMessage("Recovering room from the manual quad…");
  try {
    const response = await fetch(buildManualPerspectiveRecoveryUrl(input.caseId, input.generationId), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imagePoints: input.session.imagePoints }),
    });
    const payload = await response.json().catch(() => null);
    const record = payload && typeof payload === "object" ? payload as {
      error?: unknown;
      status?: unknown;
      generationId?: unknown;
      failureReason?: unknown;
    } : null;
    if (!response.ok) {
      const reason = typeof record?.error === "string"
        ? record.error
        : typeof record?.failureReason === "string"
          ? record.failureReason
          : "Recovery failed.";
      input.setRecoveryMessage(reason);
      return;
    }
    const generationId = typeof record?.generationId === "string" ? record.generationId : null;
    input.setRecoveryMessage(
      record?.status === "ready" && generationId
        ? `Recovery complete. New generation ${generationId} is ready.`
        : "Recovery failed.",
    );
  } catch {
    input.setRecoveryMessage("Recovery failed.");
  } finally {
    input.setRecovering(false);
  }
}

async function applySession(input: {
  caseId: string;
  generationId: string;
  session: ManualPerspectiveSession;
  setApplying: (value: boolean) => void;
  setApplyMessage: (value: string | null) => void;
  setView: (value: ManualPerspectiveView | null) => void;
}) {
  input.setApplying(true);
  input.setApplyMessage(null);
  try {
    const response = await fetch(buildManualPerspectiveUrl(input.caseId, input.generationId), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imagePoints: input.session.imagePoints }),
    });
    if (response.status === 409) {
      const payload = await response.json().catch(() => null);
      const code = payload && typeof payload === "object" ? payload.code : null;
      input.setApplyMessage(
        code === "diagnostic_only"
          ? "Apply stayed off because this generation cannot drive STAGE."
          : "Apply stayed off because the floor is not realizable.",
      );
      return;
    }
    if (!response.ok) {
      input.setApplyMessage("Apply failed.");
      return;
    }
    const payload = await response.json();
    const applied = payload && typeof payload === "object" ? payload.applied : null;
    const parsed = parseManualPerspectiveView({
      qaEnabled: true,
      automatic: null,
      applied,
    });
    if (!parsed?.applied) {
      input.setApplyMessage("Apply failed.");
      return;
    }
    const reloaded = await reloadView(input.caseId, input.generationId);
    if (reloaded) input.setView(reloaded);
    input.setApplyMessage("Applied. The automatic AFC evidence is unchanged.");
  } catch {
    input.setApplyMessage("Apply failed.");
  } finally {
    input.setApplying(false);
  }
}

async function reloadView(caseId: string, generationId: string): Promise<ManualPerspectiveView | null> {
  const response = await fetch(buildManualPerspectiveUrl(caseId, generationId), {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) return null;
  return parseManualPerspectiveView(await response.json());
}
