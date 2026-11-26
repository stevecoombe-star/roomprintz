import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CreateFolderDialog } from "@/components/my-rooms/CreateFolderDialog";
import { MyRoomsGrid } from "@/components/my-rooms/MyRoomsGrid";
import { MyRoomsLayout } from "@/components/my-rooms/MyRoomsLayout";
import { MyRoomsSidebar } from "@/components/my-rooms/MyRoomsSidebar";
import { RoomCard } from "@/components/my-rooms/RoomCard";
import type { MyRoomsFolder, MyRoomsRoom } from "@/components/my-rooms/types";

const folder: MyRoomsFolder = {
  id: "folder-1",
  name: "Living",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  room_count: 1,
};

const room: MyRoomsRoom = {
  id: "room-1",
  title: "Living Room",
  folder_id: null,
  folder_name: null,
  current_stage: 1,
  selected_model: null,
  cover_image_url: null,
  display_image_url: "https://cdn.example/room.jpg",
  preview_status: "ready",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  last_opened_at: "2026-01-02T00:00:00.000Z",
  sort_key: "2026-01-02T00:00:00.000Z",
};

test("My Rooms adopts the retail surface without changing the room card contract", () => {
  const header = readFileSync("components/my-rooms/MyRoomsHeader.tsx", "utf8");
  assert.match(header, /variant="primary"/);
  assert.match(header, /size="large"/);
  assert.match(header, />\s*Start New Room\s*</);
  assert.match(header, /href="\/my-furniture"/);
  assert.match(header, /<Link\b/);
  assert.match(header, /bg-canvas/);
  assert.match(header, /text-ink/);
  assert.doesNotMatch(header, /slate-/);

  const sidebar = renderToStaticMarkup(
    <MyRoomsSidebar
      selectedScope="all"
      selectedFolderId={null}
      folders={[folder]}
      totalRoomsCount={1}
      folderFeatureReady
      mutatingFolderId={null}
      onSelectAllRooms={() => undefined}
      onSelectRecents={() => undefined}
      onSelectFolder={() => undefined}
      onCreateFolder={() => undefined}
      onRenameFolder={() => undefined}
      onDeleteFolder={() => undefined}
    />,
  );
  assert.match(sidebar, /bg-canvas-warm/);
  assert.match(sidebar, /class="[^"]*bg-tool[^"]*underline[^"]*"/);
  assert.match(sidebar, /aria-current="page"/);
  assert.match(sidebar, /text-danger/);
  assert.doesNotMatch(sidebar, /slate-/);

  const layout = renderToStaticMarkup(
    <MyRoomsLayout sidebar={null} header={null} contextBar={null} grid={null} />,
  );
  assert.match(layout, /scheme-light/);
  assert.match(layout, /bg-canvas/);
  assert.match(layout, /text-ink/);

  const card = renderToStaticMarkup(
    <RoomCard
      room={room}
      folders={[folder]}
      onOpen={() => undefined}
      onRename={() => undefined}
      onMoveToFolder={async () => undefined}
      onDelete={() => undefined}
      onRefreshThumbnail={() => undefined}
      isRefreshingThumbnail={false}
      isBusy={false}
    />,
  );
  assert.match(card, /aspect-\[4\/3\]/);
  assert.match(card, /object-cover/);
  assert.match(card, /src="https:\/\/cdn\.example\/room\.jpg"/);
  assert.match(card, /aria-label="Open Living Room"/);
  assert.match(card, /aria-label="Refresh thumbnail"/);
  assert.match(card, /aria-label="Actions for Living Room"/);
  assert.match(card, /text-ink/);
  assert.doesNotMatch(card, /slate-/);

  const empty = renderToStaticMarkup(
    <MyRoomsGrid
      rooms={[]}
      folders={[]}
      isLoading={false}
      emptyState={{ title: "No rooms yet", description: "Create one.", actionLabel: "Open Editor", onAction: () => undefined }}
      mutatingRoomId={null}
      refreshingRoomIds={new Set()}
      onOpenRoom={() => undefined}
      onRenameRoom={() => undefined}
      onMoveRoom={async () => undefined}
      onDeleteRoom={() => undefined}
      onRefreshThumbnail={() => undefined}
    />,
  );
  assert.match(empty, /data-variant="primary"/);
  assert.match(empty, /data-size="large"/);
  assert.match(empty, /Open Editor/);
  assert.match(empty, /bg-canvas-warm/);

  const dialog = renderToStaticMarkup(
    <CreateFolderDialog open onClose={() => undefined} onCreate={async () => undefined} isSaving={false} errorMessage={null} />,
  );
  assert.match(dialog, /scheme-light/);
  assert.match(dialog, /type="submit"/);
  assert.match(dialog, /data-variant="primary"/);
  assert.match(dialog, /data-variant="outline"/);

  const page = readFileSync("components/my-rooms/MyRoomsPage.tsx", "utf8");
  const cardSource = readFileSync("components/my-rooms/RoomCard.tsx", "utf8");
  assert.match(page, /variant="destructive"/);
  assert.match(page, /variant="primary"/);
  assert.match(page, /router\.push\("\/editor\?newRoom=1"\)/);
  assert.match(cardSource, /group-hover:opacity-100/);
  assert.match(cardSource, /focus-visible:ring-2/);
  assert.match(cardSource, /left-2 top-2/);
  assert.match(cardSource, /absolute right-2 top-2/);
  assert.doesNotMatch(`${page}\n${cardSource}`, /slate-|#[0-9A-Fa-f]{3,8}\b/);
  assert.doesNotMatch(readFileSync("components/my-furniture/MyFurniturePageClient.tsx", "utf8"), /VibodeButton|VibodeIconButton/);
});
