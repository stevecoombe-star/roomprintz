"use client";

import { useEffect } from "react";

import CollapsibleSection from "./CollapsibleSection";
import AfcProposalOverlayCanvas from "./AfcProposalOverlayCanvas";
import { canRenderAfcProposalOverlay, useAfcProposalOverlayState, type AfcProposalOverlayControls } from "./afc-proposal-overlay-state";
import {
  buildAfcViewportEvidenceSnapshot,
  describeAfcViewportProjectionSuppression,
  type AfcMainViewportProjectionResult,
  type AfcViewportEvidenceSnapshot,
} from "./afc-main-viewport-evidence";

type AfcProposalOverlayPanelProps = Readonly<{
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
  onViewportEvidenceChange: (evidence: AfcViewportEvidenceSnapshot | null) => void;
  viewportProjection: AfcMainViewportProjectionResult;
}>;

const CONTROL_LABELS: ReadonlyArray<readonly [keyof Omit<AfcProposalOverlayControls, "opacity">, string]> = [
  ["showFill", "Fill"], ["showStroke", "Stroke"], ["showCornerMarkers", "Corner markers"],
  ["showCornerNames", "Corner names"], ["showNormalizedCoordinates", "Normalized coordinates"],
  ["showSupportLabels", "Support labels"], ["showEvidence", "Evidence"],
];

function PrettyJson({ value }: Readonly<{ value: unknown }>) {
  return <pre className="max-h-80 overflow-auto rounded border border-slate-800 bg-slate-950 p-2 text-[10px] leading-relaxed text-slate-300">{JSON.stringify(value, null, 2)}</pre>;
}

