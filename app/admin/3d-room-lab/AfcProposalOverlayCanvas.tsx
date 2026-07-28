"use client";

import type { AfcProposalOverlayControls } from "./afc-proposal-overlay-state";
import { polygonPoints } from "./afc-proposal-overlay-state";
import type { AfcProposalOverlayViewModel } from "./research/afc-proposal-overlay-view-model";

type AfcProposalOverlayCanvasProps = Readonly<{
  viewModel: AfcProposalOverlayViewModel;
  verifiedImageUrl: string;
  imageRole: "original" | "empty";
  imageRequestGeneration: number;
  controls: AfcProposalOverlayControls;
  onImageError: (generation: number) => void;
  onImageLoad: (generation: number, dimensionsMatch: boolean) => void;
}>;

const CORNERS = ["NL", "NR", "FR", "FL"] as const;

/** Presentational only: no callbacks, pointer handlers, lab state, or setters. */
export default function AfcProposalOverlayCanvas({
  viewModel,
  verifiedImageUrl,
  imageRole,
  imageRequestGeneration,
  controls,
  onImageError,
  onImageLoad,
}: AfcProposalOverlayCanvasProps) {
  const width = imageRole === "original" ? viewModel.imageBasis.original.width : viewModel.imageBasis.emptyRoom.width;
  const height = imageRole === "original" ? viewModel.imageBasis.original.height : viewModel.imageBasis.emptyRoom.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const points = polygonPoints(viewModel);
  return (
    <figure className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
        style={{ aspectRatio: `${width} / ${height}` }}
        aria-label={`Verified ${imageRole === "original" ? "Original" : "Empty"} image with read-only AFC proposal overlay`}
      >
        {/* The route serves immutable verified bytes and must not be optimized or rewritten. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={verifiedImageUrl}
          alt={`Verified ${imageRole === "original" ? "Original" : "Empty Room"} evidence image`}
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => onImageError(imageRequestGeneration)}
          onLoad={(event) => onImageLoad(imageRequestGeneration, event.currentTarget.naturalWidth === width && event.currentTarget.naturalHeight === height)}
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {controls.showFill ? <polygon points={points} fill="#22c55e" fillOpacity={controls.opacity} /> : null}
          {controls.showStroke ? <polygon points={points} fill="none" stroke="#4ade80" strokeWidth="0.5" vectorEffect="non-scaling-stroke" /> : null}
          {CORNERS.map((name) => {
            const corner = viewModel.corners[name];
            const x = corner.x * 100;
            const y = corner.y * 100;
            const labels = [
              controls.showCornerNames ? name : "",
              controls.showNormalizedCoordinates ? `${corner.x.toFixed(2)}, ${corner.y.toFixed(2)}` : "",
              controls.showSupportLabels ? corner.support : "",
            ].filter(Boolean);
            return (
              <g key={name}>
                {controls.showCornerMarkers ? <circle cx={x} cy={y} r="1" fill="#facc15" stroke="#0f172a" strokeWidth="0.25" vectorEffect="non-scaling-stroke" /> : null}
                {labels.length ? (
                  <text x={x} y={y > 88 ? y - 2 : y + 3} fill="#f8fafc" fontSize="3" stroke="#020617" strokeWidth="0.7" paintOrder="stroke" vectorEffect="non-scaling-stroke">
                    {labels.join(" · ")}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="text-[11px] text-slate-400">
        Source-normalized AFC coordinates map directly into this verified intrinsic-aspect image canvas. The overlay is decorative and pointer-transparent.
      </figcaption>
    </figure>
  );
}
