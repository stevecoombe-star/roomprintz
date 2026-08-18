"use client";

import { useState } from "react";

import type {
  AfcSr1LiveFloorReadDiagnostic,
} from "./afc-sr1-live-product-contract";
import type {
  AfcSr1V3ReaderDiagnosticsV1,
} from "./afc-sr1-v3-reader-diagnostics";
import {
  mapAfcSr1V3AnalysisPointToDecodedPixel,
  mapAfcSr1V3DecodedPointToSourceNormalized,
} from "./afc-sr1-v3-reader-diagnostics";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";
import {
  convertAfcSr1PixelLineToSourceNormalized,
} from "./research/afc-sr1-floor-vanishing-line-cross-room";

export type AfcSr1LiveFinalGeometryOverlay = Readonly<{
  polygon: AfcSr1SourcePolygon;
  fixedAnchor: "NL" | "NR" | null;
  adjustableCorner: "NL" | "NR" | null;
  baselineSeamT: number | null;
}>;

export type AfcSr1LiveFloorReadOverlayProps = Readonly<{
  diagnostic: Pick<AfcSr1LiveFloorReadDiagnostic, "polygon" | "analysisBasis" | "emptyImage" | "originalPreview">;
  rawV3ReaderDiagnostics?: AfcSr1V3ReaderDiagnosticsV1 | null;
  finalGeometry: AfcSr1LiveFinalGeometryOverlay | null;
  originalPreviewUrl: string | null;
}>;

const CORNERS = ["NL", "NR", "FR", "FL"] as const;
const FAMILY_COLORS = ["#f59e0b", "#ec4899", "#a78bfa", "#22d3ee", "#fb7185", "#84cc16"] as const;

export function buildAfcSr1LiveFloorReadOverlayModel(input: Readonly<{
  rawPolygon: AfcSr1SourcePolygon;
  finalGeometry: AfcSr1LiveFinalGeometryOverlay | null;
}>) {
  return Object.freeze({
    rawPolygon: input.rawPolygon,
    finalPolygon: input.finalGeometry?.polygon ?? null,
    fixedAnchor: input.finalGeometry?.fixedAnchor ?? null,
    adjustableCorner: input.finalGeometry?.adjustableCorner ?? null,
    baselineSeamT: input.finalGeometry?.baselineSeamT ?? null,
  });
}

export function buildAfcSr1LiveFloorSupporterOverlayModel(input: Readonly<{
  diagnostics: AfcSr1V3ReaderDiagnosticsV1 | null;
  selectedFamilyIndices: readonly number[];
}>) {
  const diagnostics = input.diagnostics;
  const geometry = diagnostics?.familySupportGeometry;
  if (!geometry || !diagnostics) return Object.freeze([]);
  const selected = new Set(input.selectedFamilyIndices);
  const memberships = new Map<number, number[]>();
  for (const family of geometry.families) {
    if (!selected.has(family.familyIndex)) continue;
    for (const detectorIndex of family.supporterDetectorIndices) {
      memberships.set(detectorIndex, [
        ...(memberships.get(detectorIndex) ?? []),
        family.familyIndex,
      ]);
    }
  }
  return Object.freeze(
    geometry.segments.flatMap((segment) => {
      const familyIndices = memberships.get(segment.detectorIndex) ?? [];
      const firstDecoded = mapAfcSr1V3AnalysisPointToDecodedPixel(
        { x: segment.x1, y: segment.y1 }, diagnostics.analysisIdentity
      );
      const secondDecoded = mapAfcSr1V3AnalysisPointToDecodedPixel(
        { x: segment.x2, y: segment.y2 }, diagnostics.analysisIdentity
      );
      const first = firstDecoded && mapAfcSr1V3DecodedPointToSourceNormalized(
        firstDecoded, diagnostics.imageIdentity
      );
      const second = secondDecoded && mapAfcSr1V3DecodedPointToSourceNormalized(
        secondDecoded, diagnostics.imageIdentity
      );
      return first && second && familyIndices.length > 0
        ? [Object.freeze({
            detectorIndex: segment.detectorIndex,
            first,
            second,
            familyIndices: Object.freeze(familyIndices),
          })]
        : [];
    })
  );
}

function familyColor(familyIndex: number): string {
  return FAMILY_COLORS[familyIndex % FAMILY_COLORS.length]!;
}

function familyQuality(
  diagnostics: AfcSr1V3ReaderDiagnosticsV1 | null,
  familyIndex: number
): AfcSr1V3ReaderDiagnosticsV1["winningPair"]["families"][number] | null {
  if (!diagnostics) return null;
  for (const pair of diagnostics.validPairUniverse) {
    const position = pair.familyIndices.indexOf(familyIndex);
    if (position >= 0) return pair.families[position] ?? null;
  }
  return null;
}

