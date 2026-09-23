"use client";

import { useMemo, useState } from "react";

import type {
  EmptyRegionBoundaryFragment,
} from "../empty-region-boundary-fragments";
import {
  P2_S2C_BOUNDARY_COLLISION_POLICY_VERSION,
  type P2S2CCollisionPolicyRecord,
} from "../empty-boundary-collision-policy";
import {
  P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS,
  P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS,
  p2S2CCollisionOverlayFragmentPolyline,
  p2S2CCollisionOverlayPolicyForFragment,
  p2S2CCollisionOverlayShortFragmentId,
  type P2S2CCollisionOverlayReviewRecord,
  type P2S2CCollisionOverlayReviewRoomId,
} from "../p2-s2c-collision-overlay-review";

type Props = Readonly<{
  records: Readonly<
    Record<P2S2CCollisionOverlayReviewRoomId, P2S2CCollisionOverlayReviewRecord>
  >;
}>;

type BoundaryState = EmptyRegionBoundaryFragment["boundaryState"];

const SOURCE_STYLE: Readonly<Record<
  BoundaryState,
  Readonly<{ color: string; dash?: string; label: string }>
>> = Object.freeze({
  physical_wall: { color: "#22d3ee", label: "Source physical wall" },
  unknown: { color: "#facc15", dash: "9 6", label: "Source unknown" },
  frame_truncated: {
    color: "#c084fc",
    dash: "3 7",
    label: "Source frame truncated",
  },
});

const POLICY_STYLE = Object.freeze({
  block: { color: "#f43f5e", label: "P2-S2C block" },
  pass: { color: "#34d399", label: "P2-S2C pass" },
});

function formatNumber(value: number | null, digits = 3): string {
  return value === null
    ? "null"
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(digits);
}

function roomLabel(roomId: P2S2CCollisionOverlayReviewRoomId): string {
  return `Room ${roomId.at(-1)?.toUpperCase()}`;
}

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
    <label className="flex items-center gap-2 text-sm text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="h-4 w-4"
      />
      <span className="h-2.5 w-5 rounded" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </label>
  );
}

function DiagnosticRow({
  label,
  value,
}: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="grid grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-slate-800 py-1.5 text-xs">
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all font-mono text-slate-100">{value}</dd>
    </div>
  );
}

function FragmentInspector({
  fragment,
  policy,
  reviewTarget,
}: Readonly<{
  fragment: EmptyRegionBoundaryFragment | null;
  policy: P2S2CCollisionPolicyRecord | null;
  reviewTarget: boolean;
}>) {
  if (!fragment || !policy) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="font-semibold">Fragment inspector</h2>
        <p className="mt-2 text-sm text-slate-400">
          Select a finite source fragment in the image or inventory.
        </p>
      </section>
    );
  }
  const verification = fragment.verification;
  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Fragment inspector</h2>
        {reviewTarget ? (
          <span className="rounded bg-amber-400/15 px-2 py-1 text-xs text-amber-200">
            highlighted review target
          </span>
        ) : null}
      </div>
      <dl className="mt-2">
        <DiagnosticRow label="Fragment ID" value={fragment.id} />
        <DiagnosticRow label="Original boundary state" value={fragment.boundaryState} />
        <DiagnosticRow label="Evidence class" value={policy.evidenceClass} />
        <DiagnosticRow label="Collision policy" value={policy.collisionPolicy} />
        <DiagnosticRow
          label="Policy reasons"
          value={policy.policyReasons.join(", ")}
        />
        <DiagnosticRow
          label="Original classification reasons"
          value={fragment.classificationReasons.join(", ")}
        />
        <DiagnosticRow
          label="Touches image frame"
          value={String(fragment.touchesImageFrame)}
        />
        <DiagnosticRow
          label="Source-pixel length"
          value={formatNumber(verification.sourcePixelLength)}
        />
        <DiagnosticRow
          label="Source-pixel X span"
          value={formatNumber(verification.sourcePixelXSpan)}
        />
        <DiagnosticRow label="Sample count" value={verification.sampleCount} />
        <DiagnosticRow
          label="Maximum line residual"
          value={formatNumber(verification.maximumLineResidualPx)}
        />
        <DiagnosticRow
          label="Inside floor-like fraction"
          value={formatNumber(verification.insideFloorLikeFraction)}
        />
        <DiagnosticRow
          label="Outside floor-like fraction"
          value={formatNumber(verification.outsideFloorLikeFraction)}
        />
        <DiagnosticRow
          label="Inside seed RGB distance"
          value={formatNumber(verification.meanInsideSeedRgbDistance)}
        />
        <DiagnosticRow
          label="Outside seed RGB distance"
          value={formatNumber(verification.meanOutsideSeedRgbDistance)}
        />
        <DiagnosticRow
          label="Outside-to-inside luma drop"
          value={formatNumber(verification.meanOutsideToInsideLumaDrop)}
        />
        <DiagnosticRow
          label="Outside-to-inside RGB distance"
          value={formatNumber(verification.meanOutsideToInsideRgbDistance)}
        />
        <DiagnosticRow
          label="Inside-to-outside warm-chroma drop"
          value={formatNumber(verification.meanInsideToOutsideWarmChromaDrop)}
        />
        <DiagnosticRow
          label="Inside region support"
          value={formatNumber(verification.insideRegionSupportFraction)}
        />
        <DiagnosticRow
          label="Outside region exclusion"
          value={formatNumber(verification.outsideRegionExclusionFraction)}
        />
      </dl>
    </section>
  );
}

