import type { ReactNode } from "react";

import { assertDesignStudioDevelopmentOnly } from "./dev-only";

export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: ReactNode }) {
  assertDesignStudioDevelopmentOnly();
  return children;
}
