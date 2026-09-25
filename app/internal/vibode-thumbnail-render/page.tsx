import { Suspense } from "react";

import { ThumbnailRenderFrame } from "./ThumbnailRenderFrame";

export const dynamic = "force-dynamic";

export default function VibodeThumbnailRenderPage() {
  return (
    <Suspense fallback={null}>
      <ThumbnailRenderFrame />
    </Suspense>
  );
}
