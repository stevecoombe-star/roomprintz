"use client";

import type {
  EmptyRoomObservationEvidence,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";

type Props = Readonly<{
  floorPolygon: readonly SourceNormalizedPoint[];
  roomObservation: EmptyRoomObservationEvidence | null;
  showFloorAuthority: boolean;
  showRoomObservation: boolean;
  showObservationLegend?: boolean;
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
              />
            ))}
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
        </div>
      ) : null}
    </>
  );
}
