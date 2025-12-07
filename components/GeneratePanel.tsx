// components/GeneratePanel.tsx
"use client";

type GeneratePanelProps = {
  canGenerate: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
};

export function GeneratePanel({
  canGenerate,
  isGenerating,
  onGenerate,
}: GeneratePanelProps) {
  const disabled = !canGenerate || isGenerating;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
      <h2 className="text-base font-semibold">3. Generate Staged Room</h2>
      <p className="text-xs text-slate-400">
        When you&apos;re ready, click Generate to create your AI-staged room image.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        className={[
          "mt-2 inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition",
          disabled
            ? "bg-slate-700 text-slate-400 cursor-not-allowed"
            : "bg-emerald-500 text-slate-950 hover:bg-emerald-400",
        ].join(" ")}
      >
        {isGenerating ? (
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
            Generating staged room…
          </span>
        ) : (
          "Generate Staged Room"
        )}
      </button>
      {!canGenerate && (
        <p className="text-[11px] text-slate-500 mt-1">
          Upload a room photo and choose a style to enable generation.
        </p>
      )}
    </div>
  );
}
