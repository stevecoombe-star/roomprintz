"use client";

import { useStageEditor } from "@/components/stage/StageEditorContext";
import {
  buildStageSummary,
  formatEstimatedTotal,
  formatSummaryQuantityPrice,
  summaryItemCountLabel,
} from "@/lib/vibode-stage/summary";
import { STAGE_SUMMARY_WIDTH_PX } from "@/lib/vibode-stage/types";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

export function StageSummaryDrawer() {
  const stage = useStageEditor();
  const summary = buildStageSummary({
    objects: stage.objects,
    extraProducts: stage.extraProducts,
    extraVariants: stage.extraVariants,
    catalog: stage.catalog,
  });

  return (
    <aside
      className={`flex h-full shrink-0 flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950/95 transition-[width] duration-200 ${
        stage.summaryOpen ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ width: stage.summaryOpen ? STAGE_SUMMARY_WIDTH_PX : 0 }}
      data-stage-summary={stage.summaryOpen ? "open" : "closed"}
      aria-hidden={!stage.summaryOpen}
    >
      <div className="flex min-h-0 w-[340px] flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="text-sm font-medium text-neutral-100">Summary</div>
          <button
            type="button"
            aria-label="Close summary"
            onClick={stage.closeSummary}
            className={`rounded-md px-1.5 py-0.5 text-neutral-400 hover:text-neutral-100 ${FOCUS}`}
          >
            ×
          </button>
        </div>
        <div className="px-4 text-xs text-neutral-400">
          {summaryItemCountLabel(summary.itemCount)}
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {summary.lines.length === 0 ? (
            <div className="py-8 text-xs text-neutral-500">
              Nothing placed in this version yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {summary.lines.map((line) => (
                <li
                  key={line.key}
                  className="flex gap-3 border-b border-neutral-800/80 pb-3"
                  data-stage-summary-line={line.key}
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-neutral-800">
                    {line.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- summary thumbs follow catalog sources
                      <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] uppercase tracking-wide text-neutral-500">
                      {line.brand}
                    </div>
                    <div className="truncate text-xs text-neutral-100">{line.name}</div>
                    {line.variantLabel ? (
                      <div className="truncate text-[11px] text-neutral-500">{line.variantLabel}</div>
                    ) : null}
                    <div className="mt-0.5 text-xs text-neutral-300">
                      {formatSummaryQuantityPrice(line.unitPrice, line.currency, line.quantity)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sticky bottom-0 border-t border-neutral-800 bg-neutral-950 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400">Estimated total</span>
            <span className="text-neutral-100">
              {formatEstimatedTotal(summary.estimatedTotal, summary.currency)}
            </span>
          </div>
          <button
            type="button"
            disabled={!summary.shoppable}
            className={`mt-3 w-full rounded-md border px-3 py-2 text-xs ${FOCUS} ${
              summary.shoppable
                ? "border-neutral-600 bg-neutral-100 text-neutral-950 hover:bg-white"
                : "border-neutral-800 bg-neutral-950 text-neutral-600"
            }`}
          >
            Shop This Room
          </button>
        </div>
      </div>
    </aside>
  );
}
