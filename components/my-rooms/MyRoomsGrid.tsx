"use client";

import { RoomCard } from "@/components/my-rooms/RoomCard";
import { roomCardImageDelivery } from "@/components/my-rooms/preview-batch";
import type { MyRoomsFolder, MyRoomsRoom } from "@/components/my-rooms/types";
import { VibodeButton } from "@/components/ui/VibodeButton";

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
  refreshingRoomIds: ReadonlySet<string>;
  onOpenRoom: (room: MyRoomsRoom) => void;
  onRenameRoom: (room: MyRoomsRoom) => void;
  onMoveRoom: (room: MyRoomsRoom, folderId: string | null) => Promise<void>;
  onDeleteRoom: (room: MyRoomsRoom) => void;
  onRefreshThumbnail: (room: MyRoomsRoom) => void;
};

function LoadingSkeletonGrid() {
  return (
    <div className="mt-4">
      <p className="mb-3 text-xs text-ink-secondary">Loading your saved rooms...</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse overflow-hidden rounded-2xl border border-line bg-canvas"
          >
            <div className="aspect-[4/3] w-full bg-quiet-pressed" />
            <div className="px-2 pb-3 pt-2">
              <div className="h-3 w-2/3 rounded bg-quiet-pressed" />
              <div className="mt-2 h-2.5 w-1/2 rounded bg-quiet-hover" />
              <div className="mt-2 h-2.5 w-5/6 rounded bg-quiet-hover" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyRoomsState({ state }: { state: EmptyState }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-line bg-canvas-warm px-6 py-10 text-center">
      <h3 className="text-base font-medium text-ink">{state.title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-secondary">{state.description}</p>
      {state.actionLabel && state.onAction ? (
        <VibodeButton type="button" variant="primary" size="large" className="mt-5" onClick={state.onAction}>
          {state.actionLabel}
        </VibodeButton>
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
  refreshingRoomIds,
  onOpenRoom,
  onRenameRoom,
  onMoveRoom,
  onDeleteRoom,
  onRefreshThumbnail,
}: MyRoomsGridProps) {
  if (isLoading) return <LoadingSkeletonGrid />;
  if (emptyState) return <EmptyRoomsState state={emptyState} />;

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rooms.map((room, index) => {
        const imageDelivery = roomCardImageDelivery(index);
        return (
          <RoomCard
            key={room.id}
            room={room}
            folders={folders}
            imageLoading={imageDelivery.loading}
            imageFetchPriority={imageDelivery.fetchPriority}
            onOpen={() => onOpenRoom(room)}
            onRename={() => onRenameRoom(room)}
            onDelete={() => onDeleteRoom(room)}
            onMoveToFolder={(folderId) => onMoveRoom(room, folderId)}
            onRefreshThumbnail={() => onRefreshThumbnail(room)}
            isRefreshingThumbnail={refreshingRoomIds.has(room.id)}
            isBusy={mutatingRoomId === room.id}
          />
        );
      })}
    </div>
  );
}
