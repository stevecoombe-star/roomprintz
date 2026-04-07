"use client";

import Link from "next/link";
import type { MyRoomsSortMode } from "@/components/my-rooms/types";

type MyRoomsHeaderProps = {
  searchQuery: string;
  sortMode: MyRoomsSortMode;
  folderFeatureReady: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (value: MyRoomsSortMode) => void;
  onUploadNewPhoto: () => void;
  onCreateFolder: () => void;
};

export function MyRoomsHeader({
  searchQuery,
  sortMode,
  folderFeatureReady,
  onSearchChange,
  onSortChange,
  onUploadNewPhoto,
  onCreateFolder,
}: MyRoomsHeaderProps) {
  return (
    <header className="rounded-2xl border border-slate-800/80 bg-slate-900/55 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">My Rooms</h1>
          <p className="mt-1 text-xs text-slate-400">
            Browse, reopen, and organize your latest creative rooms.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/my-furniture"
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            My Furniture
          </Link>
          <button
            type="button"
            onClick={onUploadNewPhoto}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white"
          >
            Start New Room
          </button>
          <button
            type="button"
            onClick={onCreateFolder}
            disabled={!folderFeatureReady}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            New Folder
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_180px]">
        <div>
          <label className="sr-only" htmlFor="my-rooms-search">
            Search rooms
          </label>
          <input
            id="my-rooms-search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search room titles"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-400"
          />
        </div>

        <div>
          <label className="sr-only" htmlFor="my-rooms-sort">
            Sort rooms
          </label>
          <select
            id="my-rooms-sort"
            value={sortMode}
            onChange={(event) => onSortChange(event.target.value as MyRoomsSortMode)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-400"
          >
            <option value="most_recent">Most Recent</option>
            <option value="oldest">Oldest</option>
            <option value="title_asc">Title A-Z</option>
            <option value="title_desc">Title Z-A</option>
          </select>
        </div>
      </div>
    </header>
  );
}
