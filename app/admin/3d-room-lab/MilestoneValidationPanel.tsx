"use client";

import { useMemo, useState } from "react";
import type { AttachableSupportKind } from "./support-attachment";
import {
  CURATED_ROOM_PROFILES,
  MILESTONE_SCENARIO_GUIDANCE,
  REQUIRED_CORE_OBSERVATIONS,
  buildObservationContextKey,
  buildVisibleRoomMilestoneReport,
  createEmptyOperatorObservations,
  describeMilestoneBlocker,
  evaluateCameraFoundation,
  evaluateCeilingDemo,
  evaluateCoreMilestone,
  evaluateFloorDemo,
  evaluateRefusalDemo,
  evaluateWallDemo,
  recordOperatorObservation,
  updateObservationNotes,
  usableWallKinds,
  withObservationCurrentness,
  type MilestoneMachineFacts,
  type MilestoneOperatorObservations,
  type MilestoneReadiness,
  type MilestoneObservationScenario,
  type MilestoneWallKind,
  type ValidationAttachmentProvenanceBySupport,
} from "./milestone-validation";

type MilestoneValidationPanelProps = {
  facts: MilestoneMachineFacts;
  observations: MilestoneOperatorObservations;
  provenanceBySupport: ValidationAttachmentProvenanceBySupport;
  onObservationsChange: (value: MilestoneOperatorObservations) => void;
  profileLabel: string;
  onProfileLabelChange: (value: string) => void;
  roomPhotoNotes: string;
  onRoomPhotoNotesChange: (value: string) => void;
  onSelectAttachmentSupport: (kind: AttachableSupportKind) => void;
};

const scenarioLabels: Readonly<Record<MilestoneObservationScenario, string>> = {
  floor_visual_placement: "Validate Floor attachment",
  wall_visual_placement: "Validate wall attachment",
  ceiling_visual_placement: "Validate Ceiling attachment",
  boundary_refusal: "Validate finite-boundary refusal",
  stale_frozen_lifecycle: "Validate stale/frozen behavior",
  support_independence: "Validate support independence",
  model_lock_refusal: "Validate model-mutation lock",
};

function readinessLabel(readiness: MilestoneReadiness): string {
  return readiness.state.replaceAll("_", " ");
}

function ReadinessRow({ label, readiness }: { label: string; readiness: MilestoneReadiness }) {
  return (
    <li className="rounded border border-slate-700 bg-slate-950/40 p-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-200">{label}</span>
        <span className={readiness.machineReady ? "text-emerald-300" : "text-amber-300"}>{readinessLabel(readiness)}</span>
      </div>
      {readiness.blockers.length > 0 ? (
        <ul className="mt-1 space-y-1 text-xs text-amber-200">
          {readiness.blockers.map((code) => (
            <li key={code}>
              <code className="text-slate-400">{code}</code> — {describeMilestoneBlocker(code)}
            </li>
          ))}
        </ul>
      ) : null}
      {readiness.underlyingBlockers.length > 0 ? (
        <p className="mt-1 text-xs text-slate-400">Underlying: {readiness.underlyingBlockers.join(" · ")}</p>
      ) : null}
    </li>
  );
}

