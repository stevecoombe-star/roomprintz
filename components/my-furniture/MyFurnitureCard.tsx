import {
  getMyFurnitureDisplayTitle,
  getMyFurniturePreferredImageUrl,
  getMyFurnitureUsageSignal,
  type MyFurnitureItem,
} from "@/lib/myFurniture";

type MyFurnitureCardProps = {
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

export function MyFurnitureCard({
  item,
  onOpen,
  onUseInRoom,
  isActing = false,
}: MyFurnitureCardProps) {
  const imageUrl = getMyFurniturePreferredImageUrl(item);
  const title = getMyFurnitureDisplayTitle(item);
  const usage = getMyFurnitureUsageSignal(item);
  const subtitle = item.category || item.sourceLabel || "Saved item";

  return (
    <article
      className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 transition hover:border-slate-600"
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
      <div className="relative">
        <div className="aspect-[4/3] w-full overflow-hidden bg-slate-950">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
              No preview
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-slate-950/70 to-transparent opacity-0 transition group-hover:opacity-100" />
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            disabled={isActing}
            onClick={(event) => {
              event.stopPropagation();
              onUseInRoom(item.id);
            }}
            className="rounded-md border border-slate-600 bg-slate-950/90 px-2 py-1 text-[11px] text-slate-100 transition hover:border-slate-400 disabled:opacity-50"
          >
            Use in Room
          </button>
        </div>
      </div>

      <div className="space-y-1 p-3">
        <div className="truncate text-sm font-medium text-slate-100">{title}</div>
        <div className="truncate text-xs text-slate-400">{subtitle}</div>
        <div className="text-[11px] text-slate-500">
          {usage} • Added {formatDate(item.createdAt)}
        </div>
      </div>
    </article>
  );
}
