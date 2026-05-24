"use client";

import { useMemo } from "react";
import {
  getImageHistoryForVersion,
  type ImageHistoryTimelineKind,
} from "@/lib/vibode/image-history-timeline";
import { getVibodeVersionKind } from "@/lib/vibode/version-kind";
import type { VibodeRoomAsset } from "@/stores/editorStore";

type ImageHistoryTimelineProps = {
  activeVersionId: string | null;
  versions: VibodeRoomAsset[];
  className?: string;
};

function getVersionKind(version: VibodeRoomAsset): ImageHistoryTimelineKind {
  const normalized = version.normalizedVersionKind;
  if (
    normalized === "set" ||
    normalized === "stage" ||
    normalized === "style" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return getVibodeVersionKind(version);
}

function getVersionLabel(version: VibodeRoomAsset): string {
  if (version.asset_type === "base") return "ORIGINAL";
  const kind = getVersionKind(version);
  if (kind === "set") return "SET";
  if (kind === "stage") return "STAGE";
  if (kind === "style") return "STYLE";
  return "UNKNOWN";
}

function getPreviewUrl(version: VibodeRoomAsset): string | null {
  const preview = typeof version.preview_url === "string" ? version.preview_url.trim() : "";
  if (preview) return preview;
  const image = typeof version.image_url === "string" ? version.image_url.trim() : "";
  return image || null;
}

function formatChildSummary(kind: ImageHistoryTimelineKind, count: number): string {
  if (kind === "style") {
    return count > 0 ? `${count} STYLE image${count === 1 ? "" : "s"}` : "No STYLE images yet";
  }
  if (kind === "stage") {
    return count > 0 ? `${count} STAGE image${count === 1 ? "" : "s"}` : "No STAGE images yet";
  }
  if (kind === "set") {
    return count > 0 ? `${count} SET image${count === 1 ? "" : "s"}` : "No SET images yet";
  }
  return `${count} OTHER image${count === 1 ? "" : "s"}`;
}

function TimelineVersionCard(props: {
  version: VibodeRoomAsset;
  isActive?: boolean;
}) {
  const previewUrl = getPreviewUrl(props.version);
  return (
    <div
      className={`flex min-w-[118px] items-center gap-2 rounded-md border bg-neutral-950/60 px-2 py-1.5 ${
        props.isActive
          ? "border-sky-400/70 ring-1 ring-sky-400/50"
          : "border-neutral-800"
      }`}
    >
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded border border-neutral-800 bg-neutral-900">
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- timeline thumbnails are dynamic signed/storage URLs */}
            <img src={previewUrl} alt={getVersionLabel(props.version)} className="h-full w-full object-cover" />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">IMG</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-neutral-200">{getVersionLabel(props.version)}</div>
        {props.isActive ? (
          <div className="mt-0.5 inline-flex rounded-full border border-sky-400/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-100">
            On canvas
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ImageHistoryTimeline({
  activeVersionId,
  versions,
  className,
}: ImageHistoryTimelineProps) {
  const timeline = useMemo(
    () => getImageHistoryForVersion(activeVersionId, versions),
    [activeVersionId, versions]
  );
  const visibleChildSummary = useMemo(
    () => timeline?.childCountSummary.filter((entry) => entry.kind !== "unknown" || entry.count > 0) ?? [],
    [timeline]
  );

  if (!timeline) return null;

  return (
    <section className={className}>
      <div className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2">
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-2">
            <div className="pr-1 text-xs font-medium text-neutral-300">Image History</div>
            {timeline.ancestors.map((ancestor) => (
              <div key={`ancestor-${ancestor.id}`} className="flex items-center gap-2">
                <TimelineVersionCard version={ancestor} />
                <span className="text-xs text-neutral-500">→</span>
              </div>
            ))}

            <TimelineVersionCard version={timeline.active} isActive />
            <span className="text-xs text-neutral-500">→</span>

            <div className="min-w-[252px] rounded-md border border-neutral-800 bg-neutral-950/60 px-2.5 py-1.5">
              <div className="mb-1 text-[11px] font-medium text-neutral-300">Direct children</div>
              <div className="flex flex-wrap gap-1.5">
                {visibleChildSummary.map((entry) => (
                  <span
                    key={`summary-${entry.kind}`}
                    className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-300"
                  >
                    {formatChildSummary(entry.kind, entry.count)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
