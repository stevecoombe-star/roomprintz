"use client";

import { useState } from "react";

import {
  PARTNER_MODEL_LIBRARY_CATALOG_HREF,
  PARTNER_MODEL_LIBRARY_UNUSED,
  filterPartnerModelLibrary,
  modelThumbnailVisual,
  partnerModelLibraryEmptyFilterMessage,
  type PartnerModelLibraryItem,
  type PartnerModelLibraryStatusFilter,
} from "@/lib/vibode-stage/partner-model-library";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300";
const PRIMARY =
  `inline-flex items-center justify-center rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-slate-200 ${FOCUS}`;
const SECONDARY =
  `inline-flex items-center justify-center rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:border-slate-400 ${FOCUS}`;
const FIELD =
  `mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 ${FOCUS}`;

const VISIBLE_USES = 5;

function stateClass(state: PartnerModelLibraryItem["state"]): string {
  if (state === "ready") return "text-emerald-300";
  if (state === "needs_attention") return "text-rose-300";
  return "text-slate-300";
}

function metaLine(item: PartnerModelLibraryItem): string | null {
  const parts: string[] = [];
  if (item.uploadedLabel) parts.push(`Uploaded ${item.uploadedLabel}`);
  if (item.fileSizeLabel) parts.push(item.fileSizeLabel);
  if (item.dimensionsLabel) parts.push(item.dimensionsLabel);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function TechnicalDetails({ item }: { item: PartnerModelLibraryItem }) {
  const technical = item.technical;
  return (
    <div className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
      <p className="font-medium text-slate-300">Technical details</p>
      {technical.sourceLabel ? <p>Source: {technical.sourceLabel}</p> : null}
      {technical.dimensionsLabel ? <p>Dimensions: {technical.dimensionsLabel}</p> : null}
      {technical.shaPrefix ? <p className="break-all font-mono text-[11px]">SHA {technical.shaPrefix}</p> : null}
      {technical.assetStatus ? <p>Asset status: {technical.assetStatus}</p> : null}
      {technical.intakeStatus ? <p>Intake status: {technical.intakeStatus}</p> : null}
      {technical.assetId ? <p className="break-all font-mono text-[11px]">Asset ID {technical.assetId}</p> : null}
      {technical.intakeId ? <p className="break-all font-mono text-[11px]">Intake ID {technical.intakeId}</p> : null}
      {technical.errorCode ? <p className="font-mono text-[11px] text-rose-300">{technical.errorCode}</p> : null}
      {technical.errorDetail ? <p>{technical.errorDetail}</p> : null}
    </div>
  );
}

function ModelThumbnail({ url, label }: { url: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  const visual = modelThumbnailVisual(url, failed);
  return (
    <div
      className="h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-stone-200"
      data-model-thumbnail={visual}
    >
      {visual === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- persisted catalog thumbnail, not a live GLB
        <img
          src={url ?? ""}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <ModelThumbnailPlaceholder label={label} />
      )}
    </div>
  );
}

function ModelThumbnailPlaceholder({ label }: { label: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className="h-full w-full p-3 text-slate-500"
      role="img"
      aria-label={`${label} preview`}
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
        <path d="M32 16 L48 24 L32 32 L16 24 Z" />
        <path d="M16 24 L16 40 L32 48 L32 32" />
        <path d="M48 24 L48 40 L32 48" />
      </g>
    </svg>
  );
}

function ModelRow(props: Readonly<{
  item: PartnerModelLibraryItem;
  technicalOpen: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const showTechnical = props.technicalOpen || open;
  const visibleUses = props.item.uses.slice(0, VISIBLE_USES);
  const hiddenUses = props.item.uses.length - visibleUses.length;
  const meta = metaLine(props.item);
  return (
    <li className="min-w-0 rounded-xl border border-slate-800 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <ModelThumbnail url={props.item.thumbnailUrl} label={props.item.fileName} />
        <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-all font-medium text-slate-100">{props.item.fileName}</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {props.item.unused ? (
            <span className="rounded-full border border-slate-600 px-2 py-0.5 text-xs text-slate-300">
              {PARTNER_MODEL_LIBRARY_UNUSED}
            </span>
          ) : null}
          <span className={stateClass(props.item.state)}>{props.item.stateLabel}</span>
        </div>
      </div>
      {props.item.attentionMessage ? (
        <p className="mt-2 text-sm text-rose-200">{props.item.attentionMessage}</p>
      ) : null}
      {props.item.processingMessage ? (
        <p className="mt-2 text-sm text-slate-400">{props.item.processingMessage}</p>
      ) : null}
      {visibleUses.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {visibleUses.map((use) => (
            <li key={`${use.viewProductHref}:${use.variantLabel ?? ""}`} className="text-sm">
              <p className="text-slate-100">{use.productName}</p>
              {use.variantLabel ? <p className="text-slate-400">{use.variantLabel}</p> : null}
              <a href={use.viewProductHref} className={`mt-1 ${SECONDARY}`}>
                View product
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {hiddenUses > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Also used by {hiddenUses} more {hiddenUses === 1 ? "variant" : "variants"}.
        </p>
      ) : null}
      {meta ? <p className="mt-3 text-xs text-slate-500">{meta}</p> : null}
      {props.item.state === "needs_attention" && props.item.uses.length === 0 ? (
        <a href={PARTNER_MODEL_LIBRARY_CATALOG_HREF} className={`mt-3 ${SECONDARY}`}>
          Try again
        </a>
      ) : null}
      <div className="mt-3">
        <button
          type="button"
          className="text-xs text-slate-400 underline"
          aria-expanded={showTechnical}
          onClick={() => setOpen((current) => !current)}
        >
          Technical details
        </button>
        {showTechnical ? <TechnicalDetails item={props.item} /> : null}
      </div>
        </div>
      </div>
    </li>
  );
}

export function PartnerModelLibrary(props: Readonly<{
  items: readonly PartnerModelLibraryItem[];
  loaded: boolean;
  loadError: string | null;
  associationsKnown: boolean;
  query: string;
  status: PartnerModelLibraryStatusFilter;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: PartnerModelLibraryStatusFilter) => void;
  onClearFilters: () => void;
  technicalOpen?: boolean;
}>) {
  const filtersActive = props.query.trim().length > 0 || props.status !== "all";
  const visible = filterPartnerModelLibrary(props.items, {
    query: props.query,
    status: props.status,
  });
  const showEmpty = props.loaded && !props.loadError && props.items.length === 0;
  const showNoMatch = props.loaded && props.items.length > 0 && visible.length === 0;

  return (
    <div className="space-y-5">
      {props.loadError ? <p className="text-sm text-rose-300">{props.loadError}</p> : null}
      {!props.loaded ? <p className="text-sm text-slate-400">Loading 3D models…</p> : null}
      {props.loaded && !props.associationsKnown && props.items.length > 0 ? (
        <p className="text-xs text-slate-500">Product links could not be loaded.</p>
      ) : null}
      {props.loaded && props.items.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(10rem,0.7fr)]">
          <label className="block text-xs text-slate-400">
            Search
            <input
              type="search"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
              placeholder="Filename, product, finish, or SKU"
              className={FIELD}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Status
            <select
              value={props.status}
              onChange={(event) => props.onStatusChange(event.target.value as PartnerModelLibraryStatusFilter)}
              className={FIELD}
            >
              <option value="all">All</option>
              <option value="ready">Ready</option>
              <option value="processing">Processing</option>
              <option value="needs_attention">Needs attention</option>
              <option value="unused">Unused</option>
            </select>
          </label>
        </div>
      ) : null}
      {showEmpty ? (
        <section className="rounded-xl border border-slate-800 px-4 py-8 text-center">
          <h2 className="text-base font-medium">No 3D models yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Upload a GLB while adding or editing a Product Variant.
          </p>
          <a href={PARTNER_MODEL_LIBRARY_CATALOG_HREF} className={`mt-4 ${PRIMARY}`}>
            Open Catalog
          </a>
        </section>
      ) : null}
      {showNoMatch ? (
        <section className="rounded-xl border border-slate-800 px-4 py-8 text-center">
          <h2 className="text-base font-medium">
            {partnerModelLibraryEmptyFilterMessage(props.status, props.query)}
          </h2>
          {filtersActive ? (
            <button type="button" className={`mt-4 ${SECONDARY}`} onClick={props.onClearFilters}>
              Clear filters
            </button>
          ) : null}
        </section>
      ) : null}
      {visible.length > 0 ? (
        <ul className="min-w-0 space-y-3">
          {visible.map((item) => (
            <ModelRow key={item.key} item={item} technicalOpen={props.technicalOpen === true} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
