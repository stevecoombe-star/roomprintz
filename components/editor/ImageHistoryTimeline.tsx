"use client";

import { useMemo, useState } from "react";
import { getImageHistoryWorkflowGroups, type ImageHistoryTimelineKind } from "@/lib/vibode/image-history-timeline";
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

function kindToWorkflowLabel(kind: ImageHistoryTimelineKind): "SET" | "STAGE" | "STYLE" | "UNKNOWN" {
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

function formatChildSummaryLabel(kind: ImageHistoryTimelineKind, count: number): string {
  const workflowLabel = kindToWorkflowLabel(kind);
  return `${count} ${workflowLabel} image${count === 1 ? "" : "s"}`;
}

function formatChildZeroState(kind: ImageHistoryTimelineKind | null): string {
  if (kind === "set") return "No SET images yet";
  if (kind === "stage") return "No STAGE images yet";
  if (kind === "style") return "No STYLE images yet";
  return "No images yet";
}

function TimelineVersionCard(props: {
  version: VibodeRoomAsset;
  isActive?: boolean;
  isRepresentative?: boolean;
}) {
  const previewUrl = getPreviewUrl(props.version);
  const versionLabel = getVersionLabel(props.version);
  return (
    <div
      className={`flex min-w-[52px] items-center justify-center gap-2 rounded-md border bg-neutral-950/60 px-1.5 py-1.5 ${
        props.isActive
          ? "border-sky-400/70 ring-1 ring-sky-400/50"
          : props.isRepresentative
            ? "border-neutral-500/80 ring-1 ring-neutral-400/55"
          : "border-neutral-800"
      }`}
    >
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded border border-neutral-800 bg-neutral-900">
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- timeline thumbnails are dynamic signed/storage URLs */}
            <img src={previewUrl} alt={versionLabel} className="h-full w-full object-cover" />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">IMG</div>
        )}
      </div>
      {props.isActive ? (
        <div className="inline-flex rounded-full border border-sky-400/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-100">
          On canvas
        </div>
      ) : null}
    </div>
  );
}

export function ImageHistoryTimeline({
  activeVersionId,
  versions,
  className,
}: ImageHistoryTimelineProps) {
  const timeline = useMemo(
    () => getImageHistoryWorkflowGroups(activeVersionId, versions),
    [activeVersionId, versions]
  );
  const [expandedByKey, setExpandedByKey] = useState<Record<string, boolean>>({});

  if (!timeline) return null;
  const activeKind = getVersionKind(timeline.active);
  const primaryChildSummary = timeline.childSummary.displayKind
    ? timeline.childSummary.groupedChildren.find((entry) => entry.kind === timeline.childSummary.displayKind) ?? null
    : null;
  const childSummaryItemsExpanded = timeline.childSummary.groupedChildren.flatMap((entry) => entry.items);
  const isStyleVariationsMode = activeKind === "style";
  const childSummaryCollapsedLabel = isStyleVariationsMode
    ? `${timeline.childSummary.totalChildren} VARIATION${timeline.childSummary.totalChildren === 1 ? "" : "S"}`
    : primaryChildSummary && primaryChildSummary.items.length > 0
      ? formatChildSummaryLabel(primaryChildSummary.kind, primaryChildSummary.items.length)
      : formatChildZeroState(timeline.childSummary.displayKind);
  const isChildSummaryExpanded =
    expandedByKey.children === true && timeline.childSummary.isExpandable && timeline.childSummary.totalChildren > 0;
  const shouldShowChildSummary = !(activeKind === "style" && timeline.childSummary.totalChildren === 0);

  return (
    <section className={className}>
      <div className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2">
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-2.5">
            <div className="pr-1 text-xs font-medium text-neutral-300">Image History</div>
            {timeline.groups.map((group, index) => (
              <div key={`group-${group.key}`} className="flex items-center gap-1.5">
                <div className="rounded-md border border-neutral-800 bg-neutral-950/55 px-1.5 py-1">
                  <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
                    <span className="text-[10px] font-semibold tracking-[0.08em] text-neutral-400">{group.label}</span>
                    {group.isExpandable ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedByKey((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                        }
                        aria-label={expandedByKey[group.key] ? `Collapse ${group.label}` : `Expand ${group.label}`}
                        aria-expanded={expandedByKey[group.key] === true}
                        className="rounded border border-neutral-700 bg-neutral-900 px-1 text-[10px] text-neutral-300"
                      >
                        {expandedByKey[group.key] ? "▾" : "▸"}
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(expandedByKey[group.key] && group.isExpandable ? group.items : [group.representative]).map(
                      (version) => (
                        <TimelineVersionCard
                          key={`${group.key}-${version.id}`}
                          version={version}
                          isActive={version.id === timeline.active.id}
                          isRepresentative={
                            expandedByKey[group.key] === true &&
                            group.isExpandable &&
                            version.id === group.representative.id &&
                            version.id !== timeline.active.id
                          }
                        />
                      )
                    )}
                  </div>
                </div>
                {index < timeline.groups.length - 1 || shouldShowChildSummary ? (
                  <span className="text-xs text-neutral-500">→</span>
                ) : null}
              </div>
            ))}

            {shouldShowChildSummary ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="text-[11px] font-medium text-neutral-300">{childSummaryCollapsedLabel}</div>
                  {timeline.childSummary.isExpandable && timeline.childSummary.totalChildren > 0 ? (
                    <button
                      type="button"
                      onClick={() => setExpandedByKey((prev) => ({ ...prev, children: !prev.children }))}
                      aria-label={isChildSummaryExpanded ? "Collapse direct children" : "Expand direct children"}
                      aria-expanded={isChildSummaryExpanded}
                      className="rounded border border-neutral-700 bg-neutral-900 px-1 text-[10px] text-neutral-300"
                    >
                      {isChildSummaryExpanded ? "▾" : "▸"}
                    </button>
                  ) : null}
                  {isChildSummaryExpanded ? (
                    childSummaryItemsExpanded.map((version) => (
                      <TimelineVersionCard
                        key={`children-expanded-${version.id}`}
                        version={version}
                        isActive={version.id === timeline.active.id}
                      />
                    ))
                  ) : timeline.childSummary.representative ? (
                    <TimelineVersionCard version={timeline.childSummary.representative} isActive={false} />
                  ) : (
                    <div className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[10px] text-neutral-500">
                      {formatChildZeroState(timeline.childSummary.displayKind)}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
