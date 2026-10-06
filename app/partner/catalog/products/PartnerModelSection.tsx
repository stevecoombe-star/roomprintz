import {
  partnerDisplayedModelThumbnail,
  type PartnerVariantModelPresentation,
} from "@/lib/vibode-stage/partner-product-editor";

import { PartnerModelThumbnail } from "../../PartnerModelThumbnail";
import { FIELD } from "./editor-ui";

function modelStatusLabel(stateLabel: PartnerVariantModelPresentation["stateLabel"]): string {
  return stateLabel === "No 3D model" ? "No model uploaded" : stateLabel;
}

export function partnerVariantModelCardDetail(
  detail: string | null,
  productName: string,
  finish: string,
): string | null {
  const text = detail?.trim() ?? "";
  if (!text) return null;
  const product = productName.trim();
  const variant = finish.trim();
  if (product && variant && text === `${product} · ${variant}`) return null;
  if (product && text === product) return null;
  if (variant && text === variant) return null;
  return text;
}

export function PartnerVariantModelSummary(props: Readonly<{
  presentation: PartnerVariantModelPresentation;
  productName: string;
  finish: string;
}>) {
  const detail = partnerVariantModelCardDetail(
    props.presentation.detail,
    props.productName,
    props.finish,
  );
  const note = props.presentation.stateLabel === "No 3D model" ? props.presentation.note : null;
  const thumbnail = partnerDisplayedModelThumbnail({
    stateLabel: props.presentation.stateLabel,
    filename: props.presentation.filename,
    thumbnailUrl: props.presentation.thumbnailUrl,
  });
  return (
    <div className={thumbnail ? "flex min-w-0 items-start gap-3" : "min-w-0"}>
      {thumbnail ? (
        <PartnerModelThumbnail key={thumbnail.url ?? thumbnail.label} url={thumbnail.url} label={thumbnail.label} />
      ) : null}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">3D Model</p>
        <p className="mt-1 text-sm text-slate-100">{modelStatusLabel(props.presentation.stateLabel)}</p>
        {props.presentation.filename ? (
          <p className="mt-0.5 break-all text-sm text-slate-300">{props.presentation.filename}</p>
        ) : null}
        {detail ? <p className="mt-0.5 break-words text-sm text-slate-400">{detail}</p> : null}
        {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
      </div>
    </div>
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
