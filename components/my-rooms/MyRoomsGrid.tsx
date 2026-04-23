"use client";

import { RoomCard } from "@/components/my-rooms/RoomCard";
import type { MyRoomsFolder, MyRoomsRoom } from "@/components/my-rooms/types";

type EmptyState = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

type MyRoomsGridProps = {
  rooms: MyRoomsRoom[];
  folders: MyRoomsFolder[];
  isLoading: boolean;
  emptyState: EmptyState | null;
  mutatingRoomId: string | null;
  onOpenRoom: (room: MyRoomsRoom) => void;
  onRenameRoom: (room: MyRoomsRoom) => void;
  onMoveRoom: (room: MyRoomsRoom, folderId: string | null) => Promise<void>;
  onDeleteRoom: (room: MyRoomsRoom) => void;
};

function LoadingSkeletonGrid() {
  return (
    <div className="mt-4">
      <p className="mb-3 text-xs text-slate-400">Loading your saved rooms...</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse overflow-hidden rounded-2xl border border-slate-800/70 bg-slate-900/50"
          >
            <div className="aspect-[4/3] w-full bg-slate-800/80" />
            <div className="px-2 pb-3 pt-2">
              <div className="h-3 w-2/3 rounded bg-slate-800/80" />
              <div className="mt-2 h-2.5 w-1/2 rounded bg-slate-800/70" />
              <div className="mt-2 h-2.5 w-5/6 rounded bg-slate-800/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyRoomsState({ state }: { state: EmptyState }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/35 px-6 py-10 text-center">
      <h3 className="text-base font-medium text-slate-100">{state.title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-400">{state.description}</p>
      {state.actionLabel && state.onAction ? (
        <button
          type="button"
          onClick={state.onAction}
          className="mt-5 rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-400 hover:text-white"
        >
          {state.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function MyRoomsGrid({
  rooms,
  folders,
  isLoading,
  emptyState,
  mutatingRoomId,
  onOpenRoom,
  onRenameRoom,
  onMoveRoom,
  onDeleteRoom,
}: MyRoomsGridProps) {
  if (isLoading) return <LoadingSkeletonGrid />;
  if (emptyState) return <EmptyRoomsState state={emptyState} />;

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          folders={folders}
          onOpen={() => onOpenRoom(room)}
          onRename={() => onRenameRoom(room)}
          onDelete={() => onDeleteRoom(room)}
          onMoveToFolder={(folderId) => onMoveRoom(room, folderId)}
          isBusy={mutatingRoomId === room.id}
        />
      ))}
    </div>
  );
}