function polygonPoints(polygon: AfcSr1SourcePolygon): string {
  return polygon.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function clippedHorizonPoints(
  diagnostics: AfcSr1V3ReaderDiagnosticsV1 | null
): string | null {
  if (!diagnostics) return null;
  const line = convertAfcSr1PixelLineToSourceNormalized(
    {
      decodedWidth: diagnostics.imageIdentity.decodedWidth,
      decodedHeight: diagnostics.imageIdentity.decodedHeight,
    },
    diagnostics.floorVanishingLinePixel
  );
  if (!line) return null;
  const points: { x: number; y: number }[] = [];
  const add = (x: number, y: number) => {
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1 &&
        !points.some((point) => Math.hypot(point.x - x, point.y - y) < 1e-9)) {
      points.push({ x, y });
    }
  };
  if (line.b !== 0) {
    add(0, -line.c / line.b);
    add(1, -(line.a + line.c) / line.b);
  }
  if (line.a !== 0) {
    add(-line.c / line.a, 0);
    add(-(line.b + line.c) / line.a, 1);
  }
  return points.length >= 2
    ? `${points[0].x * 100},${points[0].y * 100} ${points[1].x * 100},${points[1].y * 100}`
    : null;
}

/**
 * Read-only visual evidence of the selected Empty-Room Assist Floor.
 * It deliberately owns no Floor mutation callback or authority state.
 */
