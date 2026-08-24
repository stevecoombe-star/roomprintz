"use client";

import { useState } from "react";

import type { VisibleFloorTerminationFragment } from "../empty-visible-floor-contact-localizer";
import {
  P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS,
  P2_S2D_ROOM_C_REVIEW_NEIGHBORHOODS,
  p2S2DFloorContactPointerToSourcePixel,
  p2S2DFloorContactPolyline,
  p2S2DFloorContactShortId,
  type P2S2DFloorContactReviewRecord,
  type P2S2DFloorContactReviewRoomId,
} from "../p2-s2d-floor-contact-overlay-review";

type Props = Readonly<{
  records: Readonly<
    Record<P2S2DFloorContactReviewRoomId, P2S2DFloorContactReviewRecord>
  >;
}>;

function Toggle({
  checked,
  color,
  label,
  onChange,
}: Readonly<{
  checked: boolean;
  color: string;
  label: string;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
      <span className="h-2.5 w-5 rounded" style={{ backgroundColor: color }} />
      {label}
    </label>
  );
}

function Row({
  label,
  value,
}: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-slate-800 py-1.5 text-xs">
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all font-mono text-slate-100">{value}</dd>
    </div>
  );
}

function Inspector({
  fragment,
}: Readonly<{ fragment: VisibleFloorTerminationFragment | null }>) {
  if (!fragment) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">New-fragment evidence</h2>
        <p className="mt-2 text-sm text-slate-400">
          Select a magenta P2-S2D fragment.
        </p>
      </section>
    );
  }
  const evidence = fragment.evidence;
  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <h2 className="font-semibold">New-fragment evidence</h2>
      <dl className="mt-2">
        <Row label="Fragment ID" value={fragment.id} />
        <Row label="Geometry" value={fragment.geometryKind} />
        <Row label="Start endpoint" value={fragment.startEndpoint.state} />
        <Row label="End endpoint" value={fragment.endEndpoint.state} />
        <Row label="Interior rule" value={evidence.interiorSupportRule} />
        <Row label="Outward rule" value={evidence.outwardDirectionRule} />
        <Row label="Transition rule" value={evidence.transitionRule} />
        <Row label="Length px" value={evidence.sourcePixelLength.toFixed(3)} />
        <Row label="Contact samples" value={evidence.contactSampleCount} />
        <Row
          label="Mean search px"
          value={evidence.meanSearchDistancePx.toFixed(3)}
        />
        <Row
          label="Trusted inside"
          value={evidence.meanInsideRegionSupportFraction.toFixed(3)}
        />
        <Row
          label="Trusted outside"
          value={evidence.meanOutsideRegionExclusionFraction.toFixed(3)}
        />
        <Row
          label="Raw-mask inside"
          value={evidence.meanInsideRawMaskSupportFraction.toFixed(3)}
        />
        <Row
          label="Raw-mask outside"
          value={evidence.meanOutsideRawMaskExclusionFraction.toFixed(3)}
        />
        <Row
          label="Core origin start"
          value={`${evidence.coreOriginStartSourcePx.x.toFixed(1)}, ${evidence.coreOriginStartSourcePx.y.toFixed(1)}`}
        />
        <Row
          label="Core origin end"
          value={`${evidence.coreOriginEndSourcePx.x.toFixed(1)}, ${evidence.coreOriginEndSourcePx.y.toFixed(1)}`}
        />
        <Row
          label="Mean outward normal"
          value={`${evidence.meanOutwardNormal.x.toFixed(3)}, ${evidence.meanOutwardNormal.y.toFixed(3)}`}
        />
        <Row
          label="Mean RGB transition"
          value={evidence.meanTransitionRgbDistance.toFixed(3)}
        />
        <Row
          label="Frame distance"
          value={evidence.minimumFrameDistancePx.toFixed(3)}
        />
      </dl>
    </section>
  );
}

