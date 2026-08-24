"use client";

import { useState } from "react";

import type { VisibleFloorTerminationFragment } from "../empty-visible-floor-contact-localizer";
import type { VisibleFloorTerminationCollisionPolicyRecord } from "../empty-visible-floor-termination-collision-policy";
import {
  P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS,
  p2S2ETerminationCollisionPointerToSourcePixel,
  p2S2ETerminationCollisionPolyline,
  p2S2ETerminationCollisionShortId,
  type P2S2ETerminationCollisionReviewRecord,
  type P2S2ETerminationCollisionReviewRoomId,
} from "../p2-s2e-termination-collision-overlay-review";

type Props = Readonly<{
  records: Readonly<
    Record<
      P2S2ETerminationCollisionReviewRoomId,
      P2S2ETerminationCollisionReviewRecord
    >
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
  policy,
}: Readonly<{
  fragment: VisibleFloorTerminationFragment | null;
  policy: VisibleFloorTerminationCollisionPolicyRecord | null;
}>) {
  if (!fragment || !policy) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">Fragment policy</h2>
        <p className="mt-2 text-sm text-slate-400">
          Select an existing P2-S2D finite termination.
        </p>
      </section>
    );
  }
  const evidence = fragment.evidence;
  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <h2 className="font-semibold">Fragment policy</h2>
      <dl className="mt-2">
        <Row label="Fragment ID" value={fragment.id} />
        <Row label="Geometry" value={fragment.geometryKind} />
        <Row label="Start endpoint" value={fragment.startEndpoint.state} />
        <Row label="End endpoint" value={fragment.endEndpoint.state} />
        <Row label="Evidence class" value={policy.evidenceClass} />
        <Row label="Collision policy" value={policy.collisionPolicy} />
        <Row label="Policy reasons" value={policy.policyReasons.join(", ")} />
        <Row label="Interior rule" value={evidence.interiorSupportRule} />
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
          label="Frame distance"
          value={evidence.minimumFrameDistancePx.toFixed(3)}
        />
      </dl>
    </section>
  );
}

