"use client";

import CollapsibleSection from "./CollapsibleSection";
import { sanitizeCurrentUrl, useAfcUi2aRunnerState, type AfcUi2aCurrentImageDescriptor } from "./afc-ui2a-runner-state";

type AfcUi2aRunnerPanelProps = Readonly<{
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
  currentImage: AfcUi2aCurrentImageDescriptor | null;
  qualificationStatus: string;
}>;

export default function AfcUi2aRunnerPanel({ enabled, open, onToggle, currentImage, qualificationStatus }: AfcUi2aRunnerPanelProps) {
  const state = useAfcUi2aRunnerState(enabled, currentImage);
  return (
    <CollapsibleSection
      title="AFC Controlled Input Preparation and Runner"
      description="UI2A-1 — Original preparation only"
      open={open}
      onToggle={onToggle}
      meta={<span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-100">local research evidence · no live run</span>}
    >
      <div className="space-y-4 text-xs text-slate-300">
        {!enabled ? <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-slate-400">Original preparation is disabled by the server feature flag.</div> : null}
        <div className="rounded-lg border border-sky-800/70 bg-sky-950/20 p-3 text-sky-100">
          Writes local immutable research evidence only. It performs no Empty generation, no Gemini call, and changes neither Floor, camera, supports, Scene JSON, nor user tokens.
        </div>
        <dl className="grid gap-x-5 gap-y-1 rounded-lg border border-slate-700 bg-slate-950/60 p-3 sm:grid-cols-2">
          <div><dt className="text-slate-500">Qualification</dt><dd>{qualificationStatus}</dd></div>
          <div><dt className="text-slate-500">Operation</dt><dd>{state.status}</dd></div>
          <div><dt className="text-slate-500">Fingerprint</dt><dd className="break-all">{currentImage?.expectedFingerprint ?? "unavailable"}</dd></div>
          <div><dt className="text-slate-500">Decoded dimensions</dt><dd>{currentImage ? `${currentImage.expectedWidth} × ${currentImage.expectedHeight}` : "unavailable"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">Current URL</dt><dd className="break-all">{currentImage ? sanitizeCurrentUrl(currentImage.imageUrl) : "unavailable"}</dd></div>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-64 gap-1 text-slate-400">
            <span>Research room label</span>
            <input value={state.roomLabel} onChange={(event) => state.setRoomLabel(event.target.value)} disabled={state.status === "preparing" || !enabled} placeholder="Room A" className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 disabled:opacity-50" />
          </label>
          <button type="button" onClick={() => void state.prepare()} disabled={!enabled || !currentImage || state.status === "preparing"} className="rounded border border-sky-600/70 px-3 py-1.5 text-sky-100 disabled:cursor-not-allowed disabled:opacity-50">
            {state.status === "preparing" ? "Preparing immutable Original…" : "Prepare immutable Original"}
          </button>
          <button type="button" onClick={() => void state.refreshInventory()} disabled={!enabled || state.status === "preparing"} className="rounded border border-slate-600 px-3 py-1.5 text-slate-200 disabled:opacity-50">Refresh prepared Originals</button>
          <button type="button" onClick={state.clear} disabled={state.status === "preparing"} className="rounded border border-amber-700/80 px-3 py-1.5 text-amber-100 disabled:opacity-50">Clear / reset</button>
        </div>
        {state.status === "preparing" ? <p className="text-amber-200">Pinned qualification fingerprint: <span className="break-all">{state.pinnedFingerprint}</span></p> : null}
        {state.failure ? <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-rose-100"><p>{state.failure.failureCode}</p><p className="mt-1">{state.failure.message}</p></div> : null}
        {state.prepared ? <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-3 text-emerald-100"><p>Original prepared: {state.prepared.preparationId}</p><dl className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2"><div><dt className="text-slate-400">Room</dt><dd>{state.prepared.roomId}</dd></div><div><dt className="text-slate-400">Original</dt><dd className="break-all">{state.prepared.original.fileName}</dd></div><div><dt className="text-slate-400">Image evidence</dt><dd className="break-all">{state.prepared.original.sha256} · {state.prepared.original.mimeType} · {state.prepared.original.decodedWidth} × {state.prepared.original.decodedHeight}</dd></div><div><dt className="text-slate-400">Receipt</dt><dd className="break-all">{state.prepared.receipt.fileName} · {state.prepared.receipt.sha256}</dd></div><div className="sm:col-span-2"><dt className="text-slate-400">Reuse</dt><dd>Original {state.prepared.reused.original ? "reused" : "new"} · receipt {state.prepared.reused.receipt ? "reused" : "new"}</dd></div></dl></div> : null}
        {state.inventoryError ? <p className="text-rose-200">{state.inventoryError}</p> : null}
        {state.inventory.length ? <ul className="space-y-1 rounded-lg border border-slate-700 bg-slate-950/60 p-3">{state.inventory.map((entry) => <li key={entry.receiptFileName} className="break-all">{entry.roomId} · {entry.originalFileName} · {entry.receiptFileName} · {entry.matchesCurrentFingerprint === null ? "current fingerprint not supplied" : entry.matchesCurrentFingerprint ? "matches current fingerprint" : "different fingerprint"}</li>)}</ul> : null}
      </div>
    </CollapsibleSection>
  );
}
