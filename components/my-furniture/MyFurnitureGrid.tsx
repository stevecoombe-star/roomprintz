import { MyFurnitureCard } from "@/components/my-furniture/MyFurnitureCard";
import type { MyFurnitureItem } from "@/lib/myFurniture";

type MyFurnitureGridProps = {
  items: MyFurnitureItem[];
  onOpen: (item: MyFurnitureItem) => void;
  onUseInRoom: (itemId: string) => void;
  onMoveToFolder: (itemId: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelected: (itemId: string) => void;
  actingItemId: string | null;
};

export function MyFurnitureGrid({
  items,
  onOpen,
  onUseInRoom,
  onMoveToFolder,
  selectionMode,
  selectedIds,
  onToggleSelected,
  actingItemId,
}: MyFurnitureGridProps) {
  return (
    <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {items.map((item) => (
        <MyFurnitureCard
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
