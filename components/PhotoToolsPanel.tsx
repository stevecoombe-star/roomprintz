// components/PhotoToolsPanel.tsx
"use client";

type PhotoToolsPanelProps = {
  enhancePhoto: boolean;
  onChangeEnhance: (value: boolean) => void;
  cleanupRoom: boolean;
  onChangeCleanup: (value: boolean) => void;
  emptyRoom: boolean;
  onChangeEmptyRoom: (value: boolean) => void;
};

export function PhotoToolsPanel({
  enhancePhoto,
  onChangeEnhance,
  cleanupRoom,
  onChangeCleanup,
  emptyRoom,
  onChangeEmptyRoom,
}: PhotoToolsPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-tight text-slate-100">
          Photo tools (pre-staging)
        </h2>
      </div>

      <p className="text-[11px] text-slate-400">
        These tools run on the original photo before staging. Use them to get
        MLS-ready images in one click.
      </p>

      <div className="space-y-1.5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enhancePhoto}
            onChange={(e) => onChangeEnhance(e.target.checked)}
            className="mt-[1px] h-3 w-3 rounded border-slate-700 bg-slate-900 text-emerald-500"
          />
          <div>
            <div className="text-[11px] text-slate-100">
              Enhance photo (lighting &amp; sharpness)
            </div>
            <div className="text-[10px] text-slate-500">
              Fix exposure, white balance, contrast and clarity while keeping a
              natural look.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cleanupRoom}
            onChange={(e) => onChangeCleanup(e.target.checked)}
            className="mt-[1px] h-3 w-3 rounded border-slate-700 bg-slate-900 text-emerald-500"
          />
          <div>
            <div className="text-[11px] text-slate-100">
              Declutter / room clean-up
            </div>
            <div className="text-[10px] text-slate-500">
              Remove small items, mess and visual noise while keeping important
              furniture.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={emptyRoom}
            onChange={(e) => onChangeEmptyRoom(e.target.checked)}
            className="mt-[1px] h-3 w-3 rounded border-slate-700 bg-slate-900 text-emerald-500"
          />
          <div>
            <div className="text-[11px] text-slate-100">
              Empty room (remove all furniture)
            </div>
            <div className="text-[10px] text-slate-500">
              Remove all movable furniture and decor so only the empty room shell
              remains (walls, floors, windows, built-ins).
            </div>
          </div>
        </label>
      </div>
    </section>
  );
}
