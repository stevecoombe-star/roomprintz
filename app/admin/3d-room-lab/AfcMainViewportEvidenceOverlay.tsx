"use client";

import { AFC_VIEWPORT_CORNER_ORDER, type AfcMainViewportProjection } from "./afc-main-viewport-evidence";

type AfcMainViewportEvidenceOverlayProps = Readonly<{
  projection: AfcMainViewportProjection;
}>;

/** Purely presentational, pointer-transparent AFC evidence layer. It receives no authority or interaction path. */
export default function AfcMainViewportEvidenceOverlay({
  projection,
}: AfcMainViewportEvidenceOverlayProps) {
  const { display } = projection;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-40 h-full w-full select-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {display.showFill ? (
        <polygon
          points={projection.polygonPointsAttribute}
          fill="#22c55e"
          fillOpacity={display.opacity * 0.4}
          pointerEvents="none"
        />
      ) : null}
      {display.showStroke ? (
        <polygon
          points={projection.polygonPointsAttribute}
          fill="none"
          stroke="#34d399"
          strokeOpacity={Math.max(0.45, display.opacity)}
          strokeWidth="0.85"
          strokeDasharray="2.1 1.25"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}
      {AFC_VIEWPORT_CORNER_ORDER.map((name) => {
        const corner = projection.corners[name];
        if (!corner.visibleInFrame) return null;
        return (
          <g key={name} pointerEvents="none">
            {display.showMarkers ? (
              <circle
                cx={corner.x * 100}
                cy={corner.y * 100}
                r="0.95"
                fill="#34d399"
                stroke="#052e16"
                strokeWidth="0.38"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {display.showLabels ? (
              <text
                x={corner.x * 100 + 1.25}
                y={corner.y * 100 - 1.05}
                fill="#ecfdf5"
                fontSize="2.2"
                fontWeight="600"
                stroke="#052e16"
                strokeWidth="0.72"
                paintOrder="stroke"
                vectorEffect="non-scaling-stroke"
              >
                {name}
              </text>
            ) : null}
          </g>
        );
      })}
      <g pointerEvents="none">
        <rect x="1.4" y="1.4" width="42" height="5.4" rx="0.9" fill="#052e16" fillOpacity="0.82" />
        <text x="2.6" y="4.95" fill="#d1fae5" fontSize="2.05" fontWeight="600">
          AFC evidence — read-only
        </text>
        {projection.offFrameCornerCount > 0 ? (
          <text x="2.6" y="7.9" fill="#a7f3d0" fontSize="1.65">
            {projection.viewportBadgeText.replace("AFC evidence — read-only · ", "")}
          </text>
        ) : null}
      </g>
    </svg>
  );
}
