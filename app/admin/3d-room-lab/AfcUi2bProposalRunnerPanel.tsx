"use client";

import { useMemo, useState } from "react";

import CollapsibleSection from "./CollapsibleSection";
import { useAfcUi2bRunnerState } from "./afc-ui2b-runner-state";

type Props = Readonly<{ enabled: boolean; open: boolean; onToggle: () => void }>;
function text(value: unknown): string { return typeof value === "string" ? value : "unavailable"; }
function number(value: unknown): string { return typeof value === "number" ? String(value) : "0"; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

export function AfcUi2bValidationTruthCard({ result }: Readonly<{ result: unknown }>) {
  if (!result) return null;
  const validation = record(result);
  const selectedImage = record(validation.selectedImage);
  const manifest = record(validation.manifest);
  const validationRunner = record(validation.runner);
  return (
    <section data-afc-ui2b-truth="validation" className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-3 text-emerald-100">
      <h3 className="text-sm">Validated package-to-runner binding</h3>
      <dl className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
        <div><dt className="text-slate-400">Selected role / SHA</dt><dd className="break-all">{text(selectedImage.role)} · {text(selectedImage.sha256)}</dd></div>
        <div><dt className="text-slate-400">Manifest</dt><dd className="break-all">{text(manifest.fileName)} · {text(manifest.sha256)}</dd></div>
        <div><dt className="text-slate-400">Prompt role / model</dt><dd>{text(validationRunner.promptRole)} · {text(validationRunner.modelId)}</dd></div>
        <div><dt className="text-slate-400">Provider calls / capture writes</dt><dd>{number(validationRunner.providerCallCount)} / {String(validationRunner.captureWrite === true)}</dd></div>
      </dl>
    </section>
  );
}

export function AfcUi2bCompletedRunTruthCard({
  result,
  viewerHandoffReceipt,
  onPrepareViewerHandoff,
}: Readonly<{ result: unknown; viewerHandoffReceipt: string | null; onPrepareViewerHandoff: () => void }>) {
  if (!result) return null;
  const execution = record(result);
  const executionRunner = record(execution.runner);
  const proposal = record(execution.proposal);
  return (
    <section data-afc-ui2b-truth="execution" className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-3 text-emerald-100">
      <h3 className="text-sm">Completed controlled proposal run</h3>
      <dl className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2">
        <div><dt className="text-slate-400">Provider calls / capture write</dt><dd>{number(executionRunner.providerCallCount)} / {String(executionRunner.captureWrite === true)}</dd></div>
        <div><dt className="text-slate-400">Companion receipt</dt><dd>{String(executionRunner.companionReceiptWritten === true)}</dd></div>
        <div><dt className="text-slate-400">Proposal receipt</dt><dd className="break-all">{text(proposal.receiptFileName)} · {text(proposal.receiptSha256)}</dd></div>
        <div><dt className="text-slate-400">Candidates / accepted IDs</dt><dd className="break-all">{number(proposal.candidateCount)} · {Array.isArray(proposal.acceptedCandidateIds) ? proposal.acceptedCandidateIds.join(", ") : "unavailable"}</dd></div>
        <div><dt className="text-slate-400">Warnings / strict replay</dt><dd>{number(proposal.warningCount)} · {String(proposal.strictReplayVerified === true)}</dd></div>
      </dl>
      <button type="button" onClick={onPrepareViewerHandoff} className="mt-3 rounded border border-emerald-600/70 px-3 py-1.5 text-emerald-100">Reveal receipt for manual viewer selection</button>
      {viewerHandoffReceipt ? <p className="mt-2">Receipt ready — select it in the AFC Proposal Overlay Viewer: <span className="break-all">{viewerHandoffReceipt}</span></p> : null}
    </section>
  );
}

/** Isolated controlled proposal runner: no scene, Floor, camera, or viewer mutation props. */
export default function AfcUi2bProposalRunnerPanel({ enabled, open, onToggle }: Props) {
  const [roomLabel, setRoomLabel] = useState("");
  const state = useAfcUi2bRunnerState(enabled, roomLabel);
  const packages = useMemo(() => new Map(state.packages.map((item) => [item.packageId, item])), [state.packages]);
  const selected = state.selectedPackage;
  return (
    <CollapsibleSection
      title="AFC Controlled Proposal Runner"
      description="UI2B — Strict prepared-package replay and deliberate Gemini Floor-proposal execution"
      open={open}
      onToggle={onToggle}
      meta={<span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-100">research only · one live call only</span>}
    >
      <div className="space-y-4 text-xs text-slate-300">
        {!enabled ? <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-slate-400">Controlled proposal running is disabled by the server feature gate.</div> : null}
        <div className="rounded-lg border border-amber-800/70 bg-amber-950/20 p-3 text-amber-100">
          Validation strictly replays a prepared package and performs zero Gemini calls or proposal capture writes. This panel cannot apply a Floor draft or alter Floor, camera, supports, scene JSON, persistence, Empty evidence, or compositor state.
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-52 gap-1 text-slate-400"><span>Research room label</span><input value={roomLabel} onChange={(event) => { setRoomLabel(event.target.value); state.clear(); }} disabled={state.requestInFlight} placeholder="room-a" className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 disabled:opacity-50" /></label>
          <button type="button" onClick={() => void state.refreshPackages()} disabled={!enabled || !roomLabel || state.requestInFlight} className="rounded border border-slate-600 px-3 py-1.5 text-slate-200 disabled:opacity-50">Refresh prepared packages</button>
          <button type="button" onClick={() => void state.refreshRuns()} disabled={!enabled || !roomLabel || state.requestInFlight} className="rounded border border-slate-600 px-3 py-1.5 text-slate-200 disabled:opacity-50">Refresh proposal runs</button>
          <button type="button" onClick={state.clear} disabled={state.requestInFlight} className="rounded border border-amber-700/80 px-3 py-1.5 text-amber-100 disabled:opacity-50">Clear / reset</button>
        </div>
        <dl className="grid gap-x-5 gap-y-1 rounded-lg border border-slate-700 bg-slate-950/60 p-3 sm:grid-cols-2">
          <div><dt className="text-slate-500">Package inventory</dt><dd>{state.packageInventoryStatus}</dd></div>
          <div><dt className="text-slate-500">Invalid package candidates</dt><dd>{state.invalidPackageCandidateCount}</dd></div>
          <div><dt className="text-slate-500">Validation</dt><dd>{state.validationStatus}</dd></div>
          <div><dt className="text-slate-500">Live execution</dt><dd>{state.executionStatus}</dd></div>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-80 gap-1 text-slate-400"><span>Prepared package</span><select value={selected?.packageId ?? ""} onChange={(event) => state.selectPackage(packages.get(event.target.value) ?? null)} disabled={!enabled || state.requestInFlight} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 disabled:opacity-50"><option value="">Select strict prepared package…</option>{state.packages.map((item) => <option key={item.packageId} value={item.packageId}>{item.roomId} · {item.packageId}</option>)}</select></label>
          <label className="grid min-w-52 gap-1 text-slate-400"><span>Study mode</span><select value={state.studyMode} onChange={(event) => state.selectStudyMode(event.target.value === "original_only" || event.target.value === "empty_only" ? event.target.value : "")} disabled={!enabled || state.requestInFlight} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 disabled:opacity-50"><option value="">Select study mode…</option><option value="original_only">original_only</option><option value="empty_only">empty_only</option></select></label>
          <button type="button" onClick={() => void state.validate()} disabled={!enabled || !selected || !state.studyMode || state.requestInFlight} className="rounded border border-sky-600/70 px-3 py-1.5 text-sky-100 disabled:opacity-50">{state.validationStatus === "validating" ? "Validating proposal run…" : "Validate proposal run"}</button>
        </div>
        {selected ? <dl className="grid gap-x-5 gap-y-1 rounded-lg border border-violet-800/70 bg-violet-950/15 p-3 sm:grid-cols-2"><div><dt className="text-slate-500">Room / package</dt><dd className="break-all">{selected.roomId} · {selected.packageId}</dd></div><div><dt className="text-slate-500">Package receipt SHA</dt><dd className="break-all">{selected.receipt.sha256}</dd></div><div><dt className="text-slate-500">Manifest SHA</dt><dd className="break-all">{selected.manifest.sha256}</dd></div><div><dt className="text-slate-500">Shared-context digest</dt><dd className="break-all">{selected.sharedContextDigest}</dd></div></dl> : null}
        <AfcUi2bValidationTruthCard result={state.lastValidation} />
        {enabled && state.validationStatus === "validated" ? <section className="rounded-lg border border-rose-700 bg-rose-950/30 p-3 text-rose-100"><p className="font-medium">This will make exactly one live Gemini Floor-proposal provider call and write one immutable local research receipt if successful.</p><button type="button" onClick={() => void state.execute()} disabled={!enabled || state.requestInFlight} className="mt-3 rounded border border-rose-500 px-3 py-1.5 font-medium text-rose-50 disabled:opacity-50">{state.executionStatus === "executing" ? "Running one live Gemini Floor-proposal call…" : "Run one Gemini Floor-proposal call"}</button></section> : null}
        {state.failure ? <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-rose-100">{state.failure}</div> : null}
        <AfcUi2bCompletedRunTruthCard result={state.lastRun} viewerHandoffReceipt={state.viewerHandoffReceipt} onPrepareViewerHandoff={state.prepareViewerHandoff} />
        {state.runInventory.length ? <section className="rounded-lg border border-slate-700 bg-slate-950/60 p-3"><h3 className="text-sm text-slate-100">Strictly replayable controlled runs</h3><ul className="mt-2 space-y-1">{state.runInventory.map((entry) => { const row = record(entry.proposal); return <li key={text(row.receiptSha256)} className="break-all">{text(entry.studyMode)} · {text(row.receiptFileName)} · {text(row.receiptSha256)}</li>; })}</ul></section> : null}
      </div>
    </CollapsibleSection>
  );
}
