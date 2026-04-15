import {
  getMyFurnitureDisplayTitle,
  getMyFurniturePreferredImageUrl,
  getMyFurnitureSubtitle,
  getMyFurnitureUsageSignal,
  type MyFurnitureItem,
} from "@/lib/myFurniture";

type MyFurnitureRowProps = {
  item: MyFurnitureItem;
  onOpen: (item: MyFurnitureItem) => void;
  onUseInRoom: (itemId: string) => void;
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
  isActing = false,
}: MyFurnitureRowProps) {
  const imageUrl = getMyFurniturePreferredImageUrl(item);
  const title = getMyFurnitureDisplayTitle(item);
  const subtitle = getMyFurnitureSubtitle(item);

  return (
    <article
      className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-2 transition hover:border-slate-600"
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
      <div className="h-16 w-16 overflow-hidden rounded-md border border-slate-800/70 bg-white">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="h-full w-full object-contain p-1.5" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
            No preview
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-slate-100">{title}</div>
        <div className="truncate text-xs text-slate-400">{subtitle}</div>
        <div className="mt-0.5 text-[11px] text-slate-500">
          {getMyFurnitureUsageSignal(item)} • Added {formatDate(item.createdAt)}
        </div>
      </div>

      <div className="flex items-center gap-1">
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
