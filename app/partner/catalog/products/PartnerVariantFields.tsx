import { FIELD, SECONDARY } from "./editor-ui";

export function PartnerVariantFields(props: Readonly<{
  heading: string;
  statusLabel: "Active" | "Inactive";
  isDefault: boolean;
  modelState: string;
  finish: string;
  sku: string;
  price: string;
  currency: string;
  productUrl: string;
  disabled: boolean;
  pending: boolean;
  onFinishChange: (value: string) => void;
  onFinishCommit: () => void;
  onSkuChange: (value: string) => void;
  onSkuCommit: () => void;
  onPriceChange: (value: string) => void;
  onPriceCommit: () => void;
  onProductUrlChange: (value: string) => void;
  onProductUrlCommit: () => void;
  onRemove?: () => void;
}>) {
  return (
    <article className="space-y-3 rounded-xl border border-slate-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-50">{props.heading}</h3>
          <p className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className={props.statusLabel === "Inactive"
              ? "rounded-full border border-slate-600 px-2 py-0.5 text-slate-300"
              : "rounded-full border border-emerald-900 bg-emerald-950/50 px-2 py-0.5 text-emerald-200"}
            >
              {props.statusLabel}
            </span>
            {props.isDefault ? <span className="text-slate-400">Default</span> : null}
            {props.pending ? <span className="text-slate-400">Not published yet</span> : null}
            <span className="text-slate-400">
              <span className="sr-only">3D model: </span>
              {props.modelState}
            </span>
          </p>
        </div>
        {props.onRemove ? (
          <button type="button" className={SECONDARY} disabled={props.disabled} onClick={props.onRemove}>
            Remove variant
          </button>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs text-slate-400">
          Finish
          <input
            className={FIELD}
            value={props.finish}
            disabled={props.disabled}
            onChange={(event) => props.onFinishChange(event.target.value)}
            onBlur={props.onFinishCommit}
          />
        </label>
        <label className="block text-xs text-slate-400">
          SKU
          <input
            className={FIELD}
            value={props.sku}
            disabled={props.disabled}
            onChange={(event) => props.onSkuChange(event.target.value)}
            onBlur={props.onSkuCommit}
          />
        </label>
        <label className="block text-xs text-slate-400">
          {props.currency ? `Price (${props.currency})` : "Price"}
          <input
            className={FIELD}
            inputMode="decimal"
            value={props.price}
            disabled={props.disabled}
            onChange={(event) => props.onPriceChange(event.target.value)}
            onBlur={props.onPriceCommit}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Product URL
          <input
            className={FIELD}
            value={props.productUrl}
            disabled={props.disabled}
            onChange={(event) => props.onProductUrlChange(event.target.value)}
            onBlur={props.onProductUrlCommit}
          />
        </label>
      </div>
    </article>
  );
}
