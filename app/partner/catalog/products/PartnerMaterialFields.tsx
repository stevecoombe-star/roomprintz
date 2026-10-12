import { useId } from "react";

import { FIELD } from "./editor-ui";
import type { VariantMaterialMode } from "@/lib/vibode-stage/material-text";

const HINT = "Optional. Keep the fabric, finish, or color name exactly as it should appear.";

export function PartnerProductMaterialFields(props: Readonly<{
  primary: string;
  secondary: string;
  disabled: boolean;
  primaryPending?: boolean;
  secondaryPending?: boolean;
  onPrimaryChange: (value: string) => void;
  onPrimaryCommit: () => void;
  onSecondaryChange: (value: string) => void;
  onSecondaryCommit: () => void;
}>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MaterialText
        label="Primary Material / Finish"
        pending={props.primaryPending}
        value={props.primary}
        disabled={props.disabled}
        onChange={props.onPrimaryChange}
        onCommit={props.onPrimaryCommit}
      />
      <MaterialText
        label="Secondary Material / Finish"
        pending={props.secondaryPending}
        value={props.secondary}
        disabled={props.disabled}
        onChange={props.onSecondaryChange}
        onCommit={props.onSecondaryCommit}
      />
    </div>
  );
}

function MaterialText(props: Readonly<{
  label: string;
  value: string;
  disabled: boolean;
  pending?: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}>) {
  return (
    <label className="block text-xs text-slate-400">
      {props.label} {props.pending ? <span className="text-amber-300">pending</span> : null}
      <input
        className={FIELD}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        onBlur={props.onCommit}
      />
      <span className="mt-1 block text-[11px] text-slate-500">{HINT}</span>
    </label>
  );
}

export function PartnerVariantMaterialControl(props: Readonly<{
  label: string;
  mode: VariantMaterialMode;
  text: string;
  inherited: string;
  disabled: boolean;
  pending?: boolean;
  onModeChange: (mode: VariantMaterialMode) => void;
  onTextChange: (value: string) => void;
  onCommit: () => void;
}>) {
  const inherited = props.inherited.trim();
  const groupName = useId();
  const modes: readonly Readonly<{ mode: VariantMaterialMode; label: string }>[] = [
    { mode: "inherit", label: "Use product default" },
    { mode: "custom", label: "Custom description" },
    { mode: "none", label: "No material" },
  ];
  return (
    <div className="block text-xs text-slate-400">
      <span>
        {props.label} {props.pending ? <span className="text-amber-300">pending</span> : null}
      </span>
      <div role="radiogroup" aria-label={props.label} className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {modes.map((choice) => (
          <label key={choice.mode} className="inline-flex items-center gap-1.5 text-slate-200">
            <input
              type="radio"
              name={groupName}
              value={choice.mode}
              checked={props.mode === choice.mode}
              disabled={props.disabled}
              onChange={() => props.onModeChange(choice.mode)}
            />
            {choice.label}
          </label>
        ))}
      </div>
      {props.mode === "inherit" ? (
        <span className="mt-1 block text-[11px] text-slate-500">
          {inherited ? `Product default: ${inherited}` : "This product has no default."}
        </span>
      ) : null}
      {props.mode === "none" ? (
        <span className="mt-1 block text-[11px] text-slate-500">
          This variant will not use a material description.
        </span>
      ) : null}
      {props.mode === "custom" ? (
        <input
          className={FIELD}
          value={props.text}
          disabled={props.disabled}
          onChange={(event) => props.onTextChange(event.target.value)}
          onBlur={props.onCommit}
        />
      ) : null}
    </div>
  );
}
