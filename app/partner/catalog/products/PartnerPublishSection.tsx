import type { PartnerProductChangeLine } from "@/lib/vibode-stage/partner-product-editor";

import { PRIMARY, SECONDARY } from "./editor-ui";

function ChangeList(props: Readonly<{ changes: readonly PartnerProductChangeLine[] }>) {
  if (props.changes.length === 0) {
    return <p className="text-sm text-slate-400">No unpublished changes.</p>;
  }
  return (
    <ul className="space-y-2 text-sm text-slate-100">
      {props.changes.map((change) => (
        <li key={`${change.label}:${change.previous}:${change.next}`}>
          <span className="text-slate-400">{change.label}:</span>
          {" "}
          {change.previous}
          {" → "}
          {change.next}
        </li>
      ))}
    </ul>
  );
}

export function PartnerPublishSection(props: Readonly<{
  productChanges: readonly PartnerProductChangeLine[];
  otherLines: readonly string[];
  issues: readonly string[];
  reviewed: boolean;
  canPublish: boolean;
  canReview: boolean;
  reviewing: boolean;
  publishing: boolean;
  onReview: () => void;
  onPublish: () => void;
}>) {
  return (
    <section id="product-publishing" aria-labelledby="product-publishing-heading" className="space-y-4 rounded-xl border border-slate-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="product-publishing-heading" className="text-lg font-medium">Publishing</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} disabled={!props.canReview || props.reviewing || props.publishing} onClick={props.onReview}>
            {props.reviewing ? "Reviewing…" : "Review changes"}
          </button>
          <button type="button" className={PRIMARY} disabled={!props.canPublish || props.publishing} onClick={props.onPublish}>
            {props.publishing ? "Publishing…" : "Publish changes"}
          </button>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-slate-100">This product’s unpublished changes</h3>
        <div className="mt-2">
          <ChangeList changes={props.productChanges} />
        </div>
        {!props.reviewed && props.productChanges.length > 0 ? (
          <p className="mt-2 text-sm text-slate-400">Review changes before publishing.</p>
        ) : null}
      </div>
      {props.otherLines.length > 0 ? (
        <div className="rounded-lg border border-amber-800/80 bg-amber-950/40 px-3 py-3">
          <h3 className="text-sm font-medium text-amber-50">Also included in this publish</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-100">
            {props.otherLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ) : null}
      {props.issues.length > 0 ? (
        <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-3">
          <h3 className="text-sm font-medium text-rose-100">These changes need attention</h3>
          <ul className="mt-2 space-y-1 text-sm text-rose-100">
            {props.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
