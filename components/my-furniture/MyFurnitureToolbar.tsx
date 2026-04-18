import type { MyFurnitureSortMode, MyFurnitureViewMode } from "@/lib/myFurniture";

type MyFurnitureToolbarProps = {
  viewMode: MyFurnitureViewMode;
  onViewModeChange: (next: MyFurnitureViewMode) => void;
  sort: MyFurnitureSortMode;
  onSortChange: (next: MyFurnitureSortMode) => void;
  itemCount: number;
  selectionMode: boolean;
  selectedCount: number;
  onToggleSelectionMode: () => void;
  onClearSelection: () => void;
  onBulkMove: () => void;
};

export function MyFurnitureToolbar({
  viewMode,
  onViewModeChange,
  sort,
  onSortChange,
  itemCount,
  selectionMode,
  selectedCount,
  onToggleSelectionMode,
  onClearSelection,
  onBulkMove,
}: MyFurnitureToolbarProps) {
  return (
    <section className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-400">
          {itemCount} item{itemCount === 1 ? "" : "s"}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleSelectionMode}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              selectionMode
                ? "border-slate-200 bg-slate-100 text-slate-900"
                : "border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white"
            }`}
          >
            {selectionMode ? "Selection On" : "Select"}
          </button>
          {selectionMode && selectedCount > 0 ? (
            <>
              <button
                type="button"
                onClick={onBulkMove}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Move to Folder ({selectedCount})
              </button>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              >
                Clear
              </button>
            </>
          ) : null}

          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange("grid")}
              className={`rounded-md px-2 py-1 text-xs transition ${
                viewMode === "grid"
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-300 hover:text-slate-100"
              }`}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange("list")}
              className={`rounded-md px-2 py-1 text-xs transition ${
                viewMode === "list"
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-300 hover:text-slate-100"
              }`}
            >
              List
            </button>
          </div>

          <label className="text-xs text-slate-400" htmlFor="my-furniture-sort">
            Sort
          </label>
          <select
            id="my-furniture-sort"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as MyFurnitureSortMode)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none transition focus:border-slate-400"
          >
            <option value="recent">Most Recent</option>
            <option value="used">Most Used</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>
    </section>
  );
}
