type MyFurnitureHeaderProps = {
  onRefresh: () => void;
  isRefreshing: boolean;
  onAddItem: () => void;
};

export function MyFurnitureHeader({ onRefresh, isRefreshing, onAddItem }: MyFurnitureHeaderProps) {
  return (
    <header className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">My Furniture</h1>
          <p className="mt-1 text-xs text-slate-400">Your saved items, ready to reuse instantly</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAddItem}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white"
          >
            Add Item
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}
