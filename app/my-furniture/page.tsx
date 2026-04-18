import { Suspense } from "react";
import { MyFurniturePageClient } from "@/components/my-furniture/MyFurniturePageClient";

export default function MyFurnitureRoutePage() {
  return (
    <Suspense fallback={null}>
      <MyFurniturePageClient />
    </Suspense>
  );
}
