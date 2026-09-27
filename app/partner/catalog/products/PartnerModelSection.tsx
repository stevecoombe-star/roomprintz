import type { PartnerVariantModelPresentation } from "@/lib/vibode-stage/partner-product-editor";

import { FIELD } from "./editor-ui";

export function PartnerModelBlock(props: Readonly<{
  heading: string;
  presentation: PartnerVariantModelPresentation;
}>) {
  return (
    <article className="rounded-xl border border-slate-800 p-4">
      <h3 className="text-sm font-medium text-slate-50">{props.heading}</h3>
      <p className="mt-2 text-xs uppercase tracking-wide text-slate-500">3D Model</p>
      <p className="mt-1 text-sm text-slate-100">{props.presentation.stateLabel}</p>
      {props.presentation.filename ? (
        <p className="mt-1 text-sm text-slate-300">{props.presentation.filename}</p>
      ) : null}
      {props.presentation.detail ? (
        <p className="mt-1 text-sm text-slate-400">{props.presentation.detail}</p>
      ) : null}
      {props.presentation.note ? (
        <p className="mt-3 text-sm text-slate-400">{props.presentation.note}</p>
      ) : null}
    </article>
  );
}

export function PartnerModelSelect(props: Readonly<{
  options: readonly Readonly<{ assetId: string; label: string }>[];
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (assetId: string) => void;
}>) {
  const known = props.options.some((option) => option.assetId === props.value);
  return (
    <label className="block text-xs text-slate-400">
      3D Model
      <select
        className={FIELD}
        value={known ? props.value : ""}
        disabled={props.disabled || props.options.length === 0}
        onChange={(event) => {
          const next = event.target.value;
          if (!next || next === props.value) return;
          props.onChange(next);
        }}
      >
        {!known ? <option value="">Choose a 3D model</option> : null}
        {props.options.map((option) => (
          <option key={option.assetId} value={option.assetId}>{option.label}</option>
        ))}
      </select>
      {props.invalid ? (
        <span className="mt-1 block text-sm text-rose-200">This 3D model is no longer ready.</span>
      ) : null}
    </label>
  );
}
