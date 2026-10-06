"use client";

import { useRef } from "react";

import {
  PARTNER_INLINE_GLB_ATTENTION,
  PARTNER_INLINE_GLB_CHOOSE,
  PARTNER_INLINE_GLB_EMPTY_DETAIL,
  PARTNER_INLINE_GLB_EMPTY_TITLE,
  PARTNER_INLINE_GLB_PROCESSING,
  PARTNER_INLINE_GLB_READY,
  PARTNER_INLINE_GLB_RELOAD,
  PARTNER_INLINE_GLB_REPLACE,
  PARTNER_INLINE_GLB_RETRY,
  PARTNER_INLINE_GLB_UPLOAD,
  partnerInlineGlbUploadingLabel,
  type PartnerInlineGlbView,
} from "@/lib/vibode-stage/partner-inline-glb-upload";
import {
  partnerDisplayedModelThumbnail,
  type PartnerVariantModelPresentation,
} from "@/lib/vibode-stage/partner-product-editor";

import { PartnerModelThumbnail } from "../../PartnerModelThumbnail";
import { SECONDARY } from "./editor-ui";
import { PartnerModelSelect } from "./PartnerModelSection";

export function PartnerInlineModelPanel(props: Readonly<{
  saved: PartnerVariantModelPresentation | null;
  upload: PartnerInlineGlbView;
  options: readonly Readonly<{ assetId: string; label: string }>[];
  selectedAssetId: string;
  disabled: boolean;
  invalid: boolean;
  emptyDetail?: string;
  showSectionLabel?: boolean;
  onFile: (file: File) => void;
  onChoose: (assetId: string) => void;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = props.upload.phase === "uploading" || props.upload.phase === "processing";
  const savedReady = props.saved?.stateLabel === "Ready";
  const savedFile = props.saved?.filename ?? null;
  const locked = props.disabled || busy;

  function openPicker() {
    if (locked) return;
    inputRef.current?.click();
  }

  function takeFile(file: File | null | undefined) {
    if (!file || locked) return;
    props.onFile(file);
  }

  const showReplace = !busy && (
    props.upload.phase === "ready"
    || (props.upload.phase === "idle" && savedReady)
    || (props.upload.phase === "attention" && savedReady)
  );
  const showUpload = !busy && !showReplace && props.upload.phase !== "attention";
  const showChoose = !busy && props.options.length > 0;
  const thumbnail = partnerDisplayedModelThumbnail({
    stateLabel: props.saved?.stateLabel ?? null,
    filename: props.upload.phase === "ready" ? props.upload.fileName : (props.saved?.filename ?? null),
    thumbnailUrl: props.saved?.thumbnailUrl,
    replacingFileName: props.upload.phase === "ready" ? props.upload.fileName : null,
  });

  return (
    <div
      className="space-y-3"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        takeFile(event.dataTransfer.files?.[0]);
      }}
    >
      <div className={thumbnail ? "flex min-w-0 items-start gap-3" : undefined}>
        {thumbnail ? (
          <PartnerModelThumbnail key={thumbnail.url ?? thumbnail.label} url={thumbnail.url} label={thumbnail.label} />
        ) : null}
        <div className="min-w-0 flex-1 space-y-3">
          {props.showSectionLabel === false ? null : (
            <p className="text-xs uppercase tracking-wide text-slate-500">3D Model</p>
          )}
          <div aria-live="polite" className="space-y-1">
            {props.upload.phase === "uploading" ? (
              <p className="text-sm text-slate-100">{partnerInlineGlbUploadingLabel(props.upload.fileName)}</p>
            ) : null}
            {props.upload.phase === "processing" ? (
              <p className="text-sm text-slate-100">{PARTNER_INLINE_GLB_PROCESSING}</p>
            ) : null}
            {props.upload.phase === "ready" ? (
              <>
                <p className="text-sm text-slate-100">{PARTNER_INLINE_GLB_READY}</p>
                <p className="text-sm text-slate-300">{props.upload.fileName}</p>
              </>
            ) : null}
            {props.upload.phase === "attention" && savedReady ? (
              <>
                <p className="text-sm text-slate-100">{PARTNER_INLINE_GLB_READY}</p>
                {savedFile ? <p className="text-sm text-slate-300">{savedFile}</p> : null}
              </>
            ) : null}
            {props.upload.phase === "attention" ? (
              <>
                <p className="text-sm text-slate-100">{PARTNER_INLINE_GLB_ATTENTION}</p>
                <p className="text-sm text-rose-200">{props.upload.message}</p>
                {props.upload.technical ? (
                  <details className="text-xs text-slate-500">
                    <summary>Technical details</summary>
                    <p className="mt-1 font-mono">{props.upload.technical}</p>
                  </details>
                ) : null}
              </>
            ) : null}
            {props.upload.phase === "idle" && savedReady ? (
              <>
                <p className="text-sm text-slate-100">{PARTNER_INLINE_GLB_READY}</p>
                {savedFile ? <p className="text-sm text-slate-300">{savedFile}</p> : null}
                {props.saved?.detail ? <p className="text-sm text-slate-400">{props.saved.detail}</p> : null}
              </>
            ) : null}
            {props.upload.phase === "idle" && props.saved?.stateLabel === "Needs attention" ? (
              <>
                <p className="text-sm text-slate-100">{PARTNER_INLINE_GLB_ATTENTION}</p>
                {props.saved.detail ? <p className="text-sm text-slate-400">{props.saved.detail}</p> : null}
              </>
            ) : null}
            {props.upload.phase === "idle" && !savedReady && props.saved?.stateLabel !== "Needs attention" ? (
              <>
                <p className="text-sm font-medium text-slate-100">{PARTNER_INLINE_GLB_EMPTY_TITLE}</p>
                <p className="text-sm text-slate-400">{props.emptyDetail ?? PARTNER_INLINE_GLB_EMPTY_DETAIL}</p>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        aria-label="Upload GLB"
        className="sr-only"
        disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          takeFile(file);
        }}
      />
      {showUpload ? (
        <div className="space-y-2">
          <button type="button" className={SECONDARY} disabled={locked} onClick={openPicker}>
            {PARTNER_INLINE_GLB_UPLOAD}
          </button>
          <p className="text-xs text-slate-500">You can also drop a GLB here.</p>
        </div>
      ) : null}
      {showReplace ? (
        <button type="button" className={SECONDARY} disabled={locked} onClick={openPicker}>
          {PARTNER_INLINE_GLB_REPLACE}
        </button>
      ) : null}
      {props.upload.phase === "attention" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} disabled={locked} onClick={openPicker}>
            {PARTNER_INLINE_GLB_RETRY}
          </button>
          {props.upload.reload ? (
            <button type="button" className={SECONDARY} onClick={() => window.location.reload()}>
              {PARTNER_INLINE_GLB_RELOAD}
            </button>
          ) : null}
        </div>
      ) : null}
      {showChoose ? (
        <PartnerModelSelect
          label={PARTNER_INLINE_GLB_CHOOSE}
          placeholder={savedReady || props.upload.phase === "ready" ? "Choose a different model" : "Choose a 3D model"}
          options={props.options}
          value={props.selectedAssetId}
          disabled={locked}
          invalid={props.invalid}
          onChange={props.onChoose}
        />
      ) : null}
    </div>
  );
}
