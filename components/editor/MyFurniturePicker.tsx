"use client";

import React from "react";

export type MyFurniturePickerMode = "add" | "swap";

export type MyFurniturePickerItem = {
  id: string;
  userSkuId: string;
  displayName: string | null;
  previewImageUrl: string | null;
  sourceUrl: string | null;
  category: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
  createdAt: string;
};

type MyFurniturePickerProps = {
  open: boolean;
  mode: MyFurniturePickerMode | null;
  items: MyFurniturePickerItem[];
  loading: boolean;
  selectingId: string | null;
  onClose: () => void;
  onSelect: (item: MyFurniturePickerItem) => void;
};

function formatTimestamp(value: string | null): string {
  if (!value) return "Never used";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Never used";
  return new Date(timestamp).toLocaleString();
}

export function MyFurniturePicker(props: MyFurniturePickerProps) {
  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <div className="text-sm font-medium">My Furniture</div>
            <div className="text-xs text-neutral-400">
              Pick furniture to use in your room.
            </div>
          </div>
          <button
            type="button"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-800"
            onClick={props.onClose}
          >
            Close
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {props.loading ? (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-300">
              Loading saved furniture...
            </div>
          ) : props.items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-700 bg-neutral-900/60 p-6 text-sm text-neutral-400">
              No saved furniture yet. Ingest an item first, then it will appear here.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {props.items.map((item) => {
                const previewUrl = item.previewImageUrl;
                const isSelecting = props.selectingId === item.id;
                const label = item.displayName || item.userSkuId;
                const subtitle = item.category ?? item.sourceUrl ?? "Saved item";
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-left transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isSelecting}
                    onClick={() => props.onSelect(item)}
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-neutral-800 bg-neutral-950">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={label}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                          No preview
                        </div>
                      )}
                    </div>
                    <div className="mt-2 truncate text-sm font-medium text-neutral-100">{label}</div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500">{subtitle}</div>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      Used {item.timesUsed} {item.timesUsed === 1 ? "time" : "times"} •{" "}
                      Last used: {formatTimestamp(item.lastUsedAt)}
                    </div>
                    {isSelecting ? (
                      <div className="mt-2 text-xs text-blue-300">Preparing...</div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
