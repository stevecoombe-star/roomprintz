// components/SurfaceToolsPanel.tsx
"use client";

type FlooringPreset = "" | "carpet" | "hardwood" | "tile";

type SurfaceToolsPanelProps = {
  repairDamage: boolean;
  onChangeRepair: (value: boolean) => void;
  repaintWalls: boolean;
  onChangeRepaintWalls: (value: boolean) => void;
  flooringPreset: FlooringPreset;
  onChangeFlooringPreset: (value: FlooringPreset) => void;
};

export function SurfaceToolsPanel({
  repairDamage,
  onChangeRepair,
  repaintWalls,
  onChangeRepaintWalls,
  flooringPreset,
  onChangeFlooringPreset,
}: SurfaceToolsPanelProps) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-tight text-slate-100">
          Surface updates (Phase 2)
        </h2>
        <span className="text-[9px] text-slate-500">Virtual reno</span>
      </div>

      <p className="text-[11px] text-slate-400">
        Repair surfaces, repaint walls in a listing-friendly neutral, and swap
        flooring for high-impact presets.
      </p>

      <div className="space-y-2">
        {/* Repair surfaces */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={repairDamage}
            onChange={(e) => onChangeRepair(e.target.checked)}
            className="mt-[1px] h-3 w-3 rounded border-slate-700 bg-slate-900 text-emerald-500"
          />
          <div>
            <div className="text-[11px] text-slate-100">
              Repair walls / floors / ceiling
            </div>
            <div className="text-[10px] text-slate-500">
              Patch holes, fix scuffs and cracks while keeping textures and
              materials consistent.
            </div>
          </div>
        </label>

        {/* Repaint walls */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={repaintWalls}
            onChange={(e) => onChangeRepaintWalls(e.target.checked)}
            className="mt-[1px] h-3 w-3 rounded border-slate-700 bg-slate-900 text-emerald-500"
          />
          <div>
            <div className="text-[11px] text-slate-100">
              Repaint walls (off-white)
            </div>
            <div className="text-[10px] text-slate-500">
              Paint all walls and ceilings in a clean, modern off-white ideal
              for real-estate listings.
            </div>
          </div>
        </label>

        {/* Flooring preset */}
        <div className="space-y-1">
          <div className="text-[11px] text-slate-100">
            Change flooring (preset)
          </div>
          <select
            value={flooringPreset}
            onChange={(e) =>
              onChangeFlooringPreset(e.target.value as FlooringPreset)
            }
            className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
          >
            <option value="">No flooring change</option>
            <option value="carpet">Cozy neutral carpet</option>
            <option value="hardwood">Light hardwood</option>
            <option value="tile">Modern large-format tile</option>
          </select>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Floor updates keep perspective and layout — only materials change.
          </p>
        </div>
      </div>
    </section>
  );
}
