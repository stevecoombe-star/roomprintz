type SceneJsonStatus = { kind: "idle" | "success" | "error"; message: string };

type SceneJsonPanelProps = {
  sceneJsonPreview: string;
  sceneStateExportedAt: string;
  exportStatus: SceneJsonStatus;
  importTextValue: string;
  importStatus: SceneJsonStatus;
  localDraftStatus: SceneJsonStatus;
  localDraftLastSavedAt: string | null;
  onCopySceneJson: () => void | Promise<void>;
  onDownloadSceneJson: () => void;
  onImportTextChange: (value: string) => void;
  onApplyImport: () => void;
  onClearImport: () => void;
  onSaveLocalDraft: () => void;
  onRestoreLocalDraft: () => void;
  onClearLocalDraft: () => void;
  modelMutationLocked: boolean;
};

export default function SceneJsonPanel({
  sceneJsonPreview,
  sceneStateExportedAt,
  exportStatus,
  importTextValue,
  importStatus,
  localDraftStatus,
  localDraftLastSavedAt,
  onCopySceneJson,
  onDownloadSceneJson,
  onImportTextChange,
  onApplyImport,
  onClearImport,
  onSaveLocalDraft,
  onRestoreLocalDraft,
  onClearLocalDraft,
  modelMutationLocked,
}: SceneJsonPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-100">Scene State JSON</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onCopySceneJson()}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
          >
            Copy scene JSON
          </button>
          <button
            type="button"
            onClick={onDownloadSceneJson}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
          >
            Download scene JSON
          </button>
        </div>
      </div>
      <p
        className={`mt-2 text-xs ${
          exportStatus.kind === "error"
            ? "text-rose-300"
            : exportStatus.kind === "success"
              ? "text-emerald-300"
              : "text-slate-400"
        }`}
      >
        {exportStatus.message}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">Exported at: {sceneStateExportedAt}</p>
      <textarea
        readOnly
        value={sceneJsonPreview}
        className="mt-3 h-80 w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200 outline-none"
        aria-label="Scene State JSON"
      />

      <div className="mt-5 border-t border-slate-800 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-100">Import Scene JSON</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onApplyImport}
              disabled={modelMutationLocked}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply imported JSON
            </button>
            <button
              type="button"
              onClick={onClearImport}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
            >
              Clear import
            </button>
          </div>
        </div>
        <p
          className={`mt-2 text-xs ${
            importStatus.kind === "error"
              ? "text-rose-300"
              : importStatus.kind === "success"
                ? "text-emerald-300"
                : "text-slate-400"
          }`}
        >
          {importStatus.message}
        </p>
        {modelMutationLocked && (
          <p className="mt-1 text-xs text-amber-300">Detach the object before restoring a scene.</p>
        )}
        <textarea
          value={importTextValue}
          onChange={(event) => onImportTextChange(event.target.value)}
          placeholder='Paste a payload with schemaVersion "vibode-3d-room-lab-scene-state/v0"'
          className="mt-3 h-56 w-full rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs text-slate-200 outline-none focus:border-emerald-400"
          aria-label="Import Scene JSON"
        />
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-100">Local draft persistence</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveLocalDraft}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
            >
              Save local draft
            </button>
            <button
              type="button"
              onClick={onRestoreLocalDraft}
              disabled={modelMutationLocked}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Restore local draft
            </button>
            <button
              type="button"
              onClick={onClearLocalDraft}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-slate-100"
            >
              Clear local draft
            </button>
          </div>
        </div>
        <p
          className={`mt-2 text-xs ${
            localDraftStatus.kind === "error"
              ? "text-rose-300"
              : localDraftStatus.kind === "success"
                ? "text-emerald-300"
                : "text-slate-400"
          }`}
        >
          {localDraftStatus.message}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Last local draft save: {localDraftLastSavedAt ?? "none"}
        </p>
      </div>
    </section>
  );
}
