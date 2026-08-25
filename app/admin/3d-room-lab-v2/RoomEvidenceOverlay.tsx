"use client";

import type {
  RoomObservationContract,
  SourceNormalizedPoint,
} from "./room-observation-contract";

type Props = Readonly<{
  floorPolygon: readonly SourceNormalizedPoint[];
  roomObservation: RoomObservationContract | null;
  showFloorAuthority: boolean;
  showRoomObservation: boolean;
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
}: Props) {
  const room = showRoomObservation ? roomObservation : null;
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
                points={points(plane.imagePolygon)}
                fill="rgba(167, 139, 250, 0.06)"
                stroke={PLANE_STROKES[plane.category]}
                strokeWidth="0.002"
                strokeDasharray={plane.ambiguity ? "0.008 0.005" : undefined}
                data-evidence-kind="plane"
                data-plane-category={plane.category}
                data-normalized={
                  plane.evidenceClass ===
                    "conservative_normalized_visible_evidence"
                    ? "true"
                    : "false"
                }
              />
            ))}
            {room.observedGridFamilies.flatMap((family) =>
              family.lineSegments.map((segment, index) => (
                <line
                  key={`${family.id}-${index}`}
                  x1={segment.start.x}
                  y1={segment.start.y}
                  x2={segment.end.x}
                  y2={segment.end.y}
                  stroke={family.axis === "axis_b"
                    ? "rgb(34, 197, 94)"
                    : family.axis === "unresolved"
                    ? "rgb(148, 163, 184)"
                    : "rgb(163, 230, 53)"}
                  strokeWidth="0.002"
                  strokeDasharray="0.008 0.005"
                  data-evidence-kind="grid-family"
                  data-grid-axis={family.axis}
                />
              ))
            )}
            {room.observedSeams.map((seam) => (
              <polyline
                key={seam.id}
                points={points(seam.imagePolyline)}
                fill="none"
                stroke={SEAM_STROKES[seam.category]}
                strokeWidth="0.003"
                strokeDasharray={seam.ambiguity ? "0.008 0.005" : undefined}
                data-evidence-kind="seam"
                data-seam-category={seam.category}
              />
            ))}
            {room.observedOpenings.map((opening) => (
              <polygon
                key={opening.id}
                points={points(opening.imageBoundary)}
                fill="rgba(244, 114, 182, 0.08)"
                stroke="rgb(244, 114, 182)"
                strokeWidth="0.003"
                strokeDasharray={opening.ambiguity ? "0.008 0.005" : undefined}
                data-evidence-kind="opening"
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
      {room ? (
        <div
          className="pointer-events-none absolute right-3 top-3 z-30 rounded-md bg-slate-950/80 px-2.5 py-2 text-[10px] leading-4 text-slate-300 backdrop-blur"
          aria-label="Room observation overlay legend"
          data-evidence-role="room-observation-legend"
        >
          <p><span className="text-orange-400">◇</span> visible Floor · <span className="text-cyan-300">◇</span> calibration quad</p>
          <p><span className="text-lime-400">╱</span> grids · <span className="text-amber-400">—</span> floor-wall · <span className="text-red-400">—</span> wall-wall</p>
          <p><span className="text-blue-400">—</span> wall-ceiling · <span className="text-pink-400">◇</span> opening · dashed ambiguous</p>
        </div>
      ) : null}
    </>
  );
}
