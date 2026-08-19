"use client";

import { useEffect, useState } from "react";

import type {
  AfcSr1LiveAuthoritativeGeometry,
} from "./afc-sr1-live-product-contract";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

const CORNERS = ["NL", "NR", "FR", "FL"] as const;

type DiagnosticBasis = "original" | "empty" | "tiled";

export type AfcTiledPerspectiveDiagnosticViewerProps = Readonly<{
  result: AfcSr1LiveAuthoritativeGeometry;
  originalImageUrl: string | null;
  perspectiveAdjustDelta: number | null;
  settleDidNotApply: boolean;
}>;

export function selectAfcTiledPerspectiveDiagnosticBasis(input: Readonly<{
  requested: DiagnosticBasis;
  originalAvailable: boolean;
  emptyAvailable: boolean;
  tiledAvailable: boolean;
}>): DiagnosticBasis | null {
  const available = {
    original: input.originalAvailable,
    empty: input.emptyAvailable,
    tiled: input.tiledAvailable,
  };
  if (available[input.requested]) return input.requested;
  return available.tiled ? "tiled" : available.empty ? "empty" : available.original
    ? "original"
    : null;
}

export function buildAfcTiledPerspectiveDiagnosticViewerModel(
  result: AfcSr1LiveAuthoritativeGeometry
) {
  const tiledPerspective = result.geometry.tiledPerspective;
  const diagnosticImages = result.diagnosticImages;
  if (!tiledPerspective) return null;
  return Object.freeze({
    polygon: result.geometry.sourceNormalizedPolygon,
    originalBasis: result.originalBasis,
    emptyBasis: result.emptyBasis,
    tiledBasis: tiledPerspective.tiledBasis,
    emptyUrl: diagnosticImages?.emptyUrl ?? null,
    tiledUrl: diagnosticImages?.tiledUrl ?? null,
    emptyToOriginal: tiledPerspective.emptyToOriginalCompatibilityTier ===
        "exact_grid_compatible"
      ? "exact-grid"
      : "aspect-rescaled",
    readerVersion: tiledPerspective.readerVersion,
    core: tiledPerspective.core,
    winningTiles: tiledPerspective.selectedComponentTileCount,
    rawQuadrilaterals: tiledPerspective.rawQuadrilateralCount,
    uniqueCells: tiledPerspective.deduplicatedCellCount,
    residualMeanPx: tiledPerspective.reprojectionMeanPx,
    residualMaxPx: tiledPerspective.reprojectionMaxPx,
  });
}