export default function AfcSr1LiveFloorReadOverlay({
  diagnostic,
  rawV3ReaderDiagnostics,
  finalGeometry,
  originalPreviewUrl,
}: AfcSr1LiveFloorReadOverlayProps) {
  const [imageRole, setImageRole] = useState<"empty" | "original">("empty");
  const [supportersVisible, setSupportersVisible] = useState(true);
  const [selectedFamilyIndices, setSelectedFamilyIndices] = useState<readonly number[] | null>(null);
  const canShowOriginal = originalPreviewUrl !== null;
  const showOriginal = imageRole === "original" && canShowOriginal;
  const imageUrl = showOriginal ? originalPreviewUrl : diagnostic.emptyImage.url;
  const model = buildAfcSr1LiveFloorReadOverlayModel({
    rawPolygon: diagnostic.polygon,
    finalGeometry,
  });
  const [NL, NR, FR, FL] = model.rawPolygon;
  const corners = { NL, NR, FR, FL };
  const rawPoints = polygonPoints(model.rawPolygon);
  const finalPoints = model.finalPolygon
    ? polygonPoints(model.finalPolygon)
    : null;
  const dimensions = showOriginal
    ? diagnostic.originalPreview
    : diagnostic.analysisBasis;
  const horizonPoints = showOriginal
    ? null
    : clippedHorizonPoints(rawV3ReaderDiagnostics ?? null);
  const supportGeometry = !showOriginal
    ? rawV3ReaderDiagnostics?.familySupportGeometry ?? null
    : null;
  const familyIndices = supportGeometry?.families.map((family) => family.familyIndex) ?? [];
  const activeFamilyIndices = selectedFamilyIndices ?? familyIndices;
  const supporterSegments = !showOriginal && supportersVisible
    ? buildAfcSr1LiveFloorSupporterOverlayModel({
        diagnostics: rawV3ReaderDiagnostics ?? null,
        selectedFamilyIndices: activeFamilyIndices,
      })
    : [];
  const toggleFamily = (familyIndex: number) => {
    setSelectedFamilyIndices((current) => {
      const active = new Set(current ?? familyIndices);
      if (active.has(familyIndex)) active.delete(familyIndex);
      else active.add(familyIndex);
      return Object.freeze([...active].sort((left, right) => left - right));
    });
  };

  return (
    <section className="mt-3 rounded border border-emerald-900/70 bg-slate-950/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-emerald-100">
          Automatic Floor read — Empty-Room Assist (read-only)
        </p>
        <div className="ml-auto flex gap-1 text-[11px]">
          <button
            type="button"
            className={`rounded border px-2 py-0.5 ${!showOriginal ? "border-emerald-400 text-emerald-100" : "border-slate-700 text-slate-400"}`}
            onClick={() => setImageRole("empty")}
          >
            EMPTY — analysis basis
          </button>
          {canShowOriginal ? (
            <button
              type="button"
              className={`rounded border px-2 py-0.5 ${showOriginal ? "border-cyan-400 text-cyan-100" : "border-slate-700 text-slate-400"}`}
              onClick={() => setImageRole("original")}
            >
              ORIGINAL — preview only
            </button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {showOriginal
          ? "The same source-normalized automatic and final geometry is shown for human comparison only; the detector analyzed EMPTY."
          : `EMPTY analysis basis: ${diagnostic.analysisBasis.decodedWidth}×${diagnostic.analysisBasis.decodedHeight}.`}
      </p>
      {supportGeometry ? (
        <div className="mt-2 rounded border border-slate-800 bg-slate-950/60 p-2 text-[11px] text-slate-300">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              className="rounded border border-slate-600 px-2 py-0.5 text-slate-200"
              onClick={() => {
                if (supportersVisible) {
                  setSupportersVisible(false);
                } else {
                  setSelectedFamilyIndices(Object.freeze([...familyIndices]));
                  setSupportersVisible(true);
                }
              }}
            >
              {supportersVisible ? "Hide supporters" : "Show all final-family supporters"}
            </button>
            <span>
              RAW V3 winning pair: [{rawV3ReaderDiagnostics?.winningPair.familyIndices.join(", ") ?? "n/a"}]
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {supportGeometry.families.map((family) => (
              <div key={family.familyIndex} className="inline-flex items-center gap-1">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={activeFamilyIndices.includes(family.familyIndex)}
                    onChange={() => toggleFamily(family.familyIndex)}
                  />
                  <span style={{ color: familyColor(family.familyIndex) }}>
                    Family {family.familyIndex}
                  </span>
                  <span>({family.supporterDetectorIndices.length})</span>
                </label>
                {(() => {
                  const quality = familyQuality(rawV3ReaderDiagnostics ?? null, family.familyIndex);
                  return quality ? (
                    <span className="text-slate-500">
                      {quality.vpClass} · ρ {quality.rho.toFixed(2)} · length{" "}
                      {quality.supportTotalLengthPx.toFixed(1)} px · residual{" "}
                      {quality.medianResidualPx.toFixed(2)}/{quality.p90ResidualPx.toFixed(2)} px
                    </span>
                  ) : null;
                })()}
              </div>
            ))}
          </div>
          <p className="mt-1 text-slate-400">
            Identity colors only. These are final V3 supporters from the existing admitted segment
            population; the existing eroded Floor ROI and all-nine-sample policy can leave them inset
            from the green Floor boundary.
          </p>
        </div>
      ) : null}
      {model.finalPolygon ? (
        <div className="mt-1 grid gap-1 text-[11px] text-slate-400 md:grid-cols-2">
          <p>
            <span className="text-emerald-300">Automatic Floor read — Empty-Room Assist — green</span> ·{" "}
            <span className="text-sky-300">Final AFC geometry — cyan</span>
            {horizonPoints ? (
              <> · <span className="text-violet-300">RAW V3 floor horizon — violet (parent EMPTY)</span></>
            ) : null}
          </p>
          <p>
            Fixed anchor: <span className="text-cyan-200">{model.fixedAnchor ?? "n/a"}</span> ·
            adjusted corner: <span className="text-cyan-200">{model.adjustableCorner ?? "n/a"}</span> ·
            seamT: <span className="text-cyan-200">{model.baselineSeamT?.toFixed(4) ?? "n/a"}</span>
          </p>
        </div>
      ) : null}
      <figure className="mt-2">
        <div
          className="relative w-full overflow-hidden rounded border border-slate-700 bg-black"
          style={{
            aspectRatio: `${dimensions.decodedWidth} / ${dimensions.decodedHeight}`,
          }}
        >
          {/* Attempt-bound exact EMPTY bytes or the already-qualified current Original. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={showOriginal
              ? "Current qualified Original preview with automatic Empty-Room Assist Floor"
              : "Exact EMPTY image analyzed by Empty-Room Assist with automatic Floor"}
            className="absolute inset-0 h-full w-full object-contain"
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {finalPoints ? (
              <polygon
                points={finalPoints}
                fill="#0ea5e9"
                fillOpacity="0.12"
                stroke="#38bdf8"
                strokeWidth="0.6"
                strokeDasharray="1.5 1"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {horizonPoints ? (
              <polyline
                points={horizonPoints}
                fill="none"
                stroke="#c084fc"
                strokeWidth="0.65"
                strokeDasharray="2 1"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {!showOriginal ? supporterSegments.map((segment) => (
              <g key={segment.detectorIndex}>
                <title>
                  detector {segment.detectorIndex} · families {segment.familyIndices.join(", ")}
                </title>
                {segment.familyIndices.map((familyIndex) => (
                  <line
                    key={familyIndex}
                    x1={segment.first.x * 100}
                    y1={segment.first.y * 100}
                    x2={segment.second.x * 100}
                    y2={segment.second.y * 100}
                    stroke={familyColor(familyIndex)}
                    strokeWidth="0.55"
                    strokeOpacity="0.9"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )) : null}
            <polygon
              points={rawPoints}
              fill="#22c55e"
              fillOpacity="0.2"
              stroke="#4ade80"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
            {CORNERS.map((name) => {
              const point = corners[name];
              const x = point.x * 100;
              const y = point.y * 100;
              return (
                <g key={name}>
                  <circle
                    cx={x}
                    cy={y}
                    r="1"
                    fill="#4ade80"
                    stroke="#020617"
                    strokeWidth="0.25"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={x}
                    y={y > 88 ? y - 2 : y + 3}
                    fill="#f8fafc"
                    fontSize="3"
                    stroke="#020617"
                    strokeWidth="0.7"
                    paintOrder="stroke"
                    vectorEffect="non-scaling-stroke"
                  >
                    {name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </figure>
    </section>
  );
}
