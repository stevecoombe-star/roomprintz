import { MyFurnitureRow } from "@/components/my-furniture/MyFurnitureRow";
import type { MyFurnitureItem } from "@/lib/myFurniture";

type MyFurnitureListProps = {
  items: MyFurnitureItem[];
  onOpen: (item: MyFurnitureItem) => void;
  onUseInRoom: (itemId: string) => void;
  actingItemId: string | null;
};

export function MyFurnitureList({
  items,
  onOpen,
  onUseInRoom,
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
          isActing={actingItemId === item.id}
        />
      ))}
    </section>
  );
}
