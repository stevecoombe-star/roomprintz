"use client";

import type { ReactNode } from "react";

import { StageCatalogDrawer } from "@/components/stage/StageCatalogDrawer";
import { StageEditorHeader } from "@/components/stage/StageEditorHeader";
import { StageSummaryDrawer } from "@/components/stage/StageSummaryDrawer";
import { useOptionalStageEditor } from "@/components/stage/StageEditorContext";

export function StageEditorShell({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const stage = useOptionalStageEditor();
  if (!active || !stage) return children;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-stage-shell="true">
      <StageEditorHeader />
      <div
        className="relative flex min-h-0 flex-1 overflow-hidden"
        data-stage-workspace="true"
      >
        <StageCatalogDrawer />
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
          {children}
        </div>
        <StageSummaryDrawer />
      </div>
    </div>
  );
}
