import type { MyRoomsRoom, MyRoomsSortMode } from "@/components/my-rooms/types";

function tryDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function roomRecencyDate(room: MyRoomsRoom): Date {
  return (
    tryDate(room.sort_key) ??
    tryDate(room.last_opened_at) ??
    tryDate(room.updated_at) ??
    tryDate(room.created_at) ??
    new Date(0)
  );
}

export function formatRoomRecencyLabel(room: MyRoomsRoom): string {
  const target =
    tryDate(room.last_opened_at) ??
    tryDate(room.updated_at) ??
    tryDate(room.sort_key) ??
    tryDate(room.created_at);
  if (!target) return "Recently edited";

  const now = new Date();
  const diffMs = now.getTime() - target.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Edited just now";
  if (diffMs < hour) return `Edited ${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `Edited ${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < day * 2) return "Edited yesterday";

  const formatted = target.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Edited ${formatted}`;
}

export function sortRooms(rooms: MyRoomsRoom[], sortMode: MyRoomsSortMode): MyRoomsRoom[] {
  const byTitle = (room: MyRoomsRoom) => room.title.trim().toLowerCase();
  const recency = (room: MyRoomsRoom) => roomRecencyDate(room).getTime();

  const sorted = [...rooms];
  sorted.sort((a, b) => {
    if (sortMode === "most_recent") {
      return recency(b) - recency(a);
    }
    if (sortMode === "oldest") {
      return recency(a) - recency(b);
    }
    if (sortMode === "title_asc") {
      return byTitle(a).localeCompare(byTitle(b));
    }
    return byTitle(b).localeCompare(byTitle(a));
  });
  return sorted;
}

export function scopeLabel(args: {
  selectedScope: "all" | "recents" | "folder";
  selectedFolderName: string | null;
  searchQuery: string;
}): string {
  const query = args.searchQuery.trim();
  if (query) {
    return `Search results for "${query}"`;
  }
  if (args.selectedScope === "folder") {
    return args.selectedFolderName ? `Folder: ${args.selectedFolderName}` : "Folder";
  }
  if (args.selectedScope === "recents") return "Recents";
  return "All Rooms";
}
