import { MyFurnitureRow } from "@/components/my-furniture/MyFurnitureRow";
import type { MyFurnitureItem } from "@/lib/myFurniture";

type MyFurnitureListProps = {
  items: MyFurnitureItem[];
  onOpen: (item: MyFurnitureItem) => void;
  onUseInRoom: (itemId: string) => void;
  onMoveToFolder: (itemId: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (itemId: string) => void;
  actingItemId: string | null;
};

export function MyFurnitureList({
  items,
  onOpen,
  onUseInRoom,
  onMoveToFolder,
  selectionMode,
  selectedIds,
  onToggleSelected,
  actingItemId,
}: MyFurnitureListProps) {
  return (
    <section className="mt-3 space-y-2">
      {items.map((item) => (
        <MyFurnitureRow
          key={item.id}
          item={item}
          onOpen={onOpen}
          onUseInRoom={onUseInRoom}
          onMoveToFolder={onMoveToFolder}
          selectionMode={selectionMode}
          isSelected={selectedIds.has(item.id)}
          onToggleSelected={onToggleSelected}
          isActing={actingItemId === item.id}
        />
      ))}
    </section>
  );
}
