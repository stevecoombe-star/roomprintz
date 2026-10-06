"use client";

import { useId, useState } from "react";

import {
  DEFAULT_MODEL_SIZING_MODE,
  editModelDimension,
  formatModelDimensionList,
  formatModelMetres,
  PARTNER_MODEL_DIMENSIONS_EXACT_NOTE,
  PARTNER_MODEL_DIMENSIONS_INVALID,
  PARTNER_MODEL_DIMENSIONS_NOTE,
  setModelSizingMode,
  type ModelDimensionAxis,
  type ModelDimensions,
  type ModelSize,
  type ModelSizingMode,
} from "@/lib/vibode-stage/model-dimensions";

import { FIELD, FOCUS } from "./editor-ui";

const LOCK_BUTTON =
  `inline-flex items-center justify-center rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-100 hover:border-slate-400 ${FOCUS} disabled:cursor-not-allowed disabled:opacity-60`;

function sizeOf(dimensions: ModelDimensions): ModelSize {
  return {
    widthM: dimensions.widthM,
    heightM: dimensions.heightM,
    depthM: dimensions.depthM,
  };
}

function startingDimensions(
  dimensions: ModelDimensions | null,
  native: ModelSize,
): ModelDimensions {
  if (dimensions) return dimensions;
  return { ...native, sizingMode: DEFAULT_MODEL_SIZING_MODE };
}

export function PartnerModelDimensions(props: Readonly<{
  native: ModelSize;
  dimensions: ModelDimensions | null;
  disabled?: boolean;
  onCommit: (next: ModelDimensions) => void;
}>) {
  const id = useId();
  const initial = startingDimensions(props.dimensions, props.native);
  const [mode, setMode] = useState<ModelSizingMode>(initial.sizingMode);
  const [baseline, setBaseline] = useState<ModelSize>(sizeOf(initial));
  const [valid, setValid] = useState<ModelDimensions>(initial);
  const [width, setWidth] = useState(formatModelMetres(initial.widthM));
  const [depth, setDepth] = useState(formatModelMetres(initial.depthM));
  const [height, setHeight] = useState(formatModelMetres(initial.heightM));
  const [error, setError] = useState<string | null>(null);
  const locked = mode === "uniform";

  function show(next: ModelSize) {
    setWidth(formatModelMetres(next.widthM));
    setDepth(formatModelMetres(next.depthM));
    setHeight(formatModelMetres(next.heightM));
  }

  function commit(next: ModelDimensions) {
    setValid(next);
    setError(null);
    props.onCommit(next);
  }

  function change(axis: ModelDimensionAxis, value: string) {
    if (axis === "width") setWidth(value);
    if (axis === "depth") setDepth(value);
    if (axis === "height") setHeight(value);
    const numeric = Number(value);
    const next = editModelDimension({
      mode,
      baseline,
      current: valid,
      axis,
      nextValue: numeric,
    });
    if (!value.trim() || !next) {
      setError(PARTNER_MODEL_DIMENSIONS_INVALID);
      return;
    }
    const dimensions = { ...next, sizingMode: mode };
    setValid(dimensions);
    setError(null);
    if (mode === "uniform") {
      if (axis !== "width") setWidth(formatModelMetres(next.widthM));
      if (axis !== "depth") setDepth(formatModelMetres(next.depthM));
      if (axis !== "height") setHeight(formatModelMetres(next.heightM));
    }
  }

  function blur(axis: ModelDimensionAxis) {
    const raw = axis === "width" ? width : axis === "depth" ? depth : height;
    const next = editModelDimension({
      mode,
      baseline,
      current: valid,
      axis,
      nextValue: Number(raw),
    });
    if (!next) {
      setError(PARTNER_MODEL_DIMENSIONS_INVALID);
      return;
    }
    const dimensions = { ...next, sizingMode: mode };
    show(next);
    commit(dimensions);
  }

  function toggleLock() {
    const nextMode: ModelSizingMode = locked ? "exact" : "uniform";
    const next = setModelSizingMode(valid, nextMode);
    if (!next) {
      setError(PARTNER_MODEL_DIMENSIONS_INVALID);
      return;
    }
    setMode(nextMode);
    if (nextMode === "uniform") setBaseline(sizeOf(next));
    show(next);
    commit(next);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Detected model size</p>
        <p className="mt-1 text-sm text-slate-300">{formatModelDimensionList(props.native)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Product dimensions</p>
        <button
          type="button"
          className={LOCK_BUTTON}
          aria-pressed={locked}
          aria-label="Lock proportions"
          disabled={props.disabled}
          onClick={toggleLock}
        >
          {locked ? "🔒 Lock proportions" : "🔓 Lock proportions"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="block text-xs text-slate-400" htmlFor={`${id}-width`}>
          Width
          <input
            id={`${id}-width`}
            className={FIELD}
            inputMode="decimal"
            value={width}
            disabled={props.disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => change("width", event.target.value)}
            onBlur={() => blur("width")}
          />
        </label>
        <label className="block text-xs text-slate-400" htmlFor={`${id}-depth`}>
          Depth
          <input
            id={`${id}-depth`}
            className={FIELD}
            inputMode="decimal"
            value={depth}
            disabled={props.disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => change("depth", event.target.value)}
            onBlur={() => blur("depth")}
          />
        </label>
        <label className="block text-xs text-slate-400" htmlFor={`${id}-height`}>
          Height
          <input
            id={`${id}-height`}
            className={FIELD}
            inputMode="decimal"
            value={height}
            disabled={props.disabled}
            aria-invalid={error ? true : undefined}
            onChange={(event) => change("height", event.target.value)}
            onBlur={() => blur("height")}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">{PARTNER_MODEL_DIMENSIONS_NOTE}</p>
      {locked ? null : (
        <p className="text-xs text-slate-400">{PARTNER_MODEL_DIMENSIONS_EXACT_NOTE}</p>
      )}
      {error ? <p role="alert" className="text-sm text-rose-200">{error}</p> : null}
    </div>
  );
}
