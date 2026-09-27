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
  label?: string;
  placeholder?: string;
  options: readonly Readonly<{ assetId: string; label: string }>[];
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (assetId: string) => void;
}>) {
  const knownIndex = props.options.findIndex((option) => option.assetId === props.value);
  const known = knownIndex >= 0;
  return (
    <label className="block text-xs text-slate-400">
      {props.label ?? "3D Model"}
      <select
        className={FIELD}
        value={known ? String(knownIndex) : ""}
        disabled={props.disabled || props.options.length === 0}
        onChange={(event) => {
          if (event.target.value === "") return;
          const index = Number(event.target.value);
          if (!Number.isInteger(index) || index < 0) return;
          const next = props.options[index];
          if (!next || next.assetId === props.value) return;
          props.onChange(next.assetId);
        }}
      >
        {!known ? <option value="">{props.placeholder ?? "Choose a 3D model"}</option> : null}
        {props.options.map((option, index) => (
          <option key={`${option.label}:${index}`} value={String(index)}>{option.label}</option>
        ))}
      </select>
      {props.invalid ? (
        <span className="mt-1 block text-sm text-rose-200">This 3D model is no longer ready.</span>
      ) : null}
    </label>
  );
}