export default function TerminationCollisionOverlayReviewClient({
  records,
}: Props) {
  const [roomId, setRoomId] =
    useState<P2S2ETerminationCollisionReviewRoomId>("room-e");
  const [showSource, setShowSource] = useState(true);
  const [showBlock, setShowBlock] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<Readonly<{ x: number; y: number }> | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = records[roomId];
  const selectedFragment = current.fragments.find(
    fragment => fragment.id === selectedId
  ) ?? null;
  const selectedPolicy = current.policies.find(
    policy => policy.fragmentId === selectedId
  ) ?? null;
  const policyByFragmentId = new Map(
    current.policies.map(policy => [policy.fragmentId, policy])
  );

  function chooseRoom(value: P2S2ETerminationCollisionReviewRoomId) {
    setRoomId(value);
    setSelectedId(null);
    setCursor(null);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-[1800px]">
        <header className="rounded border border-red-800 bg-red-950/20 p-4">
          <h1 className="text-lg font-semibold">
            P2-S2E visible-floor-termination collision overlay
          </h1>
          <p className="mt-1 text-sm text-red-100">
            Research-only, read-only metadata overlay. P2-S2D owns every finite
            source polyline; P2-S2E marks each existing span as block.
          </p>
        </header>

        <section className="mt-4 flex flex-wrap items-end gap-4 rounded border border-slate-800 bg-slate-900 p-3">
          <label className="grid gap-1 text-xs">
            <span>Room</span>
            <select
              value={roomId}
              onChange={event => chooseRoom(
                event.target.value as P2S2ETerminationCollisionReviewRoomId
              )}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS.map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <Toggle
            checked={showSource}
            color="#22d3ee"
            label="P2-S2D source"
            onChange={setShowSource}
          />
          <Toggle
            checked={showBlock}
            color="#ef4444"
            label="P2-S2E block"
            onChange={setShowBlock}
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
        </section>

        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
          <div className="min-w-0">
            <section className="overflow-auto rounded border border-slate-700 bg-black">
              <svg
                viewBox={`0 0 ${current.dimensions.width} ${current.dimensions.height}`}
                role="img"
                aria-label={`${roomId} certified EMPTY termination collision overlays`}
                className="block h-auto max-w-none touch-none"
                style={{ width: `${zoom * 100}%` }}
                onPointerMove={event => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setCursor(p2S2ETerminationCollisionPointerToSourcePixel(
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
                  href={`/api/admin/3d-room-lab/p2-s2e-termination-collision-overlay-review-image?roomId=${roomId}`}
                  width={current.dimensions.width}
                  height={current.dimensions.height}
                />
                {showBlock ? current.fragments.map(fragment => {
                  const policy = policyByFragmentId.get(fragment.id);
                  if (!policy || policy.collisionPolicy !== "block") return null;
                  const points = p2S2ETerminationCollisionPolyline(
                    fragment,
                    current.dimensions
                  );
                  const selected = fragment.id === selectedId;
                  return (
                    <polyline
                      key={`block:${fragment.id}`}
                      points={points.map(point => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke="#ef4444"
                      strokeOpacity="0.8"
                      strokeWidth={selected ? 10 : 8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      className="cursor-pointer"
                      onClick={event => {
                        event.stopPropagation();
                        setSelectedId(fragment.id);
                      }}
                    />
                  );
                }) : null}
                {showSource ? current.fragments.map(fragment => {
                  const points = p2S2ETerminationCollisionPolyline(
                    fragment,
                    current.dimensions
                  );
                  const midpoint = points[Math.floor(points.length / 2)];
                  const selected = fragment.id === selectedId;
                  return (
                    <g key={`source:${fragment.id}`}>
                      <polyline
                        points={points.map(point => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth={selected ? 4 : 2}
                        strokeDasharray="7 4"
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
                          y={midpoint.y - 8}
                          fill="#e2e8f0"
                          fontSize="10"
                          stroke="#020617"
                          strokeWidth="2"
                          paintOrder="stroke"
                        >
                          {p2S2ETerminationCollisionShortId(fragment.id)}
                        </text>
                      ) : null}
                    </g>
                  );
                }) : null}
              </svg>
            </section>
            <p className="mt-2 font-mono text-xs text-cyan-200">
              Source pixel: {cursor ? `x=${cursor.x}, y=${cursor.y}` : "—"}
            </p>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded border border-slate-800 bg-slate-900 p-4">
              <h2 className="font-semibold">Certified source summary</h2>
              <dl className="mt-2">
                <Row label="EMPTY SHA" value={current.emptyImageSha256} />
                <Row
                  label="Dimensions"
                  value={`${current.dimensions.width} × ${current.dimensions.height}`}
                />
                <Row label="Geometry authority" value={current.geometryAuthority} />
                <Row label="Policy version" value={current.policyVersion} />
                <Row label="P2-S2D fragments" value={current.fragments.length} />
                <Row label="P2-S2E policies" value={current.policies.length} />
                <Row
                  label="Raw-mask pixels"
                  value={current.diagnostics.rawRegionPixelCount}
                />
                <Row
                  label="Core pixels"
                  value={current.diagnostics.corePixelCount}
                />
                <Row
                  label="Accepted samples"
                  value={current.diagnostics.supportedTransitionCount}
                />
                <Row
                  label="Frame rejects"
                  value={current.diagnostics.rejected.frameProximity}
                />
                <Row
                  label="Ambiguous rejects"
                  value={current.diagnostics.rejected.ambiguousTransition}
                />
                <Row
                  label="Short-chain rejects"
                  value={current.diagnostics.rejected.shortChain}
                />
              </dl>
            </section>
            <Inspector fragment={selectedFragment} policy={selectedPolicy} />
          </aside>
        </div>
      </div>
    </main>
  );
}
