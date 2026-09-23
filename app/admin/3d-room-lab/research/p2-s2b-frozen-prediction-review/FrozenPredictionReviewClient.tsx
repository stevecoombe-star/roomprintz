"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  EmptyRegionBoundaryFragment,
} from "../empty-region-boundary-fragments";
import type {
  P2S2BFrozenPredictionReceipt,
} from "../p2-s2b-holdout-prediction";
import {
  P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES,
  P2_S2B_FROZEN_REVIEW_ROOMS,
  p2S2BReviewFragmentCounts,
  p2S2BReviewFragmentPolyline,
  p2S2BReviewPointerToSourcePixel,
  type P2S2BFrozenReviewBoundaryState,
  type P2S2BFrozenReviewPoint,
  type P2S2BFrozenReviewRoomId,
} from "../p2-s2b-frozen-prediction-review";

type VerifiedRecord = Readonly<{
  receipt: P2S2BFrozenPredictionReceipt;
  receiptSha256: string;
}>;

type Props = Readonly<{
  records: Readonly<Record<P2S2BFrozenReviewRoomId, VerifiedRecord>>;
}>;

type MaskStatus =
  | Readonly<{ roomId: P2S2BFrozenReviewRoomId; state: "loading" }>
  | Readonly<{
      roomId: P2S2BFrozenReviewRoomId;
      state: "verified";
      objectUrl: string;
      sha256: string;
    }>
  | Readonly<{
      roomId: P2S2BFrozenReviewRoomId;
      state: "unavailable";
    }>;

const LAYER_STYLE: Readonly<Record<
  P2S2BFrozenReviewBoundaryState,
  Readonly<{ color: string; dash?: string; width: number; label: string }>
>> = Object.freeze({
  physical_wall: {
    color: "#22d3ee",
    width: 4,
    label: "Physical wall",
  },
  unknown: {
    color: "#facc15",
    dash: "9 6",
    width: 3,
    label: "Unknown",
  },
  frame_truncated: {
    color: "#c084fc",
    dash: "3 7",
    width: 3,
    label: "Frame truncated",
  },
});

function formatNumber(value: number | null, digits = 3): string {
  return value === null ? "null" : Number.isInteger(value)
    ? String(value)
    : value.toFixed(digits);
}

function shortFragmentId(id: string): string {
  return id.split(":").at(-1) ?? id;
}

function coordinateText(
  points: readonly P2S2BFrozenReviewPoint[]
): string {
  return points.map((point, index) =>
    `${String(index).padStart(3, "0")}: (${formatNumber(point.x)}, ${formatNumber(point.y)})`
  ).join("\n");
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
  dimensions,
}: Readonly<{
  fragment: EmptyRegionBoundaryFragment | null;
  dimensions: Readonly<{ width: number; height: number }>;
}>) {
  if (!fragment) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
        <h2 className="font-semibold">Fragment inspector</h2>
        <p className="mt-2 text-sm text-slate-400">
          Select a persisted fragment in the image or list.
        </p>
      </section>
    );
  }
  const sourcePixels = p2S2BReviewFragmentPolyline(fragment, dimensions);
  const verification = fragment.verification;
  return (
    <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
      <h2 className="font-semibold">Fragment inspector</h2>
      <dl className="mt-2">
        <DiagnosticRow label="Fragment ID" value={fragment.id} />
        <DiagnosticRow label="Boundary state" value={fragment.boundaryState} />
        <DiagnosticRow
          label="Classification reasons"
          value={fragment.classificationReasons.join(", ")}
        />
        <DiagnosticRow
          label="Source span ID"
          value={fragment.sourcePerimeterSpanId}
        />
        <DiagnosticRow
          label="Start endpoint"
          value={`${fragment.startEndpoint.status} / ${fragment.startEndpoint.frameContact}`}
        />
        <DiagnosticRow
          label="End endpoint"
          value={`${fragment.endEndpoint.status} / ${fragment.endEndpoint.frameContact}`}
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
        <DiagnosticRow
          label="Sample count"
          value={verification.sampleCount}
        />
        <DiagnosticRow
          label="Max line residual"
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
          label="Outside exclusion support"
          value={formatNumber(verification.outsideRegionExclusionFraction)}
        />
      </dl>
      <details className="mt-3 rounded border border-slate-700 p-2">
        <summary className="cursor-pointer text-xs text-slate-300">
          Complete source-normalized coordinates ({fragment.pointsSourceNormalized.length})
        </summary>
        <pre className="mt-2 max-h-52 overflow-auto text-[11px] text-slate-300">
          {coordinateText(fragment.pointsSourceNormalized)}
        </pre>
      </details>
      <details className="mt-2 rounded border border-slate-700 p-2">
        <summary className="cursor-pointer text-xs text-slate-300">
          Complete derived source-pixel coordinates ({sourcePixels.length})
        </summary>
        <pre className="mt-2 max-h-52 overflow-auto text-[11px] text-slate-300">
          {coordinateText(sourcePixels)}
        </pre>
      </details>
    </section>
  );
}