export default function FloorContactOverlayReviewClient({ records }: Props) {
  const [roomId, setRoomId] =
    useState<P2S2DFloorContactReviewRoomId>("room-c");
  const [showOld, setShowOld] = useState(true);
  const [showNew, setShowNew] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<Readonly<{ x: number; y: number }> | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [neighborhood, setNeighborhood] = useState<string>("0007–0010");
  const current = records[roomId];
  const selected = current.newFragments.find(item => item.id === selectedId) ??
    null;
  const highlightedSuffixes = new Set(
    P2_S2D_ROOM_C_REVIEW_NEIGHBORHOODS.find(item =>
      item.id === neighborhood
    )?.oldFragmentSuffixes ?? []
  );

  function chooseRoom(value: P2S2DFloorContactReviewRoomId) {
    setRoomId(value);
    setSelectedId(null);
    setCursor(null);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-[1800px]">
        <header className="rounded border border-fuchsia-800 bg-fuchsia-950/20 p-4">
          <h1 className="text-lg font-semibold">
            P2-S2D visible floor-contact localization review
          </h1>
          <p className="mt-1 text-sm text-fuchsia-100">
            Research-only comparison of unchanged P2-S2A geometry and new
            finite EMPTY-space termination evidence. No editing or scoring.
          </p>
        </header>

        <section className="mt-4 flex flex-wrap items-end gap-4 rounded border border-slate-800 bg-slate-900 p-3">
          <label className="grid gap-1 text-xs">
            <span>Room</span>
            <select
              value={roomId}
              onChange={event =>
                chooseRoom(event.target.value as P2S2DFloorContactReviewRoomId)
              }
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS.map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <Toggle
            checked={showOld}
            color="#22d3ee"
            label="Old P2-S2A"
            onChange={setShowOld}
          />
          <Toggle
            checked={showNew}
            color="#f472b6"
            label="New P2-S2D"
            onChange={setShowNew}
          />
          <Toggle
            checked={showLabels}
            color="#f8fafc"
            label="Fragment IDs"
            onChange={setShowLabels}
          />
          <label className="grid gap-1 text-xs">
            <span>Zoom {zoom.toFixed(1)}×</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.25"
              value={zoom}
              onChange={event => setZoom(Number(event.target.value))}
            />
          </label>
          {roomId === "room-c" ? (
            <label className="grid gap-1 text-xs">
              <span>Room C neighborhood</span>
              <select
                value={neighborhood}
                onChange={event => setNeighborhood(event.target.value)}
                className="rounded border border-amber-700 bg-slate-950 px-3 py-2"
              >
                {P2_S2D_ROOM_C_REVIEW_NEIGHBORHOODS.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.id} — {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>

        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="min-w-0">
            <section className="overflow-auto rounded border border-slate-700 bg-black">
              <svg
                viewBox={`0 0 ${current.dimensions.width} ${current.dimensions.height}`}
                role="img"
                aria-label={`${roomId} certified EMPTY floor-contact overlays`}
                className="block h-auto max-w-none touch-none"
                style={{ width: `${zoom * 100}%` }}
                onPointerMove={event => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setCursor(p2S2DFloorContactPointerToSourcePixel(
                    {
                      x: event.clientX - bounds.left,
                      y: event.clientY - bounds.top,
                    },
                    { width: bounds.width, height: bounds.height },
                    current.dimensions
                  ));
                }}
                onPointerLeave={() => setCursor(null)}
                onClick={() => setSelectedId(null)}
              >
                <image
                  href={`/api/admin/3d-room-lab/p2-s2d-floor-contact-overlay-review-image?roomId=${roomId}`}
                  width={current.dimensions.width}
                  height={current.dimensions.height}
                />
                {showOld ? current.oldFragments.map(fragment => {
                  const points = p2S2DFloorContactPolyline(
                    fragment,
                    current.dimensions
                  );
                  const suffix = p2S2DFloorContactShortId(fragment.id);
                  const highlighted = roomId === "room-c" &&
                    highlightedSuffixes.has(suffix);
                  const midpoint = points[Math.floor(points.length / 2)];
                  return (
                    <g key={fragment.id}>
                      <polyline
                        points={points.map(point => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke={highlighted ? "#facc15" : "#22d3ee"}
                        strokeWidth={highlighted ? 6 : 3}
                        strokeDasharray="8 5"
                        vectorEffect="non-scaling-stroke"
                      />
                      {showLabels && midpoint ? (
                        <text
                          x={midpoint.x}
                          y={midpoint.y - 5}
                          fill={highlighted ? "#facc15" : "#67e8f9"}
                          fontSize="10"
                          stroke="#020617"
                          strokeWidth="2"
                          paintOrder="stroke"
                        >
                          {suffix}
                        </text>
                      ) : null}
                    </g>
                  );
                }) : null}
                {showNew ? current.newFragments.map(fragment => {
                  const points = p2S2DFloorContactPolyline(
                    fragment,
                    current.dimensions
                  );
                  const midpoint = points[Math.floor(points.length / 2)];
                  const selectedFragment = fragment.id === selectedId;
                  return (
                    <g key={fragment.id}>
                      <polyline
                        points={points.map(point => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="#f472b6"
                        strokeWidth={selectedFragment ? 7 : 4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        className="cursor-pointer"
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedId(fragment.id);
                        }}
                      />
                      {showLabels && midpoint ? (
                        <text
                          x={midpoint.x}
                          y={midpoint.y + 13}
                          fill="#f9a8d4"
                          fontSize="10"
                          stroke="#020617"
                          strokeWidth="2"
                          paintOrder="stroke"
                        >
                          {p2S2DFloorContactShortId(fragment.id)}
                        </text>
                      ) : null}
                    </g>
                  );
                }) : null}
              </svg>
            </section>
            <p className="mt-2 font-mono text-xs text-fuchsia-200">
              Source pixel: {cursor ? `x=${cursor.x}, y=${cursor.y}` : "—"}
            </p>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded border border-slate-800 bg-slate-900 p-4">
              <h2 className="font-semibold">Source summary</h2>
              <dl className="mt-2">
                <Row label="EMPTY SHA" value={current.emptyImageSha256} />
                <Row
                  label="Dimensions"
                  value={`${current.dimensions.width} × ${current.dimensions.height}`}
                />
                <Row label="Old authority" value={current.oldSourceAuthority} />
                <Row label="Old fragments" value={current.oldFragments.length} />
                <Row label="New fragments" value={current.newFragments.length} />
                <Row
                  label="Raw-mask pixels"
                  value={current.diagnostics.rawRegionPixelCount}
                />
                <Row
                  label="Core pixels"
                  value={current.diagnostics.corePixelCount}
                />
                <Row
                  label="Continuity rejects"
                  value={current.diagnostics.appearanceContinuityRejectedEdgeCount}
                />
                <Row
                  label="Stripe-return pixels"
                  value={current.diagnostics.stripeReturnRestoredPixelCount}
                />
                <Row
                  label="Thin-restored pixels"
                  value={current.diagnostics.thinComponentRestoredPixelCount}
                />
                <Row
                  label="Support components"
                  value={current.diagnostics.supportComponents.length}
                />
                <Row
                  label="Core seed"
                  value={`${current.diagnostics.coreSeedSourcePx.x}, ${current.diagnostics.coreSeedSourcePx.y}`}
                />
                <Row
                  label="Accepted samples"
                  value={current.diagnostics.supportedTransitionCount}
                />
              </dl>
            </section>
            <Inspector fragment={selected} />
          </aside>
        </div>
      </div>
    </main>
  );
}
