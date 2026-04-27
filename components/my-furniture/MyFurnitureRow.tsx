import {
  getMyFurnitureDisplayTitle,
  getMyFurniturePriceLabel,
  getMyFurniturePreferredImageUrl,
  getMyFurnitureSubtitle,
  getMyFurnitureUsageSignal,
  type MyFurnitureItem,
} from "@/lib/myFurniture";

type MyFurnitureRowProps = {
  item: MyFurnitureItem;
  onOpen: (item: MyFurnitureItem) => void;
  onUseInRoom: (itemId: string) => void;
  onMoveToFolder: (itemId: string) => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelected: (itemId: string) => void;
  isActing?: boolean;
};

function formatDate(value: string | null): string {
  if (!value) return "Unknown date";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown date";
  return new Date(parsed).toLocaleDateString();
}

export function MyFurnitureRow({
  item,
  onOpen,
  onUseInRoom,
  onMoveToFolder,
  selectionMode,
  isSelected,
  onToggleSelected,
  isActing = false,
}: MyFurnitureRowProps) {
  const imageUrl = getMyFurniturePreferredImageUrl(item);
  const title = getMyFurnitureDisplayTitle(item);
  const subtitle = getMyFurnitureSubtitle(item);
  const priceLabel = getMyFurniturePriceLabel(item);

  return (
    <article
      className="grid grid-cols-[auto_64px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2 transition hover:border-slate-600"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="flex w-16 items-center justify-center">
        {selectionMode ? (
          <label
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelected(item.id)}
              className="h-3.5 w-3.5 accent-slate-100"
            />
            Sel
          </label>
        ) : null}
      </div>

      <div className="h-16 w-16 overflow-hidden rounded-xl bg-[rgb(237,237,237)] ring-1 ring-black/5">
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- image URLs are user/item-provided and rendered with fixed row sizing */
          <img src={imageUrl} alt={title} className="h-full w-full object-contain p-3" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
            No preview
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-100">{title}</div>
        <div className="truncate text-xs text-slate-400">{subtitle}</div>
        {priceLabel ? <div className="truncate text-xs text-slate-300">{priceLabel}</div> : null}
        <div className="mt-0.5 text-[11px] text-slate-500">
          {getMyFurnitureUsageSignal(item)} • Added {formatDate(item.createdAt)}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <details
          className="relative"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <summary className="flex cursor-pointer list-none items-center rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white">
            ...
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-slate-700 bg-slate-950 p-1 shadow-xl">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMoveToFolder(item.id);
              }}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-slate-200 transition hover:bg-slate-800"
            >
              Move to Folder
            </button>
          </div>
        </details>
        <button
          type="button"
          disabled={isActing}
          onClick={(event) => {
            event.stopPropagation();
            onUseInRoom(item.id);
          }}
          className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-100 transition hover:border-slate-500 disabled:opacity-50"
        >
          Use in Room
        </button>
      </div>
    </article>
  );
}
