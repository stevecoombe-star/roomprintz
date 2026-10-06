"use client";

import { useState } from "react";

import { formatAfcDiagnosticMetricNumber } from "@/lib/afc-v2-diagnostics/admin-metric-decision-format";
import {
  MANUAL_PERSPECTIVE_HANDLE_HIT_RADIUS,
  translateManualPerspectiveImagePoints,
  type ManualPerspectiveImagePoints,
} from "@/lib/afc-v2-diagnostics/manual-perspective-geometry";
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
  manualFloor = null,
  onManualPointChange = null,
  onManualQuadChange = null,
}: {
  showFloor: boolean;
  floorPoints: ReadonlyArray<{ x: number; y: number }> | null;
  showCollision: boolean;
  collisionEdges: ReadonlyArray<{
    id: string;
    points: ReadonlyArray<{ x: number; y: number }>;
  }>;
  metricSpan: AfcDiagnosticMetricSpanOverlayModel | null;
  manualFloor?: ReadonlyArray<{ x: number; y: number; label: string }> | null;
  onManualPointChange?: ((label: string, x: number, y: number) => void) | null;
  onManualQuadChange?: ((points: ManualPerspectiveImagePoints) => void) | null;
}) {
  const [groupDragging, setGroupDragging] = useState(false);
  if (!showFloor && !showCollision && !metricSpan && !manualFloor?.length) return null;
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
      {manualFloor && manualFloor.length >= 3 ? (
        <g data-evidence-role="manual-perspective">
          <polygon
            points={polygonPoints(manualFloor)}
            fill="rgba(251, 191, 36, 0.16)"
            stroke="#fbbf24"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: "none" }}
          />
          {onManualQuadChange ? (
            <polygon
              data-evidence-role="manual-perspective-body"
              points={polygonPoints(manualFloor)}
              fill="transparent"
              stroke="transparent"
              strokeWidth={8}
              vectorEffect="non-scaling-stroke"
              style={{
                pointerEvents: "auto",
                cursor: groupDragging ? "grabbing" : "grab",
              }}
              onPointerDown={(event) => {
                const svg = event.currentTarget.ownerSVGElement;
                const start = imagePointsFromManualFloor(manualFloor);
                if (!svg || !start) return;
                const origin = svgNormalizedPoint(svg, event.clientX, event.clientY);
                if (!origin) return;
                event.preventDefault();
                event.stopPropagation();
                const previousCursor = document.body.style.cursor;
                document.body.style.cursor = "grabbing";
                setGroupDragging(true);
                const move = (pointer: PointerEvent) => {
                  const next = svgNormalizedPoint(svg, pointer.clientX, pointer.clientY);
                  if (!next) return;
                  onManualQuadChange(translateManualPerspectiveImagePoints(
                    start,
                    next.x - origin.x,
                    next.y - origin.y,
                  ));
                };
                const end = () => {
                  document.body.style.cursor = previousCursor;
                  setGroupDragging(false);
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", end);
                  window.removeEventListener("pointercancel", end);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", end);
                window.addEventListener("pointercancel", end);
              }}
            />
          ) : null}
          {manualFloor.map((point) => (
            <g key={point.label}>
              <circle
                cx={point.x}
                cy={point.y}
                r={MANUAL_PERSPECTIVE_HANDLE_HIT_RADIUS}
                fill="transparent"
                style={onManualPointChange ? {
                  pointerEvents: "auto",
                  cursor: groupDragging ? "grabbing" : "grab",
                } : undefined}
                onPointerDown={onManualPointChange
                  ? (event) => {
                    const svg = event.currentTarget.ownerSVGElement;
                    if (!svg) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const move = (pointer: PointerEvent) => {
                      const next = svgNormalizedPoint(svg, pointer.clientX, pointer.clientY);
                      if (next) onManualPointChange(point.label, next.x, next.y);
                    };
                    const end = () => {
                      window.removeEventListener("pointermove", move);
                      window.removeEventListener("pointerup", end);
                    };
                    window.addEventListener("pointermove", move);
                    window.addEventListener("pointerup", end);
                  }
                  : undefined}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r="0.012"
                fill="#fbbf24"
                stroke="rgb(15, 23, 42)"
                strokeWidth="0.002"
              />
              <text
                x={point.x}
                y={point.y - 0.02}
                fill="rgb(254, 243, 199)"
                fontSize="0.028"
                textAnchor="middle"
              >
                {point.label}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  );
}

function imagePointsFromManualFloor(
  points: ReadonlyArray<{ x: number; y: number; label: string }>,
): ManualPerspectiveImagePoints | null {
  const found = new Map(points.map((point) => [point.label, point]));
  const next: Partial<Record<"NL" | "NR" | "FR" | "FL", { x: number; y: number }>> = {};
  for (const corner of ["NL", "NR", "FR", "FL"] as const) {
    const point = found.get(corner);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    next[corner] = { x: point.x, y: point.y };
  }
  if (!next.NL || !next.NR || !next.FR || !next.FL) return null;
  return { NL: next.NL, NR: next.NR, FR: next.FR, FL: next.FL };
}

function svgNormalizedPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(matrix.inverse());
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return null;
  return { x: local.x, y: local.y };
}
