"use client";

import type { CalibrationAxis } from "@/lib/vibode-furniture/generation/calibrate";
import type { CalibrationSavePhase } from "@/lib/vibode-furniture/generator/calibration-ui";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const FIELD =
  "w-full min-w-0 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-neutral-500 disabled:cursor-not-allowed disabled:text-neutral-600";

const BUTTON = `rounded-md border px-2.5 py-1.5 text-xs ${FOCUS}`;

export function CandidateCalibrationForm({
  generatedCentimetres,
  axis,
  targetText,
  displayName,
  category,
  targetLabel,
  resultLabel,
  issue,
  phase,
  notice,
  canReview,
  locked,
  onAxis,
  onTarget,
  onDisplayName,
  onCategory,
  onReview,
  onBack,
  onCommit,
}: {
  generatedCentimetres: string;
  axis: CalibrationAxis;
  targetText: string;
  displayName: string;
  category: string;
  targetLabel: string | null;
  resultLabel: string | null;
  issue: string | null;
  phase: CalibrationSavePhase;
  notice: string | null;
  canReview: boolean;
  locked: boolean;
  onAxis: (axis: CalibrationAxis) => void;
  onTarget: (value: string) => void;
  onDisplayName: (value: string) => void;
  onCategory: (value: string) => void;
  onReview: () => void;
  onBack: () => void;
  onCommit: () => void;
}) {
  const saving = phase === "saving";
  const confirming = phase === "confirm";
  const saveEnabled = confirming && canReview && !locked && !saving;
  const inputsDisabled = saving || locked;
  return (
    <div data-calibration="candidate" data-calibration-axis={axis} data-save-phase={phase}>
      <p className="text-[11px] leading-5 text-neutral-500" data-dimension-authority="generated">
        Uncalibrated generated measurements, not verified product sizes.
        {" "}
        {generatedCentimetres}, width × depth × height.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={displayName}
          onChange={(event) => onDisplayName(event.target.value)}
          placeholder="Name this model"
          maxLength={80}
          aria-label="Furniture name"
          disabled={inputsDisabled}
          className={FIELD}
        />
        <input
          value={category}
          onChange={(event) => onCategory(event.target.value)}
          placeholder="Category (optional)"
          maxLength={40}
          aria-label="Furniture category"
          disabled={inputsDisabled}
          className={FIELD}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-neutral-400">
          Measurement
          <select
            value={axis}
            aria-label="Measurement"
            disabled={inputsDisabled}
            onChange={(event) => onAxis(event.target.value as CalibrationAxis)}
            className={`${FIELD} mt-1`}
          >
            <option value="height">Height</option>
            <option value="width">Width</option>
            <option value="depth">Depth</option>
          </select>
        </label>
        <label className="min-w-[8rem] flex-1 text-[11px] text-neutral-400">
          Real-world size
          <input
            value={targetText}
            onChange={(event) => onTarget(event.target.value)}
            inputMode="decimal"
            placeholder="Metres"
            aria-label="Real-world measurement in metres"
            disabled={inputsDisabled}
            className={`${FIELD} mt-1`}
          />
        </label>
        <p className="pb-1.5 text-[11px] text-neutral-300" data-calibration-target={targetLabel ? "ready" : "empty"}>
          {targetLabel ?? "Centimetres appear after a measurement."}
        </p>
      </div>
      <p className="mt-2 text-xs text-neutral-200" data-calibration-result={resultLabel ? "ready" : "empty"}>
        {resultLabel
          ? `Saved size ${resultLabel}. Width, depth, and height scale together.`
          : "The saved size appears after you enter one measurement."}
      </p>
      {issue ? <p className="mt-1 text-[11px] leading-5 text-amber-200">{issue}</p> : null}
      {confirming ? (
        <p className="mt-2 text-[11px] leading-5 text-neutral-200">
          Create a permanent My Furniture model at this size? The generated candidate stays unchanged.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {confirming || saving ? (
          <>
            <button
              type="button"
              disabled={!saveEnabled}
              data-save-enabled={saveEnabled ? "true" : "false"}
              onClick={onCommit}
              className={`${BUTTON} border-neutral-500 bg-neutral-800 text-neutral-100 disabled:cursor-not-allowed disabled:border-neutral-900 disabled:text-neutral-600`}
            >
              {saving ? "Saving…" : "Create permanent model"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onBack}
              className={`${BUTTON} border-neutral-700 text-neutral-300 disabled:cursor-not-allowed disabled:text-neutral-600`}
            >
              Back
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!canReview || locked}
            data-save-enabled="false"
            onClick={onReview}
            className={`${BUTTON} border-neutral-500 bg-neutral-800 text-neutral-100 disabled:cursor-not-allowed disabled:border-neutral-900 disabled:text-neutral-600`}
          >
            Save to My Furniture
          </button>
        )}
      </div>
      {notice ? (
        <p role="alert" className="mt-2 text-[11px] leading-5 text-amber-200">{notice}</p>
      ) : null}
    </div>
  );
}
