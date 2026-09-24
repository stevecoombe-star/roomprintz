"use client";

import { formatAfcDiagnosticMetricNumber } from "@/lib/afc-v2-diagnostics/admin-metric-decision-format";
import {
  metricSpanViewBoxPoint,
  type AfcDiagnosticMetricSpanOverlayModel,
} from "@/lib/afc-v2-diagnostics/admin-metric-span-overlay";

const TRUSTED_STROKE = "rgb(34, 211, 238)";
const UNAVAILABLE_STROKE = "rgb(148, 163, 184)";

/**
 * Selected metric span in the same normalized SVG space as the Lab overlay.
 * Trust changes line style and the status label. Endpoints are not recomputed.
 */
export default function AfcDiagnosticMetricSpanOverlay({
  span,
}: {
  span: AfcDiagnosticMetricSpanOverlayModel;
}) {
  const imageA = metricSpanViewBoxPoint(span.imageA);
  const imageB = metricSpanViewBoxPoint(span.imageB);
  const solid = span.lineStyle === "solid";
  const dashed = span.lineStyle === "dashed";
  const stroke = solid || dashed ? TRUSTED_STROKE : UNAVAILABLE_STROKE;
  const dash = solid ? undefined : dashed ? "0.02 0.012" : "0.006 0.006";
  const label = span.statusLabel;
  const midX = (imageA.x + imageB.x) / 2;
  const midY = (imageA.y + imageB.y) / 2;

  return (
    <g
      data-evidence-role="metric-span"
      data-source-path={span.sourcePath}
      data-line-style={span.lineStyle}
      data-image-space={span.imageSpace}
      data-span-id={span.spanId}
    >
      <line
        x1={imageA.x}
        y1={imageA.y}
        x2={imageB.x}
        y2={imageB.y}
        stroke={stroke}
        strokeWidth="0.005"
        strokeLinecap="round"
        strokeDasharray={dash}
        data-evidence-kind="metric-span-segment"
      />
      <circle
        cx={imageA.x}
        cy={imageA.y}
        r="0.009"
        fill={stroke}
        stroke="rgb(15, 23, 42)"
        strokeWidth="0.0015"
        data-evidence-kind="metric-span-endpoint-a"
      />
      <text
        x={imageA.x}
        y={imageA.y - 0.016}
        fill="rgb(207, 250, 254)"
        fontSize="0.024"
        textAnchor="middle"
        data-evidence-kind="metric-span-endpoint-a-label"
      >
        A
      </text>
      <circle
        cx={imageB.x}
        cy={imageB.y}
        r="0.009"
        fill={stroke}
        stroke="rgb(15, 23, 42)"
        strokeWidth="0.0015"
        data-evidence-kind="metric-span-endpoint-b"
      />
      <text
        x={imageB.x}
        y={imageB.y - 0.016}
        fill="rgb(207, 250, 254)"
        fontSize="0.024"
        textAnchor="middle"
        data-evidence-kind="metric-span-endpoint-b-label"
      >
        B
      </text>
      <text
        x={midX}
        y={midY - 0.018}
        fill="rgb(207, 250, 254)"
        fontSize="0.022"
        textAnchor="middle"
        data-evidence-kind="metric-span-label"
      >
        {label}
      </text>
    </g>
  );
}

export function AfcDiagnosticMetricSpanContext({
  span,
}: {
  span: AfcDiagnosticMetricSpanOverlayModel;
}) {
  return (
    <span
      className="mt-1 block text-xs text-slate-300"
      data-testid="afc-metric-span-context"
    >
      <span data-testid="afc-metric-span-status">
        {span.statusLabel}
      </span>
      <span className="mt-0.5 block font-mono text-slate-400">
        {span.spanId}
      </span>
      <span className="mt-0.5 block text-slate-500">
        {span.role}
        {" · "}
        {formatAfcDiagnosticMetricNumber(span.canonicalLength)}
      </span>
      {span.lineStyle !== "solid" && span.reasonCodes.length > 0 ? (
        <span
          className="mt-0.5 block font-mono text-slate-400"
          data-testid="afc-metric-span-reasons"
        >
          {span.reasonCodes.join(", ")}
        </span>
      ) : null}
    </span>
  );
}

function polygonPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function AfcDiagnosticEvidenceOverlaySvg({
  showFloor,
  floorPoints,
  showCollision,
  collisionEdges,
  metricSpan,
}: {
  showFloor: boolean;
  floorPoints: ReadonlyArray<{ x: number; y: number }> | null;
  showCollision: boolean;
  collisionEdges: ReadonlyArray<{
    id: string;
    points: ReadonlyArray<{ x: number; y: number }>;
  }>;
  metricSpan: AfcDiagnosticMetricSpanOverlayModel | null;
}) {
  if (!showFloor && !showCollision && !metricSpan) return null;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      {showFloor && floorPoints ? (
        <polygon
          points={polygonPoints(floorPoints)}
          fill="rgba(125, 211, 252, 0.12)"
          stroke="#7dd3fc"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {showCollision
        ? collisionEdges.map((edge) => (
            <polyline
              key={edge.id}
              points={polygonPoints(edge.points)}
              fill="none"
              stroke="#fcd34d"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))
        : null}
      {metricSpan ? <AfcDiagnosticMetricSpanOverlay span={metricSpan} /> : null}
    </svg>
  );
}