export default function CollisionOverlayReviewClient({ records }: Props) {
  const [roomId, setRoomId] =
    useState<P2S2CCollisionOverlayReviewRoomId>("room-b");
  const [sourceVisible, setSourceVisible] = useState<
    Readonly<Record<BoundaryState, boolean>>
  >({
    physical_wall: true,
    unknown: true,
    frame_truncated: true,
  });
  const [showBlock, setShowBlock] = useState(true);
  const [showPass, setShowPass] = useState(true);
  const [selectedFragmentId, setSelectedFragmentId] = useState<string | null>(
    null
  );
  const [zoom, setZoom] = useState(1);
  const record = records[roomId];
  const targets: readonly string[] =
    P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS[roomId];
  const selectedFragment = record.fragments.find(fragment =>
    fragment.id === selectedFragmentId
  ) ?? null;
  const selectedPolicy = selectedFragment
    ? p2S2CCollisionOverlayPolicyForFragment(record, selectedFragment.id)
    : null;
  const selectedShortId = selectedFragment
    ? p2S2CCollisionOverlayShortFragmentId(selectedFragment.id)
    : null;
  const counts = useMemo(() => record.policies.reduce(
    (value, policy) => {
      value[policy.collisionPolicy] += 1;
      value[policy.evidenceClass] += 1;
      return value;
    },
    {
      block: 0,
      pass: 0,
      unresolved: 0,
      verified_wall_contact: 0,
      observed_floor_termination: 0,
      frame_truncated: 0,
    }
  ), [record.policies]);

  function chooseRoom(nextRoomId: P2S2CCollisionOverlayReviewRoomId) {
    setRoomId(nextRoomId);
    setSelectedFragmentId(null);
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-[1800px]">
        <header className="rounded border border-rose-800/70 bg-rose-950/20 p-4">
          <h1 className="text-lg font-semibold">
            P2-S2C collision-semantics overlay review
          </h1>
          <p className="mt-1 text-sm text-rose-100">
            Geometry and original P2-S2A wall semantics remain frozen. The
            thicker policy overlay exists only on each finite source fragment.
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Read-only research view. No product collision, scoring, geometry
            repair, hidden continuation, gap bridging, or closure.
          </p>
        </header>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_27rem]">
          <div className="min-w-0">
            <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <label className="grid gap-1 text-xs text-slate-300">
                  <span>Review room</span>
                  <select
                    value={roomId}
                    onChange={event => chooseRoom(
                      event.target.value as P2S2CCollisionOverlayReviewRoomId
                    )}
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    {P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS.map(value => (
                      <option key={value} value={value}>{roomLabel(value)}</option>
                    ))}
                  </select>
                </label>
                {(Object.keys(SOURCE_STYLE) as BoundaryState[]).map(state => (
                  <Toggle
                    key={state}
                    checked={sourceVisible[state]}
                    color={SOURCE_STYLE[state].color}
                    label={SOURCE_STYLE[state].label}
                    onChange={checked => setSourceVisible(current => ({
                      ...current,
                      [state]: checked,
                    }))}
                  />
                ))}
                <Toggle
                  checked={showBlock}
                  color={POLICY_STYLE.block.color}
                  label={POLICY_STYLE.block.label}
                  onChange={setShowBlock}
                />
                <Toggle
                  checked={showPass}
                  color={POLICY_STYLE.pass.color}
                  label={POLICY_STYLE.pass.label}
                  onChange={setShowPass}
                />
                <label className="grid gap-1 text-xs text-slate-300">
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
              </div>
            </section>

            <section className="mt-3 overflow-auto rounded border border-slate-700 bg-black">
              <svg
                viewBox={`0 0 ${record.dimensions.width} ${record.dimensions.height}`}
                role="img"
                aria-label={`${roomLabel(roomId)} certified EMPTY with P2-S2C collision policy overlay`}
                onClick={() => setSelectedFragmentId(null)}
                className="block h-auto max-w-none"
                style={{ width: `${zoom * 100}%` }}
              >
                <image
                  href={`/api/admin/3d-room-lab/p2-s2c-collision-overlay-review-image?roomId=${roomId}`}
                  x="0"
                  y="0"
                  width={record.dimensions.width}
                  height={record.dimensions.height}
                />
                {record.fragments.map(fragment => {
                  const policy = p2S2CCollisionOverlayPolicyForFragment(
                    record,
                    fragment.id
                  );
                  const visible = policy.collisionPolicy === "block"
                    ? showBlock
                    : policy.collisionPolicy === "pass"
                      ? showPass
                      : false;
                  if (!visible) return null;
                  const points = p2S2CCollisionOverlayFragmentPolyline(
                    fragment,
                    record.dimensions
                  );
                  const style = policy.collisionPolicy === "block"
                    ? POLICY_STYLE.block
                    : POLICY_STYLE.pass;
                  return (
                    <polyline
                      key={`policy:${fragment.id}`}
                      points={points.map(point => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke={style.color}
                      strokeWidth="9"
                      strokeDasharray={
                        policy.collisionPolicy === "pass" ? "12 8" : undefined
                      }
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity="0.72"
                      vectorEffect="non-scaling-stroke"
                      className="cursor-pointer"
                      onClick={event => {
                        event.stopPropagation();
                        setSelectedFragmentId(fragment.id);
                      }}
                    />
                  );
                })}
                {record.fragments.map(fragment => {
                  if (!sourceVisible[fragment.boundaryState]) return null;
                  const points = p2S2CCollisionOverlayFragmentPolyline(
                    fragment,
                    record.dimensions
                  );
                  const midpoint = points[Math.floor(points.length / 2)];
                  const sourceStyle = SOURCE_STYLE[fragment.boundaryState];
                  const suffix = p2S2CCollisionOverlayShortFragmentId(fragment.id);
                  const target = targets.includes(suffix);
                  const selected = fragment.id === selectedFragmentId;
                  return (
                    <g key={`source:${fragment.id}`}>
                      <polyline
                        points={points.map(point => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke={sourceStyle.color}
                        strokeWidth={selected ? 6 : 3}
                        strokeDasharray={sourceStyle.dash}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        className="cursor-pointer"
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedFragmentId(fragment.id);
                        }}
                      />
                      {midpoint ? (
                        <text
                          x={midpoint.x}
                          y={midpoint.y - (target ? 12 : 6)}
                          fill={target ? "#fde68a" : sourceStyle.color}
                          fontSize={target ? "14" : "10"}
                          fontWeight={target ? "700" : "400"}
                          stroke="#020617"
                          strokeWidth="3"
                          paintOrder="stroke"
                          pointerEvents="none"
                        >
                          {target ? `REVIEW ${suffix}` : suffix}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            </section>

            <section className="mt-4 rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Finite source-fragment inventory</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {record.fragments.map(fragment => {
                  const suffix = p2S2CCollisionOverlayShortFragmentId(fragment.id);
                  const policy = p2S2CCollisionOverlayPolicyForFragment(
                    record,
                    fragment.id
                  );
                  const target = targets.includes(suffix);
                  return (
                    <button
                      key={fragment.id}
                      type="button"
                      onClick={() => setSelectedFragmentId(fragment.id)}
                      className={`rounded border px-3 py-2 text-left text-xs ${
                        target
                          ? "border-amber-500/70 bg-amber-950/20"
                          : "border-slate-700 hover:border-slate-500"
                      }`}
                    >
                      <span
                        className="font-mono"
                        style={{ color: SOURCE_STYLE[fragment.boundaryState].color }}
                      >
                        {suffix}
                      </span>
                      <span className="ml-2 text-slate-300">
                        {fragment.boundaryState}
                      </span>
                      <span
                        className="ml-2"
                        style={{
                          color: policy.collisionPolicy === "block"
                            ? POLICY_STYLE.block.color
                            : POLICY_STYLE.pass.color,
                        }}
                      >
                        {policy.collisionPolicy}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Review authority</h2>
              <dl className="mt-2">
                <DiagnosticRow label="Room" value={roomId} />
                <DiagnosticRow
                  label="Source"
                  value={record.sourceAuthority}
                />
                <DiagnosticRow
                  label="Overlay version"
                  value={P2_S2C_BOUNDARY_COLLISION_POLICY_VERSION}
                />
                <DiagnosticRow
                  label="Certified EMPTY SHA"
                  value={record.emptyImageSha256}
                />
                <DiagnosticRow
                  label="Frozen receipt SHA"
                  value={record.receiptSha256 ?? "not applicable (A/C/E regression)"}
                />
                <DiagnosticRow
                  label="Dimensions"
                  value={`${record.dimensions.width} × ${record.dimensions.height}`}
                />
              </dl>
            </section>

            <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Overlay summary</h2>
              <dl className="mt-2">
                <DiagnosticRow label="Block" value={counts.block} />
                <DiagnosticRow label="Pass" value={counts.pass} />
                <DiagnosticRow
                  label="Verified wall contact"
                  value={counts.verified_wall_contact}
                />
                <DiagnosticRow
                  label="Observed floor termination"
                  value={counts.observed_floor_termination}
                />
                <DiagnosticRow
                  label="Frame truncated"
                  value={counts.frame_truncated}
                />
                <DiagnosticRow label="Unresolved evidence" value={counts.unresolved} />
              </dl>
              {targets.length > 0 ? (
                <p className="mt-3 text-xs text-amber-200">
                  Highlighted review IDs: {targets.join(", ")}
                </p>
              ) : null}
            </section>

            <FragmentInspector
              fragment={selectedFragment}
              policy={selectedPolicy}
              reviewTarget={selectedShortId
                ? targets.includes(selectedShortId)
                : false}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}
