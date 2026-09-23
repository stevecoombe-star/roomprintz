"use client";

import { useMemo, useState } from "react";

import {
  P2_S2B_HOLDOUT_ORACLE_BOUNDARY_STATES,
  P2_S2B_HOLDOUT_ORACLE_ENDPOINT_STATUSES,
  P2_S2B_HOLDOUT_ORACLE_EVIDENCE_KINDS,
  P2_S2B_HOLDOUT_ORACLE_FRAME_CONTACTS,
  P2_S2B_HOLDOUT_ORACLE_INTERPRETATIONS,
  P2_S2B_HOLDOUT_ORACLE_ROOMS,
  createP2S2BHoldoutOracleDraftAnnotation,
  getP2S2BHoldoutOracleIdentity,
  serializeP2S2BHoldoutOracleFixture,
  sourcePixelToP2S2BHoldoutOracleNormalized,
  validateP2S2BHoldoutOracleDraft,
  type P2S2BHoldoutOracleDraftAnnotation,
  type P2S2BHoldoutOracleRoomId,
  type P2S2BHoldoutOracleSourcePixelPoint,
} from "../p2-s2b-holdout-oracle-authoring";

type EndpointKey = "startEndpoint" | "endEndpoint";

const STATE_COLORS = {
  physical_wall: "#22d3ee",
  open: "#4ade80",
  unknown: "#facc15",
  frame_truncated: "#c084fc",
} as const;

function clampPixel(value: number, extent: number): number {
  return Math.min(extent - 1, Math.max(0, Math.round(value)));
}

