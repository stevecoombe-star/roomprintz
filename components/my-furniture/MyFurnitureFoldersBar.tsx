type FolderScope = "all" | "unfiled" | `folder:${string}`;

export type MyFurnitureFolder = {
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type MyFurnitureFoldersBarProps = {
  folders: MyFurnitureFolder[];
  selectedScope: FolderScope;
  onScopeChange: (scope: FolderScope) => void;
  onCreateFolder: () => void;
  onRenameFolder: (folder: MyFurnitureFolder) => void;
  onDeleteFolder: (folder: MyFurnitureFolder) => void;
  folderCounts: {
    all: number;
    unfiled: number;
    byId: Record<string, number>;
  };
  disabled?: boolean;
};

function pillClass(active: boolean): string {
  return active
    ? "border-slate-200 bg-slate-100 text-slate-900"
    : "border-slate-700 bg-slate-900/40 text-slate-200 hover:border-slate-500";
}

export function MyFurnitureFoldersBar({
  folders,
  selectedScope,
  onScopeChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderCounts,
  disabled = false,
}: MyFurnitureFoldersBarProps) {
  const selectedFolderId =
    selectedScope.startsWith("folder:") ? selectedScope.slice("folder:".length) : null;
  const selectedFolder = selectedFolderId
    ? folders.find((folder) => folder.id === selectedFolderId) ?? null
    : null;

  return (
    <section className="mt-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onScopeChange("all")}
          className={`rounded-full border px-3 py-1.5 text-xs transition ${pillClass(selectedScope === "all")} disabled:opacity-50`}
        >
          All Items ({folderCounts.all})
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onScopeChange("unfiled")}
          className={`rounded-full border px-3 py-1.5 text-xs transition ${pillClass(selectedScope === "unfiled")} disabled:opacity-50`}
        >
          Unfiled ({folderCounts.unfiled})
        </button>
        {folders.map((folder) => {
          const scope = `folder:${folder.id}` as FolderScope;
          return (
            <button
              key={folder.id}
              type="button"
              disabled={disabled}
              onClick={() => onScopeChange(scope)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${pillClass(selectedScope === scope)} disabled:opacity-50`}
            >
              {folder.name} ({folderCounts.byId[folder.id] ?? 0})
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={onCreateFolder}
          className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
        >
          + New Folder
        </button>
      </div>

      {selectedFolder ? (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-slate-400">Selected folder:</span>
          <span className="text-slate-200">{selectedFolder.name}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRenameFolder(selectedFolder)}
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            Rename
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDeleteFolder(selectedFolder)}
            className="rounded-md border border-rose-500/40 px-2 py-1 text-rose-200 transition hover:border-rose-400/70 hover:text-rose-100 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      ) : null}
    </section>
  );
}
