"use client";

import type { DimensionDraft, DimensionUnit } from "@/lib/vibode-furniture/dimension-edit";
import {
  DIMENSION_INDEPENDENT_NOTE,
  DIMENSION_PLACEMENT_NOTE,
  dimensionDraftCanSave,
} from "@/lib/vibode-furniture/dimension-edit";
import type { ModelDimensionAxis } from "@/lib/vibode-stage/model-dimensions";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const FIELD =
  `w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 ${FOCUS}`;

export function LibraryDimensionEditor({
  draft,
  saving,
  notice,
  onEdit,
  onUnit,
  onLocked,
  onBlur,
  onSave,
  onCancel,
}: {
  draft: DimensionDraft;
  saving: boolean;
  notice: string | null;
  onEdit: (axis: ModelDimensionAxis, value: string) => void;
  onUnit: (unit: DimensionUnit) => void;
  onLocked: (locked: boolean) => void;
  onBlur: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const unitLabel = draft.unit === "cm" ? "centimetres" : "inches";
  const canSave = dimensionDraftCanSave(draft) && !saving;
  return (
    <div className="mt-3" data-dimension-editor="open">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-neutral-700 p-0.5" role="group" aria-label="Measurement unit">
          {(["cm", "in"] as const).map((unit) => (
            <button
              key={unit}
              type="button"
              aria-pressed={draft.unit === unit}
              data-dimension-unit={unit}
              onClick={() => onUnit(unit)}
              className={`rounded px-2 py-1 text-[11px] ${FOCUS} ${
                draft.unit === unit ? "bg-neutral-700 text-neutral-100" : "text-neutral-400"
              }`}
            >
              {unit}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={draft.locked}
          aria-label={draft.locked ? "Proportions locked" : "Proportions unlocked"}
          data-dimension-lock={draft.locked ? "locked" : "unlocked"}
          onClick={() => onLocked(!draft.locked)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
            draft.locked
              ? "border-neutral-500 bg-neutral-800 text-neutral-100"
              : "border-neutral-700 text-neutral-300"
          }`}
        >
          <LockIcon locked={draft.locked} />
          {draft.locked ? "Proportions locked" : "Proportions unlocked"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <DimensionField label="Width" unit={unitLabel} value={draft.texts.width} onChange={(value) => onEdit("width", value)} onBlur={onBlur} />
        <DimensionField label="Depth" unit={unitLabel} value={draft.texts.depth} onChange={(value) => onEdit("depth", value)} onBlur={onBlur} />
        <DimensionField label="Height" unit={unitLabel} value={draft.texts.height} onChange={(value) => onEdit("height", value)} onBlur={onBlur} />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-neutral-500">
        {draft.locked ? "Changing one side changes the others to match." : DIMENSION_INDEPENDENT_NOTE}
        {" "}
        {DIMENSION_PLACEMENT_NOTE}
      </p>
      {draft.issue ? (
        <p role="alert" className="mt-2 text-[11px] text-amber-200">{draft.issue}</p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-[11px] text-amber-200">{notice}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={onSave}
          className={`rounded-md border border-neutral-500 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-600 ${FOCUS}`}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className={`rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 disabled:cursor-not-allowed disabled:text-neutral-600 ${FOCUS}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DimensionField({
  label,
  unit,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  return (
    <label className="block text-[11px] text-neutral-400">
      {label}
      <input
        value={value}
        inputMode="decimal"
        aria-label={`${label} in ${unit}`}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={`mt-1 ${FIELD}`}
      />
    </label>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <rect x="2.25" y="5.25" width="7.5" height="5.25" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {locked ? (
        <path d="M3.75 5.25V3.7a2.25 2.25 0 0 1 4.5 0V5.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
      ) : (
        <path d="M3.75 5.25V3.7a2.25 2.25 0 0 1 4.2-1.15" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}
