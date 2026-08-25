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

/**
 * Read-only image-space diagnostics. The cyan Floor is authoritative upstream;
 * all other primitives are provider-reported room-observation evidence.
 */
export default function RoomEvidenceOverlay({
  floorPolygon,
  roomObservation,
  showFloorAuthority,
  showRoomObservation,
}: Props) {
  const room = showRoomObservation ? roomObservation : null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 size-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label="Room evidence overlays"
    >
      {room ? (
        <g
          aria-label="Provider-reported room observation evidence"
          data-evidence-role="diagnostic-room-observation"
        >
          {room.observedPlanes.map((plane) => (
            <polygon
              key={plane.id}
              points={points(plane.imagePolygon)}
              fill="rgba(167, 139, 250, 0.08)"
              stroke="rgba(196, 181, 253, 0.72)"
              strokeWidth="0.002"
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
                stroke="rgb(163, 230, 53)"
                strokeWidth="0.002"
                strokeDasharray="0.008 0.005"
              />
            ))
          )}
          {room.observedSeams.map((seam) => (
            <polyline
              key={seam.id}
              points={points(seam.imagePolyline)}
              fill="none"
              stroke="rgb(251, 191, 36)"
              strokeWidth="0.003"
            />
          ))}
          {room.observedOpenings.map((opening) => (
            <polygon
              key={opening.id}
              points={points(opening.imageBoundary)}
              fill="rgba(244, 114, 182, 0.08)"
              stroke="rgb(244, 114, 182)"
              strokeWidth="0.003"
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
  );
}