function polygonPoints(polygon: AfcSr1SourcePolygon): string {
  return polygon.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function normalizedCorners(polygon: AfcSr1SourcePolygon): string {
  return polygon.map((point, index) =>
    `${CORNERS[index]} ${point.x.toFixed(3)},${point.y.toFixed(3)}`
  ).join(" · ");
}

function signedDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta.toFixed(3)}`;
}

/**
 * Read-only visualization of one TILED Perspective Reader result across the
 * qualified Original, retained EMPTY, and retained TILED image bases.
 */
export default function AfcTiledPerspectiveDiagnosticViewer({
  result,
  originalImageUrl,
  perspectiveAdjustDelta,
  settleDidNotApply,
}: AfcTiledPerspectiveDiagnosticViewerProps) {
  const model = buildAfcTiledPerspectiveDiagnosticViewerModel(result);
  const [requestedBasis, setRequestedBasis] = useState<DiagnosticBasis>("tiled");
  const [failedImages, setFailedImages] = useState<ReadonlySet<DiagnosticBasis>>(
    () => new Set()
  );

  const originalAvailable = originalImageUrl !== null && !failedImages.has("original");
  const emptyAvailable = Boolean(model?.emptyUrl) && !failedImages.has("empty");
  const tiledAvailable = Boolean(model?.tiledUrl) && !failedImages.has("tiled");
  const basis = selectAfcTiledPerspectiveDiagnosticBasis({
    requested: requestedBasis,
    originalAvailable,
    emptyAvailable,
    tiledAvailable,
  });

  useEffect(() => {
    if (basis !== null && basis !== requestedBasis) setRequestedBasis(basis);
  }, [basis, requestedBasis]);

  if (!model || !basis) {
    return (
      <section className="mt-3 rounded border border-slate-700 bg-slate-950/40 p-2 text-xs text-slate-400">
        Floor Read — TILED Perspective image evidence is unavailable for this attempt.
      </section>
    );
  }

  const image = basis === "original"
    ? { url: originalImageUrl!, basis: model.originalBasis, label: "ORIGINAL" }
    : basis === "empty"
      ? { url: model.emptyUrl ?? "", basis: model.emptyBasis, label: "EMPTY" }
      : { url: model.tiledUrl ?? "", basis: model.tiledBasis, label: "TILED" };
  const points = polygonPoints(model.polygon);
  const adjusted = perspectiveAdjustDelta !== null && perspectiveAdjustDelta !== 0;

  return (
    <section className="mt-3 rounded border border-cyan-900/70 bg-slate-950/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <p className="text-xs font-medium text-cyan-100">
            Floor Read — TILED Perspective
          </p>
          <p className="text-[11px] text-slate-400">
            Authority: TILED. ORIGINAL and EMPTY are basis views only.
          </p>
        </div>
        <div className="ml-auto flex gap-1 text-[11px]">
          {(["original", "empty", "tiled"] as const).map((role) => {
            const available = role === "original"
              ? originalAvailable
              : role === "empty" ? emptyAvailable : tiledAvailable;
            return (
              <button
                key={role}
                type="button"
                disabled={!available}
                onClick={() => setRequestedBasis(role)}
                className={`rounded border px-2 py-0.5 ${
                  basis === role
                    ? "border-cyan-400 text-cyan-100"
                    : "border-slate-700 text-slate-400"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {role.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {image.label} {image.basis.decodedWidth}×{image.basis.decodedHeight} ·
        {" "}exact-grid to EMPTY · {model.emptyToOriginal} to ORIGINAL
      </p>
      {settleDidNotApply ? (
        <p className="mt-1 text-[11px] text-amber-200">
          Reader succeeded. Lab settle did not apply.
        </p>
      ) : null}
      <div className="mt-2 grid gap-x-3 gap-y-1 text-[11px] text-slate-300 md:grid-cols-2">
        <p>Authority: tiled_perspective_reader</p>
        <p>Reader: {model.readerVersion}</p>
        <p>TILED: {model.tiledBasis.decodedWidth}×{model.tiledBasis.decodedHeight}</p>
        <p>
          Core {model.core.rows}×{model.core.columns} · {model.winningTiles} winning tiles ·
          {" "}residual {model.residualMeanPx.toFixed(2)} / {model.residualMaxPx.toFixed(2)} px
        </p>
        <p>Raw quads: {model.rawQuadrilaterals} · Unique cells: {model.uniqueCells}</p>
        <p>TILED↔EMPTY: exact-grid · EMPTY→Original: {model.emptyToOriginal}</p>
        <p className="text-cyan-100">
          Perspective: {adjusted
            ? `Adjusted ${signedDelta(perspectiveAdjustDelta!)}`
            : "Automatic"}
        </p>
        <p className="break-words">{normalizedCorners(model.polygon)}</p>
      </div>
      <figure className="mt-2">
        <div
          className="relative w-full overflow-hidden rounded border border-slate-700 bg-black"
          style={{
            aspectRatio: `${image.basis.decodedWidth} / ${image.basis.decodedHeight}`,
          }}
          data-basis={basis}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={`${image.label} basis with Automatic TILED Perspective Reader quad`}
            className="absolute inset-0 h-full w-full object-contain"
            onError={() => setFailedImages((current) => {
              const next = new Set(current);
              next.add(basis);
              return next;
            })}
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
            data-authoritative-polygon={points}
          >
            <polygon
              points={points}
              fill="#0ea5e9"
              fillOpacity="0.16"
              stroke="#38bdf8"
              strokeWidth="0.65"
              vectorEffect="non-scaling-stroke"
            />
            {CORNERS.map((name, index) => {
              const point = model.polygon[index];
              const x = point.x * 100;
              const y = point.y * 100;
              return (
                <g key={name}>
                  <circle
                    cx={x}
                    cy={y}
                    r="1"
                    fill="#38bdf8"
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
