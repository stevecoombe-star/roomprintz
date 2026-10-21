"use client";

import type { ReactNode } from "react";

import { HarmonizeExportProvider } from "@/components/stage/HarmonizeExportContext";
import { RemoveAlignmentProvider } from "@/components/stage/RemoveAlignmentSession";
import { StageCatalogDrawer } from "@/components/stage/StageCatalogDrawer";
import { StageEditorHeader } from "@/components/stage/StageEditorHeader";
import { StageSummaryDrawer } from "@/components/stage/StageSummaryDrawer";
import { useOptionalStageEditor } from "@/components/stage/StageEditorContext";

export function StageEditorShell({
  active,
  roomId,
  onCleanupHistoryAccepted,
  children,
}: {
  active: boolean;
  roomId: string | null;
  onCleanupHistoryAccepted?: (roomId: string) => void | Promise<void>;
  children: ReactNode;
}) {
  const stage = useOptionalStageEditor();
  if (!active || !stage) return children;

  return (
    <HarmonizeExportProvider>
      <RemoveAlignmentProvider roomId={roomId} onCleanupHistoryAccepted={onCleanupHistoryAccepted}>
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
      </RemoveAlignmentProvider>
    </HarmonizeExportProvider>
  );
}