/** Isolated research evidence panel. It accepts no Floor, camera, scene, or persistence setter. */
export default function AfcProposalOverlayPanel({
  enabled,
  open,
  onToggle,
  onViewportEvidenceChange,
  viewportProjection,
}: AfcProposalOverlayPanelProps) {
  const state = useAfcProposalOverlayState(enabled);
  const model = state.viewModel;
  useEffect(() => {
    onViewportEvidenceChange(enabled ? buildAfcViewportEvidenceSnapshot({
      viewModel: model,
      status: state.status,
      imageUrl: state.imageUrl,
      selectedImageRole: state.imageRole,
      display: state.viewportControls,
    }) : null);
  }, [enabled, model, onViewportEvidenceChange, state.imageRole, state.imageUrl, state.status, state.viewportControls]);
  useEffect(() => () => onViewportEvidenceChange(null), [onViewportEvidenceChange]);

  return (
    <CollapsibleSection
      title="AFC Proposal Overlay — Research Evidence Only"
      description="Receipt-first replay of immutable AFC-R3C artifacts. Read-only evidence; not a Floor comparison or Apply surface."
      open={open}
      onToggle={onToggle}
      meta={<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-100">read-only · unapplied · non-authoritative · not persisted</span>}
    >
      {!enabled ? (
        <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">The AFC proposal overlay feature is disabled. The research route remains unavailable until its server feature gate is enabled.</div>
      ) : (
        <div className="space-y-4 text-xs text-slate-300">
          <div className="rounded-lg border border-amber-800/70 bg-amber-950/20 p-3 text-amber-100">
            This viewer replays a captured receipt and verifies its artifacts before rendering. It cannot alter Floor geometry, camera state, support review, scene JSON, persistence, or selection.
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-72 gap-1 text-slate-400">
              <span>Immutable proposal-run receipt</span>
              <select value={state.selectedReceiptFileName} onChange={(event) => state.setSelectedReceiptFileName(event.target.value)} disabled={state.status === "loading"} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100">
                <option value="">Select a verified receipt…</option>
                {state.receipts.map((receipt) => <option key={receipt.receiptFileName} value={receipt.receiptFileName}>{receipt.roomId} · {receipt.createdAt} · {receipt.imageRole}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void state.load()} disabled={!state.selectedReceiptFileName || state.status === "loading"} className="rounded border border-emerald-600/70 px-3 py-1.5 text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
              {state.status === "loading" ? "Validating…" : "Load receipt"}
            </button>
            <button type="button" onClick={() => void state.refreshReceipts()} disabled={state.status === "loading"} className="rounded border border-slate-600 px-3 py-1.5 text-slate-200 disabled:opacity-50">Discover receipts</button>
            {(state.status !== "unloaded" || state.selectedReceiptFileName) ? <button type="button" onClick={state.clear} className="rounded border border-amber-700/80 px-3 py-1.5 text-amber-100">Clear / unload</button> : null}
          </div>
          {state.status === "loading" ? <p className="text-amber-200">Verifying receipt, artifacts, manifest, image lineage, and AFC-R3B replay. No stale proposal is rendered.</p> : null}
          {state.error ? <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-rose-100"><p className="font-medium">AFC evidence is withheld.</p><p className="mt-1 break-all">{state.error}</p></div> : null}
          {canRenderAfcProposalOverlay(state.status, state.imageUrl) && model ? (
            <>
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <dl className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
                  <div><dt className="text-slate-500">Room / receipt time</dt><dd>{model.artifactIdentity.roomId} · {model.artifactIdentity.createdAt}</dd></div>
                  <div><dt className="text-slate-500">Study / input role</dt><dd>{model.artifactIdentity.studyMode} · {model.artifactIdentity.imageRole}</dd></div>
                  <div><dt className="text-slate-500">R3B / R3C candidate</dt><dd className="break-all">{model.candidate.r3bCandidateId} / {model.candidate.r3cCandidateId}</dd></div>
                  <div><dt className="text-slate-500">Basis binding</dt><dd className="break-all">{model.imageBasis.basisBinding}</dd></div>
                  <div><dt className="text-slate-500">AFC-R2</dt><dd>{model.provenance.afcR2.selectionState}</dd></div>
                  <div><dt className="text-slate-500">Safety</dt><dd>research-only · unapplied · non-authoritative · not persisted · camera unchanged</dd></div>
                </dl>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400">Verified image:</span>
                <button type="button" onClick={() => state.selectImageRole("original")} className={`rounded border px-2 py-1 ${state.imageRole === "original" ? "border-emerald-500 text-emerald-100" : "border-slate-600 text-slate-300"}`}>Original</button>
                <button type="button" onClick={() => state.selectImageRole("empty")} className={`rounded border px-2 py-1 ${state.imageRole === "empty" ? "border-emerald-500 text-emerald-100" : "border-slate-600 text-slate-300"}`}>Empty</button>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {CONTROL_LABELS.map(([key, label]) => <label key={key} className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={state.controls[key]} onChange={(event) => state.updateControls({ [key]: event.target.checked })} />{label}</label>)}
                  <label className="flex min-w-52 flex-1 items-center gap-2 text-slate-300">Overlay opacity <input type="range" min="0" max="1" step="0.05" value={state.controls.opacity} onChange={(event) => state.updateControls({ opacity: Number(event.target.value) })} className="flex-1 accent-emerald-400" /><span>{state.controls.opacity.toFixed(2)}</span></label>
                </div>
              </div>
              <section className="rounded-lg border border-emerald-900/70 bg-emerald-950/15 p-3">
                <h3 className="text-sm text-emerald-100">Main viewport evidence projection</h3>
                <p className="mt-1 text-[11px] text-slate-400">Dashed AFC evidence only. It is read-only, unapplied, non-authoritative, and never enters Floor or calibrated-camera state.</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  <label className="flex items-center gap-1.5 text-slate-200"><input type="checkbox" checked={state.viewportControls.showInMainViewport} onChange={(event) => state.updateViewportControls({ showInMainViewport: event.target.checked })} />Show AFC evidence in main viewport</label>
                  <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={state.viewportControls.showFill} onChange={(event) => state.updateViewportControls({ showFill: event.target.checked })} />Show fill</label>
                  <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={state.viewportControls.showStroke} onChange={(event) => state.updateViewportControls({ showStroke: event.target.checked })} />Show stroke</label>
                  <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={state.viewportControls.showMarkers} onChange={(event) => state.updateViewportControls({ showMarkers: event.target.checked })} />Show markers</label>
                  <label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={state.viewportControls.showLabels} onChange={(event) => state.updateViewportControls({ showLabels: event.target.checked })} />Show labels</label>
                  <label className="flex min-w-52 flex-1 items-center gap-2 text-slate-300">Main viewport opacity <input type="range" min="0" max="1" step="0.05" value={state.viewportControls.opacity} onChange={(event) => state.updateViewportControls({ opacity: Number(event.target.value) })} className="flex-1 accent-emerald-400" /><span>{state.viewportControls.opacity.toFixed(2)}</span></label>
                </div>
                {viewportProjection.kind === "projected" ? (
                  <div className="mt-3 space-y-2 text-[11px]">
                    <p className="text-emerald-100">Main viewport matched <span className="font-medium">{viewportProjection.matchedRole === "original" ? "Original" : "Empty"}</span>{viewportProjection.crossRole ? ` · cross-role: viewer = ${state.imageRole === "original" ? "Original" : "Empty"}, main viewport = ${viewportProjection.matchedRole === "original" ? "Original" : "Empty"}; both belong to this validated receipt image pair.` : " · exact role match."}</p>
                    <div className="overflow-x-auto"><table className="w-full text-left text-slate-300"><thead className="text-slate-500"><tr><th>Corner</th><th>x</th><th>y</th><th>Frame</th><th>Overshoot x</th><th>Overshoot y</th></tr></thead><tbody>{viewportProjection.cornerOrder.map((name) => {
                      const corner = viewportProjection.corners[name];
                      return <tr key={name} className="border-t border-slate-800"><td className="font-medium">{name}</td><td>{corner.x.toFixed(6)}</td><td>{corner.y.toFixed(6)}</td><td>{corner.visibleInFrame ? "visible" : "off-frame"}</td><td>{corner.overshootX.toFixed(6)}</td><td>{corner.overshootY.toFixed(6)}</td></tr>;
                    })}</tbody></table></div>
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-amber-200">{describeAfcViewportProjectionSuppression(viewportProjection)}</p>
                )}
              </section>
              <AfcProposalOverlayCanvas
                viewModel={model}
                verifiedImageUrl={state.imageUrl}
                imageRole={state.imageRole}
                imageRequestGeneration={state.imageRequestGeneration}
                controls={state.controls}
                onImageError={state.imageFailed}
                onImageLoad={(generation, dimensionsMatch) => {
                  if (!dimensionsMatch) state.imageFailed(generation, "The browser-reported image dimensions do not match the verified manifest dimensions.");
                }}
              />
              <div className="grid gap-3 lg:grid-cols-2">
                <section className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <h3 className="text-sm text-slate-100">Corner evidence</h3>
                  <ul className="mt-2 space-y-1 text-slate-300">{(["NL", "NR", "FR", "FL"] as const).map((name) => <li key={name}><span className="font-medium">{name}</span> · ({model.corners[name].x.toFixed(2)}, {model.corners[name].y.toFixed(2)}) · {model.corners[name].support}</li>)}</ul>
                </section>
                {state.controls.showEvidence ? <section className="rounded-lg border border-slate-700 bg-slate-950/60 p-3"><h3 className="text-sm text-slate-100">Edge evidence</h3><ul className="mt-2 space-y-2">{(["near", "right", "far", "left"] as const).map((name) => <li key={name}><span className="font-medium">{name}</span> · {model.edges[name].support}<br /><span className="text-slate-400">{model.edges[name].note}</span></li>)}</ul></section> : null}
              </div>
              {model.warnings.length ? <section className="rounded-lg border border-amber-800/70 bg-amber-950/20 p-3 text-amber-100"><h3 className="text-sm">Evidence qualifications</h3><ul className="mt-2 list-disc space-y-1 pl-5">{model.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section> : null}
              <details className="rounded-lg border border-slate-700 bg-slate-950/60 p-3"><summary className="cursor-pointer text-slate-100">Provenance</summary><dl className="mt-3 grid gap-x-5 gap-y-1 sm:grid-cols-2"><div><dt className="text-slate-500">Prompt</dt><dd>{model.provenance.prompt.version} · {model.provenance.prompt.sha256}</dd></div><div><dt className="text-slate-500">Provider / model</dt><dd>{model.provenance.provider.providerId} · {model.provenance.provider.modelId} · {model.provenance.provider.modelVersion}</dd></div><div><dt className="text-slate-500">Finish / extraction</dt><dd>{model.provenance.provider.finishReason} · {model.provenance.provider.extractionPolicyVersion}</dd></div><div><dt className="text-slate-500">Artifacts</dt><dd className="break-all">receipt {model.provenance.artifactHashes.receiptSha256}<br />envelope {model.provenance.artifactHashes.providerEnvelopeSha256}<br />output {model.provenance.artifactHashes.modelOutputSha256}</dd></div><div><dt className="text-slate-500">Manifest / images</dt><dd>{model.imageBasis.manifestVersion}<br />Original {model.imageBasis.original.sha256}<br />Empty {model.imageBasis.emptyRoom.sha256}</dd></div></dl></details>
              <details className="rounded-lg border border-slate-700 bg-slate-950/60 p-3"><summary className="cursor-pointer text-slate-100">Read-only raw artifacts</summary><div className="mt-3 space-y-3"><div><p className="mb-1 text-slate-400">Receipt</p><PrettyJson value={model.raw.receipt} /></div><div><p className="mb-1 text-slate-400">Model output</p><PrettyJson value={model.raw.modelOutput} /></div></div></details>
            </>
          ) : null}
        </div>
      )}
    </CollapsibleSection>
  );
}