function updateAt<T>(
  values: readonly T[],
  index: number,
  update: (value: T) => T
): readonly T[] {
  return values.map((value, valueIndex) =>
    valueIndex === index ? update(value) : value
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}>) {
  return (
    <label className="grid gap-1 text-xs text-slate-300">
      <span>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value as T)}
        className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
      >
        {options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

export default function HoldoutOracleAuthoringClient() {
  const [roomId, setRoomId] = useState<P2S2BHoldoutOracleRoomId>("room-b");
  const [annotations, setAnnotations] = useState<
    readonly P2S2BHoldoutOracleDraftAnnotation[]
  >(() => [createP2S2BHoldoutOracleDraftAnnotation(1)]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [cursor, setCursor] =
    useState<P2S2BHoldoutOracleSourcePixelPoint | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const identity = getP2S2BHoldoutOracleIdentity(roomId);
  const dimensions = identity.emptyDimensions;
  const selected = annotations[selectedIndex] ?? null;
  const validation = useMemo(
    () => validateP2S2BHoldoutOracleDraft(roomId, annotations),
    [annotations, roomId]
  );
  const serialized = useMemo(
    () => validation.ok
      ? serializeP2S2BHoldoutOracleFixture(roomId, annotations)
      : "",
    [annotations, roomId, validation.ok]
  );

  function resetForRoom(nextRoomId: P2S2BHoldoutOracleRoomId) {
    const hasPoints = annotations.some(annotation =>
      annotation.pointsSourcePx.length > 0
    );
    if (
      hasPoints &&
      !window.confirm("Discard the current unsaved manual coordinates?")
    ) {
      return;
    }
    setRoomId(nextRoomId);
    setAnnotations([createP2S2BHoldoutOracleDraftAnnotation(1)]);
    setSelectedIndex(0);
    setCursor(null);
    setCopyStatus("");
  }

  function updateSelected(
    update: (annotation: P2S2BHoldoutOracleDraftAnnotation) =>
      P2S2BHoldoutOracleDraftAnnotation
  ) {
    setAnnotations(current => updateAt(current, selectedIndex, update));
  }

  function pointFromPointer(
    event: React.PointerEvent<SVGSVGElement>
  ): P2S2BHoldoutOracleSourcePixelPoint {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clampPixel(
        ((event.clientX - bounds.left) / bounds.width) * dimensions.width,
        dimensions.width
      ),
      y: clampPixel(
        ((event.clientY - bounds.top) / bounds.height) * dimensions.height,
        dimensions.height
      ),
    };
  }

  function addPoint(event: React.PointerEvent<SVGSVGElement>) {
    if (!selected) return;
    const point = pointFromPointer(event);
    updateSelected(annotation => ({
      ...annotation,
      pointsSourcePx: [...annotation.pointsSourcePx, point],
    }));
  }

  function updatePoint(
    pointIndex: number,
    axis: "x" | "y",
    rawValue: string
  ) {
    if (!selected) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    updateSelected(annotation => ({
      ...annotation,
      pointsSourcePx: updateAt(
        annotation.pointsSourcePx,
        pointIndex,
        point => ({
          ...point,
          [axis]: clampPixel(
            value,
            axis === "x" ? dimensions.width : dimensions.height
          ),
        })
      ),
    }));
  }

  function updateEndpoint(
    key: EndpointKey,
    field: "status" | "frameContact",
    value: string
  ) {
    updateSelected(annotation => ({
      ...annotation,
      [key]: { ...annotation[key], [field]: value },
    }));
  }

  function addAnnotation() {
    const next = createP2S2BHoldoutOracleDraftAnnotation(
      annotations.length + 1
    );
    setAnnotations(current => [...current, next]);
    setSelectedIndex(annotations.length);
  }

  function removeSelected() {
    if (!selected) return;
    const next = annotations.filter((_, index) => index !== selectedIndex);
    setAnnotations(next);
    setSelectedIndex(Math.max(0, Math.min(selectedIndex, next.length - 1)));
  }

  function downloadFixture() {
    if (!serialized) return;
    const url = URL.createObjectURL(
      new Blob([serialized], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${roomId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyFixture() {
    if (!serialized) return;
    await navigator.clipboard.writeText(serialized);
    setCopyStatus("Copied strict fixture JSON.");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-[1600px]">
        <header className="rounded border border-amber-700/60 bg-amber-950/20 p-4">
          <h1 className="text-lg font-semibold">
            P2-S2B blind holdout oracle authoring
          </h1>
          <p className="mt-1 text-sm text-amber-100">
            Certified EMPTY plus manual oracle only. Visible physical floor
            termination; no hidden continuation. Openings stay open and
            occlusions stay gaps.
          </p>
          <p className="mt-1 text-xs text-amber-300">
            This page has no detector overlay, prediction reader, scoring
            corridor, or scoring action.
          </p>
        </header>

        <section className="mt-4 grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-3 md:grid-cols-3">
          <SelectField
            label="Certified EMPTY room"
            value={roomId}
            options={P2_S2B_HOLDOUT_ORACLE_ROOMS}
            onChange={resetForRoom}
          />
          <div className="text-xs text-slate-300">
            <p>Dimensions</p>
            <p className="mt-2 font-mono text-slate-100">
              {dimensions.width} × {dimensions.height}
            </p>
          </div>
          <div className="min-w-0 text-xs text-slate-300">
            <p>EMPTY SHA-256</p>
            <p className="mt-2 truncate font-mono text-slate-100" title={identity.emptySha256}>
              {identity.emptySha256}
            </p>
          </div>
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section>
            <div
              className="relative overflow-hidden rounded border border-slate-700 bg-black"
              style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/admin/3d-room-lab/p2-s2b-holdout-oracle-image?roomId=${roomId}`}
                alt={`${roomId} certified EMPTY for blind physical-boundary authoring`}
                className="absolute inset-0 h-full w-full"
                draggable={false}
              />
              <svg
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
                onPointerDown={addPoint}
                onPointerMove={event => setCursor(pointFromPointer(event))}
                onPointerLeave={() => setCursor(null)}
                aria-label="Manual source-pixel polyline canvas"
              >
                {annotations.map((annotation, annotationIndex) => {
                  const points = annotation.pointsSourcePx
                    .map(point => `${point.x},${point.y}`)
                    .join(" ");
                  const color = STATE_COLORS[annotation.boundaryState];
                  return (
                    <g key={`${annotation.id}-${annotationIndex}`}>
                      {annotation.pointsSourcePx.length >= 2 ? (
                        <polyline
                          points={points}
                          fill="none"
                          stroke={color}
                          strokeWidth={annotationIndex === selectedIndex ? 3 : 2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                      {annotation.pointsSourcePx.map((point, pointIndex) => (
                        <circle
                          key={pointIndex}
                          cx={point.x}
                          cy={point.y}
                          r={annotationIndex === selectedIndex ? 5 : 3}
                          fill={color}
                          stroke="#020617"
                          strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span>Click to append source-pixel anchors to the selected finite chain.</span>
              <span className="ml-auto font-mono text-cyan-200">
                {cursor ? `x ${cursor.x}, y ${cursor.y}` : "x —, y —"}
              </span>
            </div>

            <div className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={addAnnotation}
                  className="rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-100"
                >
                  Add finite annotation
                </button>
                <button
                  type="button"
                  disabled={!selected?.pointsSourcePx.length}
                  onClick={() => updateSelected(annotation => ({
                    ...annotation,
                    pointsSourcePx: annotation.pointsSourcePx.slice(0, -1),
                  }))}
                  className="rounded border border-slate-700 px-2 py-1 text-xs disabled:opacity-40"
                >
                  Undo last point
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={removeSelected}
                  className="rounded border border-red-900 px-2 py-1 text-xs text-red-200 disabled:opacity-40"
                >
                  Remove annotation
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {annotations.map((annotation, index) => (
                  <button
                    key={`${annotation.id}-${index}`}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={`rounded border px-2 py-1 text-xs ${
                      index === selectedIndex
                        ? "border-cyan-400 bg-cyan-950 text-cyan-100"
                        : "border-slate-700 text-slate-300"
                    }`}
                  >
                    {annotation.id || `annotation ${index + 1}`}
                    {" · "}{annotation.pointsSourcePx.length} points
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded border border-slate-800 bg-slate-900/60 p-3">
            {selected ? (
              <div className="grid gap-3">
                <label className="grid gap-1 text-xs text-slate-300">
                  <span>Annotation ID</span>
                  <input
                    value={selected.id}
                    onChange={event => updateSelected(annotation => ({
                      ...annotation,
                      id: event.target.value,
                    }))}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <SelectField
                    label="Interpretation"
                    value={selected.interpretation}
                    options={P2_S2B_HOLDOUT_ORACLE_INTERPRETATIONS}
                    onChange={interpretation => updateSelected(annotation => ({
                      ...annotation,
                      interpretation,
                    }))}
                  />
                  <SelectField
                    label="Evidence kind"
                    value={selected.evidenceKind}
                    options={P2_S2B_HOLDOUT_ORACLE_EVIDENCE_KINDS}
                    onChange={evidenceKind => updateSelected(annotation => ({
                      ...annotation,
                      evidenceKind,
                      collisionEligible:
                        evidenceKind === "direct_visible" &&
                        annotation.boundaryState === "physical_wall"
                          ? annotation.collisionEligible
                          : false,
                    }))}
                  />
                  <SelectField
                    label="Boundary state"
                    value={selected.boundaryState}
                    options={P2_S2B_HOLDOUT_ORACLE_BOUNDARY_STATES}
                    onChange={boundaryState => updateSelected(annotation => ({
                      ...annotation,
                      boundaryState,
                      collisionEligible:
                        boundaryState === "physical_wall" &&
                        annotation.evidenceKind === "direct_visible"
                          ? annotation.collisionEligible
                          : false,
                    }))}
                  />
                  <label className="flex items-center gap-2 self-end rounded border border-slate-700 px-2 py-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={selected.collisionEligible}
                      disabled={
                        selected.boundaryState !== "physical_wall" ||
                        selected.evidenceKind !== "direct_visible"
                      }
                      onChange={event => updateSelected(annotation => ({
                        ...annotation,
                        collisionEligible: event.target.checked,
                      }))}
                    />
                    Collision eligible
                  </label>
                </div>

                {(["startEndpoint", "endEndpoint"] as const).map(key => (
                  <fieldset key={key} className="rounded border border-slate-700 p-2">
                    <legend className="px-1 text-xs text-slate-300">
                      {key === "startEndpoint" ? "Start endpoint" : "End endpoint"}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      <SelectField
                        label="Status"
                        value={selected[key].status}
                        options={P2_S2B_HOLDOUT_ORACLE_ENDPOINT_STATUSES}
                        onChange={value => updateEndpoint(key, "status", value)}
                      />
                      <SelectField
                        label="Frame contact"
                        value={selected[key].frameContact}
                        options={P2_S2B_HOLDOUT_ORACLE_FRAME_CONTACTS}
                        onChange={value => updateEndpoint(key, "frameContact", value)}
                      />
                    </div>
                  </fieldset>
                ))}

                <label className="grid gap-1 text-xs text-slate-300">
                  <span>Visible-evidence notes</span>
                  <textarea
                    value={selected.notes}
                    rows={4}
                    onChange={event => updateSelected(annotation => ({
                      ...annotation,
                      notes: event.target.value,
                    }))}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100"
                    placeholder="Describe only what is directly visible and why the finite span ends."
                  />
                </label>

                <div>
                  <p className="text-xs text-slate-300">Manual anchors</p>
                  <div className="mt-2 grid gap-2">
                    {selected.pointsSourcePx.map((point, pointIndex) => {
                      const normalized =
                        sourcePixelToP2S2BHoldoutOracleNormalized(roomId, point);
                      return (
                        <div
                          key={pointIndex}
                          className="grid grid-cols-[24px_1fr_1fr] items-center gap-2 text-xs"
                        >
                          <span className="text-slate-500">{pointIndex + 1}</span>
                          <input
                            type="number"
                            value={point.x}
                            min={0}
                            max={dimensions.width - 1}
                            onChange={event => updatePoint(
                              pointIndex,
                              "x",
                              event.target.value
                            )}
                            className="min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                            aria-label={`Point ${pointIndex + 1} source x`}
                          />
                          <input
                            type="number"
                            value={point.y}
                            min={0}
                            max={dimensions.height - 1}
                            onChange={event => updatePoint(
                              pointIndex,
                              "y",
                              event.target.value
                            )}
                            className="min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1"
                            aria-label={`Point ${pointIndex + 1} source y`}
                          />
                          <span />
                          <span className="col-span-2 font-mono text-[10px] text-slate-500">
                            normalized {normalized.x.toFixed(6)}, {normalized.y.toFixed(6)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Add a finite annotation to begin.
              </p>
            )}
          </aside>
        </div>

        <section className="mt-4 rounded border border-slate-800 bg-slate-900/60 p-3">
          <h2 className="text-sm font-medium">Strict fixture export</h2>
          <p className="mt-1 text-xs text-slate-400">
            P2-S1 contract · empty-source-normalized/v1 · fixed 6 source-pixel corridor
          </p>
          {validation.ok ? (
            <div className="mt-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={downloadFixture}
                  className="rounded border border-green-700 px-2 py-1 text-xs text-green-100"
                >
                  Download {roomId}.json
                </button>
                <button
                  type="button"
                  onClick={copyFixture}
                  className="rounded border border-slate-700 px-2 py-1 text-xs"
                >
                  Copy JSON
                </button>
                <span className="self-center text-xs text-green-300">
                  {copyStatus || "Draft passes authoring-side constraints."}
                </span>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto rounded bg-slate-950 p-3 text-[10px] text-slate-300">
                {serialized}
              </pre>
            </div>
          ) : (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-200">
              {validation.errors.map(error => <li key={error}>{error}</li>)}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
