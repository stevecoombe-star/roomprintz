"use client";

import { useMemo, useState } from "react";

import {
  filterPartnerCatalogRows,
  partnerCatalogEditorPath,
  partnerProductEditorPath,
  type PartnerCatalogEditorIntent,
  type PartnerCatalogProductRow,
  type PartnerCatalogReadinessFilter,
  type PartnerCatalogStatusFilter,
} from "@/lib/vibode-stage/partner-catalog-workspace";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300";
const PRIMARY =
  `inline-flex items-center justify-center rounded-md bg-white px-3.5 py-2 text-sm font-medium text-slate-950 hover:bg-slate-200 ${FOCUS} disabled:cursor-not-allowed disabled:opacity-60`;
const SECONDARY =
  `inline-flex items-center justify-center rounded-md border border-slate-600 px-3.5 py-2 text-sm text-slate-100 hover:border-slate-400 ${FOCUS} disabled:cursor-not-allowed disabled:opacity-60`;
const FIELD =
  `mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 ${FOCUS}`;

export function PartnerCatalogWorkspace(props: Readonly<{
  rows: readonly PartnerCatalogProductRow[];
  openDraftId: string | null;
  hasUnpublishedChanges: boolean;
  needsModelBeforeFirstProduct: boolean;
}>) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PartnerCatalogStatusFilter>("all");
  const [readiness, setReadiness] = useState<PartnerCatalogReadinessFilter>("all");
  const [pending, setPending] = useState<PartnerCatalogEditorIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtersActive = query.trim().length > 0 || status !== "all" || readiness !== "all";
  const visible = useMemo(
    () => filterPartnerCatalogRows(props.rows, { query, status, readiness }),
    [props.rows, query, readiness, status],
  );

  async function openEditor(intent: PartnerCatalogEditorIntent) {
    if (props.openDraftId) {
      window.location.assign(partnerCatalogEditorPath(props.openDraftId, intent));
      return;
    }
    setPending(intent);
    setError(null);
    try {
      const response = await fetch("/api/vibode/partner/drafts", { method: "POST" });
      const body = await response.json() as { error?: string; draft?: { draftId?: string } };
      if (!response.ok || !body.draft?.draftId) {
        setError(body.error ?? "The catalog editor could not be opened.");
        return;
      }
      window.location.assign(partnerCatalogEditorPath(body.draft.draftId, intent));
    } catch {
      setError("The catalog editor could not be opened.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-5">
      {props.hasUnpublishedChanges && props.openDraftId ? (
        <section
          aria-labelledby="unpublished-changes-heading"
          className="rounded-xl border border-amber-800/80 bg-amber-950/40 px-4 py-4"
        >
          <h2 id="unpublished-changes-heading" className="text-sm font-medium text-amber-50">
            Unpublished changes
          </h2>
          <p className="mt-1 text-sm text-amber-100/80">
            You have catalog changes that have not been published yet.
          </p>
          <a
            href={partnerCatalogEditorPath(props.openDraftId, "manage")}
            className={`mt-3 ${SECONDARY}`}
          >
            Continue editing
          </a>
        </section>
      ) : null}

      {props.rows.length > 0 ? (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(8rem,0.7fr)_minmax(9rem,0.8fr)]">
            <label className="block text-xs text-slate-400">
              Search
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, SKU, finish, or collection"
                className={FIELD}
              />
            </label>
            <label className="block text-xs text-slate-400">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as PartnerCatalogStatusFilter)}
                className={FIELD}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="block text-xs text-slate-400">
              3D model
              <select
                value={readiness}
                onChange={(event) => setReadiness(event.target.value as PartnerCatalogReadinessFilter)}
                className={FIELD}
              >
                <option value="all">All</option>
                <option value="ready">Ready</option>
                <option value="no_model">No model</option>
                <option value="needs_attention">Needs attention</option>
              </select>
            </label>
          </div>
          <CatalogEditorActions
            openDraftId={props.openDraftId}
            pending={pending}
            onOpen={(intent) => void openEditor(intent)}
          />
        </div>
      ) : null}

      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}

      {props.rows.length === 0 ? (
        <CatalogEmptyState
          needsModel={props.needsModelBeforeFirstProduct}
          openDraftId={props.openDraftId}
          pending={pending}
          onOpen={(intent) => void openEditor(intent)}
        />
      ) : (
        <section aria-label="Products" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p aria-live="polite" className="text-xs text-slate-500">
              {filtersActive
                ? `Showing ${visible.length} of ${props.rows.length} products`
                : `${props.rows.length} ${props.rows.length === 1 ? "product" : "products"}`}
            </p>
            {filtersActive ? (
              <button
                type="button"
                className="text-xs text-slate-300 underline-offset-2 hover:underline"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setReadiness("all");
                }}
              >
                Clear search and filters
              </button>
            ) : null}
          </div>
          {visible.length === 0 ? (
            <p className="rounded-xl border border-slate-800 px-4 py-8 text-sm text-slate-300">
              No products match your search or filters.
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((row) => (
                <li key={row.productKey}>
                  <CatalogProductRow row={row} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function CatalogEditorActions(props: Readonly<{
  openDraftId: string | null;
  pending: PartnerCatalogEditorIntent | null;
  onOpen: (intent: PartnerCatalogEditorIntent) => void;
}>) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.openDraftId ? (
        <a href={partnerCatalogEditorPath(props.openDraftId, "manage")} className={SECONDARY}>
          Continue editing
        </a>
      ) : (
        <button
          type="button"
          className={SECONDARY}
          disabled={props.pending != null}
          onClick={() => props.onOpen("manage")}
        >
          {props.pending === "manage" ? "Opening…" : "Manage catalog"}
        </button>
      )}
      <AddProductControl
        openDraftId={props.openDraftId}
        pending={props.pending}
        onOpen={props.onOpen}
      />
    </div>
  );
}

function AddProductControl(props: Readonly<{
  openDraftId: string | null;
  pending: PartnerCatalogEditorIntent | null;
  onOpen: (intent: PartnerCatalogEditorIntent) => void;
}>) {
  if (props.openDraftId) {
    return (
      <a href={partnerCatalogEditorPath(props.openDraftId, "add-product")} className={PRIMARY}>
        Add product
      </a>
    );
  }
  return (
    <button
      type="button"
      className={PRIMARY}
      disabled={props.pending != null}
      onClick={() => props.onOpen("add-product")}
    >
      {props.pending === "add-product" ? "Opening…" : "Add product"}
    </button>
  );
}

function CatalogEmptyState(props: Readonly<{
  needsModel: boolean;
  openDraftId: string | null;
  pending: PartnerCatalogEditorIntent | null;
  onOpen: (intent: PartnerCatalogEditorIntent) => void;
}>) {
  if (props.needsModel) {
    return (
      <section className="rounded-xl border border-slate-800 px-5 py-10">
        <h2 className="text-lg font-medium">No products yet</h2>
        <p className="mt-2 max-w-lg text-sm text-slate-300">
          A 3D model is needed before your first product can be added.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <a href="/partner/assets" className={PRIMARY}>Go to 3D Models</a>
          {props.openDraftId ? (
            <a href={partnerCatalogEditorPath(props.openDraftId, "manage")} className={SECONDARY}>
              Continue editing
            </a>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-800 px-5 py-10">
      <h2 className="text-lg font-medium">No products yet</h2>
      <p className="mt-2 max-w-lg text-sm text-slate-300">
        Add your first product to start building your Vibode catalog.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <AddProductControl
          openDraftId={props.openDraftId}
          pending={props.pending}
          onOpen={props.onOpen}
        />
        {props.openDraftId ? (
          <a href={partnerCatalogEditorPath(props.openDraftId, "manage")} className={SECONDARY}>
            Continue editing
          </a>
        ) : null}
      </div>
    </section>
  );
}

function CatalogProductRow(props: Readonly<{ row: PartnerCatalogProductRow }>) {
  const row = props.row;
  const image = row.imageUrl.trim();
  const readinessClass = row.readiness === "ready"
    ? "text-emerald-200"
    : row.readiness === "needs_attention"
      ? "text-amber-200"
      : "text-slate-400";
  return (
    <article className="relative flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:flex-row">
      <div className="h-28 w-full shrink-0 overflow-hidden rounded-lg bg-slate-800 sm:h-24 sm:w-24">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- partner catalog images are durable remote or public URLs
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">No image</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-medium text-slate-50">
            <a
              href={partnerProductEditorPath(row.productKey)}
              className={`rounded-sm after:absolute after:inset-0 hover:underline ${FOCUS}`}
            >
              {row.name}
            </a>
          </h2>
          <p className="text-sm text-slate-200">{row.priceLabel || "Price on request"}</p>
        </div>
        {row.variantSummary ? (
          <p className="mt-1 text-sm text-slate-400">{row.variantSummary}</p>
        ) : null}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={row.status === "inactive"
            ? "rounded-full border border-slate-600 px-2 py-0.5 text-slate-300"
            : "rounded-full border border-emerald-900 bg-emerald-950/50 px-2 py-0.5 text-emerald-200"}
          >
            {row.statusLabel}
          </span>
          <span className="text-slate-400">{row.variantCountLabel}</span>
          <span className={readinessClass}>
            <span className="sr-only">3D model: </span>
            {row.readinessLabel}
          </span>
        </p>
        {row.collectionNames.length > 0 ? (
          <ul aria-label="Collections" className="mt-3 flex flex-wrap gap-1.5">
            {row.collectionNames.map((name, index) => (
              <li
                key={`${name}-${index}`}
                className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
              >
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}
