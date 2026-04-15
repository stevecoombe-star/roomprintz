import {
  getMyFurnitureDisplayTitle,
  getMyFurniturePreferredImageUrl,
  getMyFurnitureSubtitle,
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
  const subtitle = getMyFurnitureSubtitle(item);

  return (
    <article
      className="group relative overflow-visible rounded-2xl bg-slate-900/50 transition hover:bg-slate-900/65"
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
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-slate-800/70 bg-[rgb(237,237,237)]">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="h-full w-full object-contain p-3" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-100 px-4 text-xs text-slate-500">
              No preview
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 rounded-t-2xl bg-gradient-to-b from-black/10 to-transparent opacity-0 transition group-hover:opacity-100" />
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

      <div className="space-y-1 px-1 pb-2 pt-2">
        <div className="truncate text-sm font-medium text-slate-100" title={title}>
          {title}
        </div>
        <div className="truncate text-xs text-slate-400" title={subtitle}>
          {subtitle}
        </div>
        <div className="truncate text-[11px] text-slate-500">
          {usage} • Added {formatDate(item.createdAt)}
        </div>
      </div>
    </article>
  );
}
