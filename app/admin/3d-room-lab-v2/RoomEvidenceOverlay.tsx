"use client";

import type {
  EmptyRoomObservationEvidence,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import type { RoomBoundaryCandidateStatus } from "./room-boundary-authority-contract";
import type { EmptyOriginalRegistrationCorrespondence } from "./empty-original-registration-authority-contract";
import type { OriginalLocalizedStructure } from "./original-structural-localization-authority-contract";
import {
  metricCorrespondenceSpanLabel,
  type MetricCorrespondenceSpan,
} from "./metric-correspondence-span-contract";

function perpendicular(tangent: Readonly<{ u: number; v: number }>): Readonly<{ u: number; v: number }> {
  const length = Math.hypot(tangent.u, tangent.v);
  if (!(length > 1e-18)) return { u: 1, v: 0 };
  return { u: -tangent.v / length, v: tangent.u / length };
}

type Props = Readonly<{
  floorPolygon: readonly SourceNormalizedPoint[];
  roomObservation: EmptyRoomObservationEvidence | null;
  showFloorAuthority: boolean;
  showRoomObservation: boolean;
  showObservationLegend?: boolean;
  floorWallBoundaryStatusBySeamId?: Readonly<
    Record<string, RoomBoundaryCandidateStatus>
  >;
  registrationCorrespondences?: readonly EmptyOriginalRegistrationCorrespondence[];
  overlaySpace?: "empty" | "original" | "none";
  originalLocalizationStructures?: readonly OriginalLocalizedStructure[];
  metricCorrespondenceSpan?: MetricCorrespondenceSpan | null;
}>;

function points(value: readonly SourceNormalizedPoint[]): string {
  return value.map((point) => `${point.x},${point.y}`).join(" ");
}

const PLANE_STROKES = {
  floor: "rgb(251, 146, 60)",
  wall: "rgb(196, 181, 253)",
  ceiling: "rgb(125, 211, 252)",
  unknown: "rgb(148, 163, 184)",
} as const;

const SEAM_STROKES = {
  floor_wall: "rgb(251, 191, 36)",
  wall_wall: "rgb(248, 113, 113)",
  wall_ceiling: "rgb(96, 165, 250)",
  unknown: "rgb(148, 163, 184)",
} as const;

const BOUNDARY_STATUS_STROKES = {
  accepted: "rgb(52, 211, 153)",
  ambiguous: "rgb(250, 204, 21)",
  insufficient: "rgb(148, 163, 184)",
  rejected: "rgb(251, 113, 133)",
} as const;

/**
 * Read-only image-space diagnostics. The cyan Floor is authoritative upstream;
 * all other primitives are normalized visible room-observation evidence.
 */
export default function RoomEvidenceOverlay({
  floorPolygon,
  roomObservation,
  showFloorAuthority,
  showRoomObservation,
  showObservationLegend = true,
  floorWallBoundaryStatusBySeamId = {},
  registrationCorrespondences = [],
  overlaySpace = "none",
  originalLocalizationStructures = [],
  metricCorrespondenceSpan = null,
}: Props) {
  const room = showRoomObservation &&
      roomObservation?.observerStatus !== "failed"
    ? roomObservation
    : null;
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-20 size-full"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        aria-label="Room evidence overlays"
      >
        {room ? (
          <g
            aria-label="Normalized room observation evidence"
            data-evidence-role="diagnostic-room-observation"
          >
            {room.observedPlanes.map((plane) => (
              <polygon
                key={plane.id}
                points={points(plane.sourceNormalizedPolygon)}
                fill="rgba(167, 139, 250, 0.06)"
                stroke={PLANE_STROKES[plane.category]}
                strokeWidth="0.0015"
                strokeOpacity="0.45"
                strokeDasharray="0.006 0.005"
                data-evidence-kind="plane"
                data-evidence-role="visible-plane-extent-not-seam"
                data-plane-category={plane.category}
                data-region-role={plane.regionRole}
              />
            ))}
            {room.observedSeams.map((seam) => (
              <polyline
                key={seam.id}
                points={points(seam.sourceNormalizedPolyline)}
                fill="none"
                stroke={SEAM_STROKES[seam.category]}
                strokeWidth="0.0035"
                strokeDasharray={seam.ambiguity ? "0.008 0.005" : undefined}
                data-evidence-kind="seam"
                data-evidence-role="explicit-observed-architectural-seam"
                data-seam-category={seam.category}
                data-boundary-status={
                  seam.category === "floor_wall"
                    ? floorWallBoundaryStatusBySeamId[seam.id]
                    : undefined
                }
              />
            ))}
            {room.observedSeams
              .filter((seam) =>
                seam.category === "floor_wall" &&
                floorWallBoundaryStatusBySeamId[seam.id]
              )
              .map((seam) => {
                const status = floorWallBoundaryStatusBySeamId[seam.id]!;
                const start = seam.sourceNormalizedPolyline[0];
                const end = seam.sourceNormalizedPolyline[
                  seam.sourceNormalizedPolyline.length - 1
                ];
                return (
                  <g
                    key={`boundary-${seam.id}`}
                    data-evidence-role="s4a-room-boundary-status"
                    data-boundary-status={status}
                    data-source-seam-id={seam.id}
                  >
                    <circle
                      cx={start.x}
                      cy={start.y}
                      r="0.007"
                      fill={BOUNDARY_STATUS_STROKES[status]}
                      fillOpacity="0.9"
                      stroke="rgb(15, 23, 42)"
                      strokeWidth="0.0015"
                    />
                    <circle
                      cx={end.x}
                      cy={end.y}
                      r="0.007"
                      fill={BOUNDARY_STATUS_STROKES[status]}
                      fillOpacity="0.9"
                      stroke="rgb(15, 23, 42)"
                      strokeWidth="0.0015"
                    />
                  </g>
                );
              })}
            {room.observedOpenings.map((opening) =>
              opening.boundaryClosure === "complete_visible_outline" ? (
                <polygon
                  key={opening.id}
                  points={points(opening.sourceNormalizedBoundary)}
                  fill="rgba(244, 114, 182, 0.08)"
                  stroke="rgb(244, 114, 182)"
                  strokeWidth="0.003"
                  strokeDasharray={opening.ambiguity
                    ? "0.008 0.005"
                    : undefined}
                  data-evidence-kind="opening"
                />
              ) : (
                <polyline
                  key={opening.id}
                  points={points(opening.sourceNormalizedBoundary)}
                  fill="none"
                  stroke="rgb(244, 114, 182)"
                  strokeWidth="0.003"
                  strokeDasharray="0.008 0.005"
                  data-evidence-kind="opening"
                />
              )
            )}
            {room.observedJunctions.map((junction) => (
              <circle
                key={junction.id}
                cx={junction.sourceNormalizedPoint.x}
                cy={junction.sourceNormalizedPoint.y}
                r="0.005"
                fill="rgb(250, 204, 21)"
                stroke="rgb(15, 23, 42)"
                strokeWidth="0.0015"
                data-evidence-kind="junction"
                data-junction-category={junction.category}
              />
            ))}
          </g>
        ) : null}
        {registrationCorrespondences.length > 0 ? (
          <g
            aria-label="EMPTY to ORIGINAL registration correspondences"
            data-evidence-role="s4c-registration-correspondences"
          >
            {registrationCorrespondences.map((item) => {
              const stroke = item.status === "contradiction"
                ? "rgb(251, 113, 133)"
                : item.status === "ambiguous"
                ? "rgb(250, 204, 21)"
                : item.inlier
                ? "rgb(45, 212, 191)"
                : "rgb(148, 163, 184)";
              if (item.kind === "ridge_normal") {
                const tangent = item.emptyLine?.direction ?? { u: 1, v: 0 };
                const normal = perpendicular(tangent);
                const tick = 0.018;
                const signed = item.ridgeResidual?.normal ?? 0;
                const tickSign = signed === 0 ? 1 : Math.sign(signed);
                return (
                  <g
                    key={item.priorId}
                    data-evidence-kind="registration-ridge-normal"
                    data-evidence-status={item.status}
                  >
                    <rect
                      x={item.empty.u - 0.004}
                      y={item.empty.v - 0.004}
                      width="0.008"
                      height="0.008"
                      fill={stroke}
                      fillOpacity="0.9"
                      stroke="rgb(15, 23, 42)"
                      strokeWidth="0.0012"
                      data-evidence-kind="registration-empty-ridge"
                    />
                    <line
                      x1={item.empty.u}
                      y1={item.empty.v}
                      x2={item.empty.u + normal.u * tick * tickSign}
                      y2={item.empty.v + normal.v * tick * tickSign}
                      stroke={stroke}
                      strokeWidth="0.002"
                      strokeOpacity="0.85"
                      data-evidence-kind="registration-ridge-normal-tick"
                    />
                    {item.originalLine ? (
                      <line
                        x1={item.originalLine.origin.u - item.originalLine.direction.u * 0.03}
                        y1={item.originalLine.origin.v - item.originalLine.direction.v * 0.03}
                        x2={item.originalLine.origin.u + item.originalLine.direction.u * 0.03}
                        y2={item.originalLine.origin.v + item.originalLine.direction.v * 0.03}
                        stroke={stroke}
                        strokeWidth="0.0025"
                        strokeOpacity="0.7"
                        data-evidence-kind="registration-ridge-original-line"
                      />
                    ) : null}
                  </g>
                );
              }
              return (
                <g
                  key={item.priorId}
                  data-evidence-kind="registration-point-anchor"
                  data-evidence-status={item.status}
                >
                  <circle
                    cx={item.empty.u}
                    cy={item.empty.v}
                    r="0.006"
                    fill={stroke}
                    fillOpacity="0.9"
                    stroke="rgb(15, 23, 42)"
                    strokeWidth="0.0012"
                    data-evidence-kind="registration-empty"
                  />
                  {item.original ? (
                    <line
                      x1={item.empty.u}
                      y1={item.empty.v}
                      x2={item.original.u}
                      y2={item.original.v}
                      stroke={stroke}
                      strokeWidth="0.0015"
                      strokeOpacity="0.7"
                      data-evidence-kind="registration-residual"
                    />
                  ) : null}
                  {item.original ? (
                    <circle
                      cx={item.original.u}
                      cy={item.original.v}
                      r="0.0035"
                      fill="none"
                      stroke={stroke}
                      strokeWidth="0.0012"
                      data-evidence-kind="registration-original-anchor"
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        ) : null}
        {overlaySpace === "original" && originalLocalizationStructures.length > 0 ? (
          <g
            aria-label="ORIGINAL structural localization"
            data-evidence-role="s4c0-ol-original-localization"
          >
            {originalLocalizationStructures.map((item) => {
              const stroke = item.status === "localized"
                ? "rgb(167, 139, 250)"
                : item.status === "ambiguous"
                ? "rgb(250, 204, 21)"
                : item.status === "rejected"
                ? "rgb(251, 113, 133)"
                : "rgb(148, 163, 184)";
              const polyline = item.originalEvidence.polyline;
              const point = item.originalEvidence.point;
              return (
                <g
                  key={item.id}
                  data-evidence-kind="ol-structure"
                  data-evidence-status={item.status}
                  data-localization-class={item.localizationClass}
                >
                  {polyline && polyline.length >= 2 ? (
                    <polyline
                      points={points(polyline.map((vertex) => ({ x: vertex.x, y: vertex.y })))}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={item.status === "localized" ? "0.004" : "0.0025"}
                      strokeDasharray={item.status === "localized" ? undefined : "0.008 0.005"}
                      data-evidence-kind="ol-original-floor-wall"
                    />
                  ) : null}
                  {point ? (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r="0.006"
                      fill={item.status === "localized" ? stroke : "none"}
                      stroke={stroke}
                      strokeWidth="0.0015"
                      data-evidence-kind="ol-original-anchor"
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        ) : null}
        {overlaySpace === "original" &&
            metricCorrespondenceSpan &&
            metricCorrespondenceSpan.overlaySafeOnOriginal ? (
          <g
            aria-label="Metric correspondence span"
            data-evidence-role="metric-correspondence-span"
            data-span-role={metricCorrespondenceSpan.role}
            data-source-seam-id={
              metricCorrespondenceSpan.lineage.sourceSeamId ?? undefined
            }
            data-span-trust={metricCorrespondenceSpan.spanTrust}
            data-correspondence-source={
              metricCorrespondenceSpan.correspondenceSource
            }
          >
            <line
              x1={metricCorrespondenceSpan.imageA.x}
              y1={metricCorrespondenceSpan.imageA.y}
              x2={metricCorrespondenceSpan.imageB.x}
              y2={metricCorrespondenceSpan.imageB.y}
              stroke="rgb(34, 211, 238)"
              strokeWidth="0.005"
              strokeLinecap="round"
              data-evidence-kind="metric-correspondence-segment"
            />
            <circle
              cx={metricCorrespondenceSpan.imageA.x}
              cy={metricCorrespondenceSpan.imageA.y}
              r="0.009"
              fill="rgb(34, 211, 238)"
              stroke="rgb(15, 23, 42)"
              strokeWidth="0.0015"
              data-evidence-kind="metric-correspondence-endpoint-a"
            />
            <text
              x={metricCorrespondenceSpan.imageA.x}
              y={metricCorrespondenceSpan.imageA.y - 0.016}
              fill="rgb(207, 250, 254)"
              fontSize="0.024"
              textAnchor="middle"
              data-evidence-kind="metric-correspondence-endpoint-a-label"
            >
              A
            </text>
            <circle
              cx={metricCorrespondenceSpan.imageB.x}
              cy={metricCorrespondenceSpan.imageB.y}
              r="0.009"
              fill="rgb(34, 211, 238)"
              stroke="rgb(15, 23, 42)"
              strokeWidth="0.0015"
              data-evidence-kind="metric-correspondence-endpoint-b"
            />
            <text
              x={metricCorrespondenceSpan.imageB.x}
              y={metricCorrespondenceSpan.imageB.y - 0.016}
              fill="rgb(207, 250, 254)"
              fontSize="0.024"
              textAnchor="middle"
              data-evidence-kind="metric-correspondence-endpoint-b-label"
            >
              B
            </text>
            <text
              x={(metricCorrespondenceSpan.imageA.x + metricCorrespondenceSpan.imageB.x) / 2}
              y={(metricCorrespondenceSpan.imageA.y + metricCorrespondenceSpan.imageB.y) / 2 - 0.018}
              fill="rgb(207, 250, 254)"
              fontSize="0.028"
              textAnchor="middle"
              data-evidence-kind="metric-correspondence-label"
            >
              {metricCorrespondenceSpanLabel(metricCorrespondenceSpan)}
            </text>
          </g>
        ) : null}
        {showFloorAuthority ? (
          <polygon
            points={points(floorPolygon)}
            fill="rgba(34, 211, 238, 0.13)"
            stroke="rgb(103, 232, 249)"
            strokeWidth="0.004"
            aria-label="Authoritative Floor quad"
            data-evidence-role="authoritative-floor"
          />
        ) : null}
      </svg>
      {room && showObservationLegend ? (
        <div
          className="pointer-events-none absolute right-3 top-3 z-30 rounded-md bg-slate-950/80 px-2.5 py-2 text-[10px] leading-4 text-slate-300 backdrop-blur"
          aria-label="Room observation overlay legend"
          data-evidence-role="room-observation-legend"
        >
          <p className="font-semibold text-slate-100">
            EMPTY · observation only
          </p>
          <p><span className="text-orange-400">◇</span> visible floor region · <span className="text-amber-400">—</span> floor-wall · <span className="text-red-400">—</span> wall-wall</p>
          <p><span className="text-blue-400">—</span> wall-ceiling · <span className="text-pink-400">◇</span> opening · <span className="text-yellow-300">●</span> junction</p>
          <p className="text-slate-500">
            faint dashed = plane extent · solid = explicit seam
          </p>
          <p className="text-slate-500">Not Floor or Camera authority</p>
          {registrationCorrespondences.length > 0 ? (
            <p className="mt-1 text-slate-400">
              Registration: <span className="text-teal-300">●</span> point anchor
              {" · "}
              <span className="text-teal-300">■</span> ridge-normal tick
            </p>
          ) : null}
          {originalLocalizationStructures.length > 0 ? (
            <p className="mt-1 text-violet-300">
              ORIGINAL localization: <span className="text-violet-300">—</span> localized
              {" · "}
              <span className="text-yellow-300">ambiguous</span>
              {" · "}
              <span className="text-slate-400">no-match</span>
            </p>
          ) : null}
          {Object.keys(floorWallBoundaryStatusBySeamId).length > 0 ? (
            <p className="mt-1 text-slate-400">
              S4A floor-wall endpoints:
              {" "}
              <span className="text-emerald-400">accepted</span>
              {" · "}
              <span className="text-yellow-300">ambiguous</span>
              {" · "}
              <span className="text-slate-400">insufficient</span>
              {" · "}
              <span className="text-rose-400">rejected</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
