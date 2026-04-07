import {
  getMyFurnitureDisplayTitle,
  getMyFurniturePreferredImageUrl,
  getMyFurnitureUsageSignal,
  type MyFurnitureItem,
} from "@/lib/myFurniture";

type MyFurnitureDrawerProps = {
  item: MyFurnitureItem | null;
  onClose: () => void;
  onUseInRoom: (itemId: string) => void;
  isActing?: boolean;
};

function formatDateTime(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  return new Date(parsed).toLocaleString();
}

export function MyFurnitureDrawer({
  item,
  onClose,
  onUseInRoom,
  isActing = false,
}: MyFurnitureDrawerProps) {
  if (!item) return null;

  const title = getMyFurnitureDisplayTitle(item);
  const imageUrl = getMyFurniturePreferredImageUrl(item);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/70"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-slate-800 bg-slate-950 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-xs text-slate-400">{item.category || "Uncategorized"}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
          >
            Close
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="h-64 w-full object-cover" />
          ) : (
            <div className="flex h-64 items-center justify-center text-xs text-slate-500">No preview</div>
          )}
        </div>

        <dl className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs">
          <div>
            <dt className="text-slate-500">Usage</dt>
            <dd className="mt-0.5 text-slate-200">{getMyFurnitureUsageSignal(item)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="mt-0.5 text-slate-200">{formatDateTime(item.createdAt)}</dd>
          </div>
          {item.sourceLabel ? (
            <div>
              <dt className="text-slate-500">Source</dt>
              <dd className="mt-0.5 text-slate-200">{item.sourceLabel}</dd>
            </div>
          ) : null}
          {item.sourceUrl ? (
            <div>
              <dt className="text-slate-500">Source URL</dt>
              <dd className="mt-0.5 break-all text-slate-300">
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-slate-500 underline-offset-2 hover:text-slate-100"
                >
                  {item.sourceUrl}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isActing}
            onClick={() => onUseInRoom(item.id)}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
          >
            Use in Room
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Load this item into Paste-to-Place so you can place it in your room.
        </p>
      </aside>
    </div>
  );
}
