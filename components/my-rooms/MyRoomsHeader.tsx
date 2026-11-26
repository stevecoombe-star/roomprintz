"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { myRoomsFieldClass } from "@/components/my-rooms/surface";
import type { MyRoomsSortMode } from "@/components/my-rooms/types";
import { VibodeButton, vibodeButtonClassName } from "@/components/ui/VibodeButton";

type MyRoomsHeaderProps = {
  searchQuery: string;
  sortMode: MyRoomsSortMode;
  folderFeatureReady: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (value: MyRoomsSortMode) => void;
  onUploadNewPhoto: () => void;
  onCreateFolder: () => void;
  tokenBadge?: ReactNode;
};

export function MyRoomsHeader({
  searchQuery,
  sortMode,
  folderFeatureReady,
  onSearchChange,
  onSortChange,
  onUploadNewPhoto,
  onCreateFolder,
  tokenBadge,
}: MyRoomsHeaderProps) {
  return (
    <header className="rounded-2xl border border-line bg-canvas p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">My Rooms</h1>
          <p className="mt-1 text-xs text-ink-secondary">
            Browse, reopen, and organize your latest creative rooms.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tokenBadge}
          <Link
            href="/my-furniture"
            className={vibodeButtonClassName({ variant: "outline", size: "standard" })}
          >
            My Furniture
          </Link>
          <VibodeButton type="button" variant="primary" size="large" onClick={onUploadNewPhoto}>
            Start New Room
          </VibodeButton>
          <VibodeButton
            type="button"
            variant="outline"
            size="standard"
            onClick={onCreateFolder}
            disabled={!folderFeatureReady}
          >
            New Folder
          </VibodeButton>
          <SignOutButton className={vibodeButtonClassName({ variant: "outline", size: "standard" })} />
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
            className={`${myRoomsFieldClass} text-sm`}
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
            className={`${myRoomsFieldClass} text-sm`}
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
