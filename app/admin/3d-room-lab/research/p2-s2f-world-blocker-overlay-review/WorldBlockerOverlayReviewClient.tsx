"use client";

import { useState } from "react";

import {
  P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS,
  p2S2FImagePolyline,
  p2S2FShortFragmentId,
  p2S2FWorldPlotViewBox,
  type P2S2FWorldBlockerReviewRecord,
  type P2S2FWorldBlockerReviewRoomId,
} from "../p2-s2f-world-blocker-overlay-review";

type Props = Readonly<{
  records: Readonly<
    Record<P2S2FWorldBlockerReviewRoomId, P2S2FWorldBlockerReviewRecord>
  >;
}>;

function metric(value: number | null): string {
  return value === null ? "—" : value.toFixed(6);
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 16) : "—";
}

function cameraSourceLabel(value: "freeze_receipt_certified" | "raw_applied_authority") {
  return value === "freeze_receipt_certified"
    ? "certified freeze receipt"
    : "raw applied authority";
}

export default function WorldBlockerOverlayReviewClient({ records }: Props) {
  const [roomId, setRoomId] =
    useState<P2S2FWorldBlockerReviewRoomId>("room-e");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = records[roomId];
  const policyById = new Map(
    current.policies.map(policy => [policy.fragmentId, policy] as const)
  );
  const blockers = current.projection.status === "available"
    ? current.projection.blockers
    : [];
  const view = p2S2FWorldPlotViewBox(blockers);
  const labelSize = view.extent / 42;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-5 text-slate-100">
      <div className="mx-auto max-w-[1900px]">
        <header className="rounded border border-violet-700 bg-violet-950/20 p-4">
          <h1 className="text-lg font-semibold">
            P2-S2F finite blocker world-XZ projection
          </h1>
          <p className="mt-1 text-sm text-violet-100">
            Research-only coordinate-space review. One P2-S2D finite open
            polyline remains one finite open world polyline. No joins, snaps,
            bridges, or closing edges.
          </p>
        </header>

        <section className="mt-4 flex flex-wrap items-end gap-4 rounded border border-slate-800 bg-slate-900 p-3">
          <label className="grid gap-1 text-xs">
            <span>Room</span>
            <select
              value={roomId}
              onChange={event => {
                setRoomId(event.target.value as P2S2FWorldBlockerReviewRoomId);
                setSelectedId(null);
              }}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS.map(value => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className={`rounded border px-3 py-2 text-xs ${
            current.projection.status === "available"
              ? "border-emerald-700 bg-emerald-950/30 text-emerald-100"
              : "border-amber-700 bg-amber-950/30 text-amber-100"
          }`}>
            Authority status: <span className="font-semibold">
              {current.projection.status}
            </span>
            {current.projection.status === "available"
              ? ` · source ${cameraSourceLabel(current.projection.cameraProvenance)}`
              : " · camera authority unavailable — projection gated"}
          </div>
        </section>

        {current.projection.status === "available" ? (
          <section className="mt-4 rounded border border-slate-700 bg-slate-900 p-3">
            <h2 className="font-semibold">Read-only camera authority</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="text-slate-400">Source</dt><dd>{cameraSourceLabel(current.projection.cameraAuthority.source)}</dd></div>
              <div><dt className="text-slate-400">Receipt version</dt><dd className="font-mono">{current.projection.cameraAuthority.receiptVersion ?? "—"}</dd></div>
              <div><dt className="text-slate-400">Receipt SHA-256</dt><dd className="font-mono">{shortSha(current.projection.cameraAuthority.receiptSha256)}</dd></div>
              <div><dt className="text-slate-400">Payload checksum</dt><dd className="font-mono">{shortSha(current.projection.cameraAuthority.receiptPayloadSha256)}</dd></div>
              <div><dt className="text-slate-400">Original SHA-256</dt><dd className="font-mono">{shortSha(current.projection.cameraAuthority.originalSha256)}</dd></div>
              <div><dt className="text-slate-400">EMPTY SHA-256</dt><dd className="font-mono">{shortSha(current.projection.cameraAuthority.emptySha256)}</dd></div>
              <div><dt className="text-slate-400">TILED SHA-256</dt><dd className="font-mono">{shortSha(current.projection.cameraAuthority.tiledSha256)}</dd></div>
              <div><dt className="text-slate-400">Attempt ID</dt><dd className="font-mono">{current.projection.cameraAuthority.attemptId ?? "—"}</dd></div>
              <div><dt className="text-slate-400">Applied</dt><dd className="font-mono">{current.projection.cameraAuthority.appliedAtIso}</dd></div>
              <div><dt className="text-slate-400">World width / depth</dt><dd>{current.projection.cameraAuthority.worldWidth.toFixed(2)} m / {current.projection.cameraAuthority.worldDepth.toFixed(2)} m</dd></div>
              <div><dt className="text-slate-400">Vertical FOV</dt><dd>{current.projection.cameraAuthority.verticalFovDeg.toFixed(2)}°</dd></div>
              <div><dt className="text-slate-400">Apply frame</dt><dd>{current.projection.cameraAuthority.applyFrame.width} × {current.projection.cameraAuthority.applyFrame.height}</dd></div>
              <div><dt className="text-slate-400">Calibration version</dt><dd className="font-mono">{current.projection.cameraAuthority.calibrationVersion}</dd></div>
              <div><dt className="text-slate-400">Solver version</dt><dd className="font-mono">{current.projection.cameraAuthority.solver}</dd></div>
            </dl>
          </section>
        ) : (
          <section className="mt-4 rounded border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-100">
            <p className="font-semibold">camera authority unavailable — projection gated</p>
            <p className="mt-1 font-mono text-xs">{current.projection.reason}</p>
            <p className="mt-1 text-xs text-slate-400">{current.projection.detail}</p>
          </section>
        )}

        <div className="mt-4 grid gap-4 2xl:grid-cols-2">
          <section className="min-w-0 rounded border border-slate-700 bg-slate-900 p-3">
            <h2 className="mb-2 font-semibold">Certified EMPTY image space</h2>
            <svg
              viewBox={`0 0 ${current.dimensions.width} ${current.dimensions.height}`}
              role="img"
              aria-label={`${roomId} P2-S2D and P2-S2E blocker overlay`}
              className="block h-auto w-full bg-black"
              onClick={() => setSelectedId(null)}
            >
              <image
                href={`/api/admin/3d-room-lab/p2-s2f-world-blocker-overlay-review-image?roomId=${roomId}`}
                width={current.dimensions.width}
                height={current.dimensions.height}
              />
              {current.fragments.map(fragment => {
                const points = p2S2FImagePolyline(fragment, current.dimensions);
                const policy = policyById.get(fragment.id);
                const midpoint = points[Math.floor(points.length / 2)];
                const selected = selectedId === fragment.id;
                const serialized = points
                  .map(point => `${point.x},${point.y}`)
                  .join(" ");
                return (
                  <g key={fragment.id}>
                    {policy?.collisionPolicy === "block" ? (
                      <polyline
                        points={serialized}
                        fill="none"
                        stroke="#ef4444"
                        strokeWidth={selected ? 10 : 8}
                        strokeOpacity="0.72"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    <polyline
                      points={serialized}
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
                    {midpoint ? (
                      <text
                        x={midpoint.x}
                        y={midpoint.y - 8}
                        fill="#f8fafc"
                        fontSize="10"
                        stroke="#020617"
                        strokeWidth="2"
                        paintOrder="stroke"
                      >
                        {p2S2FShortFragmentId(fragment.id)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <p className="mt-2 text-xs text-slate-400">
              Cyan dashed: P2-S2D source. Red: P2-S2E block metadata.
            </p>
          </section>

          <section className="min-w-0 rounded border border-slate-700 bg-slate-900 p-3">
            <h2 className="mb-2 font-semibold">Calibrated world X/Z</h2>
            {current.projection.status === "available" ? (
              <svg
                viewBox={`${view.minX} ${view.minZ} ${view.extent} ${view.extent}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`${roomId} open world blocker polylines`}
                className="aspect-square h-auto w-full bg-slate-950"
                onClick={() => setSelectedId(null)}
              >
                {blockers.map(blocker => {
                  const midpoint =
                    blocker.pointsWorldXZ[Math.floor(blocker.pointsWorldXZ.length / 2)];
                  const selected = selectedId === blocker.sourceFragmentId;
                  return (
                    <g key={blocker.sourceFragmentId}>
                      <polyline
                        points={blocker.pointsWorldXZ
                          .map(point => `${point.x},${point.z}`)
                          .join(" ")}
                        fill="none"
                        stroke={selected ? "#facc15" : "#a78bfa"}
                        strokeWidth={view.extent / (selected ? 180 : 260)}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="cursor-pointer"
                        onClick={event => {
                          event.stopPropagation();
                          setSelectedId(blocker.sourceFragmentId);
                        }}
                      />
                      {midpoint ? (
                        <text
                          x={midpoint.x}
                          y={midpoint.z - labelSize * 0.5}
                          fill="#f8fafc"
                          fontSize={labelSize}
                          stroke="#020617"
                          strokeWidth={labelSize / 5}
                          paintOrder="stroke"
                        >
                          {p2S2FShortFragmentId(blocker.sourceFragmentId)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            ) : (
              <div className="grid aspect-square place-content-center bg-slate-950 p-8 text-center text-amber-200">
                <p className="font-semibold">Projection unavailable</p>
                <p className="mt-2 max-w-md font-mono text-xs">
                  {current.projection.reason}
                </p>
                <p className="mt-3 max-w-md text-xs text-slate-400">
                  No metric world coordinates are invented without a complete
                  room-bound calibrated camera authority.
                </p>
              </div>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Equal-axis top-down view. Each SVG polyline is open and keyed by
              its unchanged source fragment ID.
            </p>
          </section>
        </div>

        <section className="mt-4 overflow-x-auto rounded border border-slate-700 bg-slate-900 p-3">
          <h2 className="mb-2 font-semibold">Per-fragment diagnostics</h2>
          <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="border-b border-slate-700 p-2">Fragment ID</th>
                <th className="border-b border-slate-700 p-2">Status</th>
                <th className="border-b border-slate-700 p-2">Source points</th>
                <th className="border-b border-slate-700 p-2">World points</th>
                <th className="border-b border-slate-700 p-2">Length m</th>
                <th className="border-b border-slate-700 p-2">Min spacing m</th>
                <th className="border-b border-slate-700 p-2">Max spacing m</th>
                <th className="border-b border-slate-700 p-2">Failure</th>
                <th className="border-b border-slate-700 p-2">Point index</th>
              </tr>
            </thead>
            <tbody>
              {current.diagnostics.map(diagnostic => (
                <tr
                  key={diagnostic.sourceFragmentId}
                  className={`cursor-pointer ${
                    selectedId === diagnostic.sourceFragmentId
                      ? "bg-violet-950/50"
                      : "hover:bg-slate-800"
                  }`}
                  onClick={() => setSelectedId(diagnostic.sourceFragmentId)}
                >
                  <td className="border-b border-slate-800 p-2 font-mono">
                    {diagnostic.sourceFragmentId}
                  </td>
                  <td className="border-b border-slate-800 p-2">
                    {diagnostic.projectionStatus}
                  </td>
                  <td className="border-b border-slate-800 p-2">
                    {diagnostic.sourcePointCount}
                  </td>
                  <td className="border-b border-slate-800 p-2">
                    {diagnostic.worldPointCount}
                  </td>
                  <td className="border-b border-slate-800 p-2 font-mono">
                    {metric(diagnostic.projectedLengthMeters)}
                  </td>
                  <td className="border-b border-slate-800 p-2 font-mono">
                    {metric(diagnostic.minimumConsecutiveSpacingMeters)}
                  </td>
                  <td className="border-b border-slate-800 p-2 font-mono">
                    {metric(diagnostic.maximumConsecutiveSpacingMeters)}
                  </td>
                  <td className="border-b border-slate-800 p-2 font-mono">
                    {diagnostic.failureReason ?? "—"}
                  </td>
                  <td className="border-b border-slate-800 p-2 font-mono">
                    {diagnostic.failedPointIndex ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