export default function FrozenPredictionReviewClient({ records }: Props) {
  const [roomId, setRoomId] =
    useState<P2S2BFrozenReviewRoomId>("room-b");
  const [visible, setVisible] = useState<
    Readonly<Record<P2S2BFrozenReviewBoundaryState, boolean>>
  >({
    physical_wall: true,
    unknown: true,
    frame_truncated: true,
  });
  const [showMask, setShowMask] = useState(true);
  const [maskOpacity, setMaskOpacity] = useState(0.42);
  const [zoom, setZoom] = useState(1);
  const [cursor, setCursor] = useState<P2S2BFrozenReviewPoint | null>(null);
  const [selectedFragmentId, setSelectedFragmentId] = useState<string | null>(
    null
  );
  const [maskStatus, setMaskStatus] = useState<MaskStatus>({
    roomId: "room-b",
    state: "loading",
  });

  const record = records[roomId];
  const { receipt } = record;
  if (receipt.outcome.status !== "ok") {
    throw new Error("Frozen review requires a successful persisted receipt");
  }
  const dimensions = receipt.input.emptyDimensions;
  const fragments = receipt.outcome.fragments;
  const expectedMaskSha256 = receipt.outcome.region.componentMaskSha256;
  const counts = useMemo(
    () => p2S2BReviewFragmentCounts(fragments),
    [fragments]
  );
  const selectedFragment = fragments.find(
    fragment => fragment.id === selectedFragmentId
  ) ?? null;
  const currentMaskStatus: MaskStatus = maskStatus.roomId === roomId
    ? maskStatus
    : { roomId, state: "loading" };

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/3d-room-lab/p2-s2b-frozen-prediction-review-mask?roomId=${roomId}`,
          { cache: "no-store", signal: controller.signal }
        );
        const sha256 = response.headers.get(
          "X-P2-S2B-Component-Mask-Sha256"
        );
        if (!response.ok || sha256 !== expectedMaskSha256) {
          setMaskStatus({ roomId, state: "unavailable" });
          return;
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setMaskStatus({ roomId, state: "verified", objectUrl, sha256 });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setMaskStatus({ roomId, state: "unavailable" });
        }
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [expectedMaskSha256, roomId]);

  function chooseRoom(nextRoomId: P2S2BFrozenReviewRoomId) {
    setRoomId(nextRoomId);
    setSelectedFragmentId(null);
    setCursor(null);
  }

  function updateCursor(event: React.PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setCursor(p2S2BReviewPointerToSourcePixel(
      {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      },
      { width: bounds.width, height: bounds.height },
      dimensions
    ));
  }

  const region = receipt.outcome.region;
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-[1800px]">
        <header className="rounded border border-cyan-800/70 bg-cyan-950/20 p-4">
          <h1 className="text-lg font-semibold">
            P2-S2B frozen prediction visual review
          </h1>
          <p className="mt-1 text-sm text-cyan-100">
            Rooms B/D are intentionally revealed frozen post-P2-S2A review /
            validation cases. They are no longer a blinded holdout.
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Persisted receipt geometry is presented without correction,
            scoring, correctness labels, or detector retuning. Future
            generalization claims require new unseen rooms.
          </p>
        </header>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0">
            <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <label className="grid gap-1 text-xs text-slate-300">
                  <span>Review room</span>
                  <select
                    value={roomId}
                    onChange={event =>
                      chooseRoom(event.target.value as P2S2BFrozenReviewRoomId)
                    }
                    className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
                  >
                    {P2_S2B_FROZEN_REVIEW_ROOMS.map(value => (
                      <option key={value} value={value}>
                        {value === "room-b" ? "Room B" : "Room D"}
                      </option>
                    ))}
                  </select>
                </label>
                <Toggle
                  checked={showMask}
                  color="#0ea5e9"
                  label="Verified region mask"
                  onChange={setShowMask}
                />
                {P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES.map(state => (
                  <Toggle
                    key={state}
                    checked={visible[state]}
                    color={LAYER_STYLE[state].color}
                    label={LAYER_STYLE[state].label}
                    onChange={checked =>
                      setVisible(current => ({ ...current, [state]: checked }))
                    }
                  />
                ))}
                <label className="grid gap-1 text-xs text-slate-300">
                  <span>Mask opacity {Math.round(maskOpacity * 100)}%</span>
                  <input
                    type="range"
                    min="0.1"
                    max="0.8"
                    step="0.05"
                    value={maskOpacity}
                    onChange={event => setMaskOpacity(Number(event.target.value))}
                  />
                </label>
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
                viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                role="img"
                aria-label={`${roomId} certified EMPTY with frozen prediction overlays`}
                onPointerMove={updateCursor}
                onPointerLeave={() => setCursor(null)}
                onClick={() => setSelectedFragmentId(null)}
                className="block h-auto max-w-none touch-none"
                style={{ width: `${zoom * 100}%` }}
              >
                <image
                  href={`/api/admin/3d-room-lab/p2-s2b-holdout-oracle-image?roomId=${roomId}`}
                  x="0"
                  y="0"
                  width={dimensions.width}
                  height={dimensions.height}
                />
                {showMask && currentMaskStatus.state === "verified" ? (
                  <image
                    href={currentMaskStatus.objectUrl}
                    x="0"
                    y="0"
                    width={dimensions.width}
                    height={dimensions.height}
                    opacity={maskOpacity}
                    pointerEvents="none"
                  />
                ) : null}
                {P2_S2B_FROZEN_REVIEW_BOUNDARY_STATES.map(state =>
                  visible[state] ? fragments
                    .filter(fragment => fragment.boundaryState === state)
                    .map(fragment => {
                      const points = p2S2BReviewFragmentPolyline(
                        fragment,
                        dimensions
                      );
                      const midpoint = points[Math.floor(points.length / 2)];
                      const selected = fragment.id === selectedFragmentId;
                      return (
                        <g key={fragment.id}>
                          <polyline
                            points={points.map(point =>
                              `${point.x},${point.y}`
                            ).join(" ")}
                            fill="none"
                            stroke={LAYER_STYLE[state].color}
                            strokeWidth={
                              LAYER_STYLE[state].width + (selected ? 3 : 0)
                            }
                            strokeDasharray={LAYER_STYLE[state].dash}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                            className="cursor-pointer"
                            onClick={event => {
                              event.stopPropagation();
                              setSelectedFragmentId(fragment.id);
                            }}
                          >
                            <title>{fragment.id}</title>
                          </polyline>
                          {midpoint ? (
                            <text
                              x={midpoint.x}
                              y={midpoint.y - 6}
                              fill={LAYER_STYLE[state].color}
                              fontSize="10"
                              stroke="#020617"
                              strokeWidth="2"
                              paintOrder="stroke"
                              pointerEvents="none"
                            >
                              {shortFragmentId(fragment.id)}
                            </text>
                          ) : null}
                          {selected ? [points[0], points.at(-1)].map(
                            (point, index) => point ? (
                              <circle
                                key={index}
                                cx={point.x}
                                cy={point.y}
                                r="6"
                                fill={LAYER_STYLE[state].color}
                                stroke="#020617"
                                strokeWidth="2"
                                vectorEffect="non-scaling-stroke"
                                pointerEvents="none"
                              />
                            ) : null
                          ) : null}
                        </g>
                      );
                    }) : null
                )}
              </svg>
            </section>
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
              <p className="font-mono text-cyan-200">
                Source pixel: {cursor ? `x=${cursor.x}, y=${cursor.y}` : "—"}
              </p>
              <p className="text-slate-400">
                EMPTY remains visible. Scroll the image frame to pan while zoomed.
              </p>
            </div>

            <section className="mt-4 rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Persisted fragment inventory</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fragments.map(fragment => (
                  <button
                    key={fragment.id}
                    type="button"
                    onClick={() => setSelectedFragmentId(fragment.id)}
                    className="rounded border border-slate-700 px-3 py-2 text-left text-xs hover:border-slate-500"
                  >
                    <span
                      className="font-mono"
                      style={{ color: LAYER_STYLE[fragment.boundaryState].color }}
                    >
                      {shortFragmentId(fragment.id)}
                    </span>
                    <span className="ml-2 text-slate-300">
                      {fragment.boundaryState}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Frozen authority</h2>
              <p className="mt-2 text-sm font-medium text-cyan-200">
                Frozen receipt verified
              </p>
              <dl className="mt-2">
                <DiagnosticRow
                  label="Canonical receipt SHA"
                  value={record.receiptSha256}
                />
                <DiagnosticRow
                  label="Bound UI Git SHA"
                  value={receipt.detector.uiGitSha}
                />
                <DiagnosticRow
                  label="Region version"
                  value={receipt.detector.regionVersion}
                />
                <DiagnosticRow
                  label="Fragment version"
                  value={receipt.detector.fragmentVersion}
                />
                <DiagnosticRow
                  label="Region module blob"
                  value={receipt.detector.regionModuleBlob}
                />
                <DiagnosticRow
                  label="Fragment module blob"
                  value={receipt.detector.fragmentModuleBlob}
                />
              </dl>
              <p className="mt-3 text-xs text-slate-300">
                {currentMaskStatus.state === "loading"
                  ? "Verifying frozen mask reconstruction…"
                  : currentMaskStatus.state === "verified"
                    ? `Verified frozen mask reconstruction: ${currentMaskStatus.sha256}`
                    : "MASK RECONSTRUCTION DISABLED — frozen_mask_reconstruction_unavailable"}
              </p>
            </section>

            <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Raw frozen summary</h2>
              <dl className="mt-2">
                <DiagnosticRow
                  label="Physical wall count"
                  value={counts.physical_wall}
                />
                <DiagnosticRow label="Unknown count" value={counts.unknown} />
                <DiagnosticRow
                  label="Frame-truncated count"
                  value={counts.frame_truncated}
                />
              </dl>
            </section>

            <section className="rounded border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="font-semibold">Frozen region diagnostics</h2>
              <dl className="mt-2">
                <DiagnosticRow
                  label="Certified EMPTY SHA"
                  value={receipt.input.emptySha256}
                />
                <DiagnosticRow
                  label="Dimensions"
                  value={`${dimensions.width} × ${dimensions.height}`}
                />
                <DiagnosticRow
                  label="Seed source pixel"
                  value={`(${region.seed.pointSourcePx.x}, ${region.seed.pointSourcePx.y})`}
                />
                <DiagnosticRow
                  label="Seed mean RGB"
                  value={region.seed.patchMeanRgb.map(value =>
                    formatNumber(value)
                  ).join(", ")}
                />
                <DiagnosticRow
                  label="Mean luma"
                  value={formatNumber(region.seed.patchMeanLuma)}
                />
                <DiagnosticRow
                  label="Mean warm chroma"
                  value={formatNumber(region.seed.patchMeanWarmChroma)}
                />
                <DiagnosticRow
                  label="Region pixel count"
                  value={region.componentPixelCount}
                />
                <DiagnosticRow
                  label="Region fraction"
                  value={formatNumber(region.componentFraction, 6)}
                />
                <DiagnosticRow
                  label="Region bounds"
                  value={`${region.componentBoundsSourcePx.minX},${region.componentBoundsSourcePx.minY} → ${region.componentBoundsSourcePx.maxX},${region.componentBoundsSourcePx.maxY}`}
                />
                <DiagnosticRow
                  label="Boundary pixel count"
                  value={region.boundaryPixelCount}
                />
                <DiagnosticRow
                  label="Upper perimeter spans"
                  value={region.upperPerimeterSpanCount}
                />
                <DiagnosticRow
                  label="Frame spans"
                  value={region.frameContactSpanCount}
                />
                <DiagnosticRow
                  label="Component mask SHA"
                  value={region.componentMaskSha256}
                />
              </dl>
            </section>

            <FragmentInspector
              fragment={selectedFragment}
              dimensions={dimensions}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}