export default function MilestoneValidationPanel({
  facts,
  observations,
  provenanceBySupport,
  onObservationsChange,
  profileLabel,
  onProfileLabelChange,
  roomPhotoNotes,
  onRoomPhotoNotesChange,
  onSelectAttachmentSupport,
}: MilestoneValidationPanelProps) {
  const [recordingRefusal, setRecordingRefusal] = useState<string | null>(null);
  const currentness = useMemo(
    () => withObservationCurrentness(observations, facts, provenanceBySupport),
    [facts, observations, provenanceBySupport]
  );
  const readiness = useMemo(
    () => ({
      cameraFoundation: evaluateCameraFoundation(facts),
      floorDemo: evaluateFloorDemo(facts),
      wallDemo: evaluateWallDemo(facts),
      ceilingDemo: evaluateCeilingDemo(facts),
      refusalDemo: evaluateRefusalDemo(facts),
      coreMilestone: evaluateCoreMilestone({ facts, observations, provenanceBySupport }),
    }),
    [facts, observations, provenanceBySupport]
  );
  const usableWalls = usableWallKinds(facts);
  const observedSupportForScenario = (scenario: MilestoneObservationScenario) => {
    if (scenario === "support_independence") return null;
    if (scenario === "floor_visual_placement") return "floor" as const;
    if (scenario === "wall_visual_placement") return observations[scenario].wallKind ?? null;
    if (scenario === "ceiling_visual_placement") return "ceiling" as const;
    return observations[scenario].supportKind ?? facts.attachment.supportKind;
  };
  const record = (scenario: MilestoneObservationScenario, status: "passed" | "failed") => {
    const current = observations[scenario];
    const supportKind = observedSupportForScenario(scenario);
    const provenance = supportKind ? provenanceBySupport[supportKind] ?? null : null;
    const attachmentDependent = scenario !== "support_independence";
    const placementScenario =
      scenario === "floor_visual_placement" ||
      scenario === "wall_visual_placement" ||
      scenario === "ceiling_visual_placement";
    if (
      attachmentDependent &&
      (!supportKind ||
        !provenance ||
        provenance.supportKind !== supportKind ||
        (status === "passed" &&
          placementScenario &&
          (facts.attachment.mode !== "support_attached_current" || facts.attachment.supportKind !== supportKind)))
    ) {
      setRecordingRefusal("Attach to the exact reviewed support and establish its attachment provenance before recording this observation.");
      return;
    }
    const contextKey = buildObservationContextKey({
      facts,
      scenario,
      observedSupportKind: supportKind,
      attachmentProvenance: provenance,
    });
    if (!contextKey) {
      setRecordingRefusal("This observation needs identifiable support and attachment provenance; no broad-context fallback is used.");
      return;
    }
    setRecordingRefusal(null);
    onObservationsChange({
      ...observations,
      [scenario]: recordOperatorObservation({
        previous: current,
        status,
        notes: current.notes,
        contextKey,
        observedAtIso: new Date().toISOString(),
        supportKind,
        wallKind: current.wallKind,
        attachmentProvenance: provenance,
      }),
    });
  };
  const copyReport = async () => {
    const report = buildVisibleRoomMilestoneReport({
      facts,
      observations,
      provenanceBySupport,
      generatedAtIso: new Date().toISOString(),
      profileLabel,
      roomPhotoNotes,
    });
    await navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
  };
  const downloadReport = () => {
    const report = buildVisibleRoomMilestoneReport({
      facts,
      observations,
      provenanceBySupport,
      generatedAtIso: new Date().toISOString(),
      profileLabel,
      roomPhotoNotes,
    });
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "visible-3d-room-lab-milestone-validation.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-4 rounded-xl border border-cyan-800/70 bg-slate-950/50 p-4">
      <div>
        <h3 className="text-sm font-semibold text-cyan-100">Visible 3D Milestone Validation</h3>
        <p className="mt-1 text-xs text-slate-400">
          Machine facts summarize existing authority. Visual placement is an explicit, session-local operator judgment.
        </p>
      </div>

      <ol className="space-y-2 text-xs">
        <ReadinessRow label="1. Camera foundation" readiness={readiness.cameraFoundation} />
        <ReadinessRow label="2–4. Floor, visible wall, and Ceiling readiness" readiness={readiness.coreMilestone} />
        <ReadinessRow label="8–11. Refusal-path availability" readiness={readiness.refusalDemo} />
      </ol>

      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={() => onSelectAttachmentSupport("floor")} className="rounded border border-slate-600 px-2 py-1 text-slate-200">
          Select Floor target
        </button>
        <button
          type="button"
          disabled={usableWalls.length === 0}
          onClick={() => usableWalls[0] && onSelectAttachmentSupport(usableWalls[0])}
          className="rounded border border-slate-600 px-2 py-1 text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Select first usable wall
        </button>
        <button type="button" onClick={() => onSelectAttachmentSupport("ceiling")} className="rounded border border-slate-600 px-2 py-1 text-slate-200">
          Select Ceiling target
        </button>
      </div>

      <div className="space-y-3">
        {recordingRefusal ? <p className="rounded border border-amber-700 bg-amber-950/30 p-2 text-xs text-amber-100">{recordingRefusal}</p> : null}
        {REQUIRED_CORE_OBSERVATIONS.map((scenario) => {
          const observation = observations[scenario];
          const view = currentness[scenario];
          const requiresWall = scenario === "wall_visual_placement";
          const requiresBoundarySupport = scenario === "boundary_refusal";
          return (
            <div key={scenario} className="rounded border border-slate-800 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">{scenarioLabels[scenario]}</p>
                  <p className="mt-1 text-xs text-slate-400">{MILESTONE_SCENARIO_GUIDANCE[scenario]}</p>
                </div>
                <span className={view.stale ? "text-amber-300" : view.status === "passed" ? "text-emerald-300" : view.status === "failed" ? "text-rose-300" : "text-slate-400"}>
                  {view.status.replaceAll("_", " ")}{view.stale ? " — stale context" : view.current ? " — current context" : ""}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => record(scenario, "passed")} className="rounded bg-emerald-900/60 px-2 py-1 text-xs text-emerald-100">
                  Record passed
                </button>
                <button type="button" onClick={() => record(scenario, "failed")} className="rounded bg-rose-900/60 px-2 py-1 text-xs text-rose-100">
                  Record failed
                </button>
                {requiresWall ? (
                  <select
                    value={observation.wallKind ?? ""}
                    onChange={(event) =>
                      onObservationsChange({
                        ...observations,
                        [scenario]: { ...observation, wallKind: (event.target.value || null) as MilestoneWallKind | null },
                      })
                    }
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">Observed wall</option>
                    <option value="wall_back">Back wall</option>
                    <option value="wall_left">Left wall</option>
                    <option value="wall_right">Right wall</option>
                  </select>
                ) : null}
                {requiresBoundarySupport ? (
                  <select
                    value={observation.supportKind ?? ""}
                    onChange={(event) =>
                      onObservationsChange({
                        ...observations,
                        [scenario]: { ...observation, supportKind: (event.target.value || null) as AttachableSupportKind | null },
                      })
                    }
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                  >
                    <option value="">Refusal support</option>
                    <option value="floor">Floor</option>
                    <option value="wall_back">Back wall</option>
                    <option value="wall_left">Left wall</option>
                    <option value="wall_right">Right wall</option>
                    <option value="ceiling">Ceiling</option>
                  </select>
                ) : null}
              </div>
              <label className="mt-2 block text-xs text-slate-400">
                Notes
                <textarea
                  value={observation.notes}
                  onChange={(event) =>
                    onObservationsChange({
                      ...observations,
                      [scenario]: updateObservationNotes(observation, event.target.value),
                    })
                  }
                  className="mt-1 block min-h-16 w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100"
                />
              </label>
              {observation.observedAtIso ? <p className="mt-1 text-xs text-slate-500">Recorded: {observation.observedAtIso}</p> : null}
              {observation.attachmentProvenance ? (
                <p className="mt-1 text-xs text-slate-500">
                  Provenance: {observation.attachmentProvenance.supportKind} · {observation.attachmentProvenance.contactProfileKey}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded border border-slate-800 p-3">
        <p className="text-sm font-medium text-slate-200">12. Review and export closeout report</p>
        <label className="mt-2 block text-xs text-slate-400">
          Operator-selected profile label
          <input value={profileLabel} onChange={(event) => onProfileLabelChange(event.target.value)} className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 p-2 text-slate-100" />
        </label>
        <label className="mt-2 block text-xs text-slate-400">
          Room-photo notes
          <textarea value={roomPhotoNotes} onChange={(event) => onRoomPhotoNotesChange(event.target.value)} className="mt-1 block min-h-16 w-full rounded border border-slate-700 bg-slate-950 p-2 text-slate-100" />
        </label>
        <ul className="mt-3 space-y-1 text-xs text-slate-400">
          {CURATED_ROOM_PROFILES.map((profile) => (
            <li key={profile.id}><span className="text-slate-200">{profile.label}:</span> {profile.characteristics} Purpose: {profile.purpose}</li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void copyReport()} className="rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-100">Copy validation report</button>
          <button type="button" onClick={downloadReport} className="rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-100">Download validation report</button>
          <button type="button" onClick={() => onObservationsChange(createEmptyOperatorObservations())} className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-100">Reset operator observations</button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Current result: {readiness.coreMilestone.state.replaceAll("_", " ")}. Reset changes only manual observations and notes.</p>
      </div>
    </section>
  );
}
