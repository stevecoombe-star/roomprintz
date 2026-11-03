"use client";

import type { ReactNode } from "react";

import { BringForwardProvider } from "@/components/stage/BringForwardSession";
import { HarmonizeExportProvider } from "@/components/stage/HarmonizeExportContext";
import { RemoveAlignmentProvider } from "@/components/stage/RemoveAlignmentSession";
import { StageCatalogDrawer } from "@/components/stage/StageCatalogDrawer";
import { StageEditorHeader } from "@/components/stage/StageEditorHeader";
import { StageSummaryDrawer } from "@/components/stage/StageSummaryDrawer";
import { useOptionalStageEditor } from "@/components/stage/StageEditorContext";

export function StageEditorShell({
  active,
  roomId,
  activeHistoryAssetId = null,
  activeHistoryImageUrl = null,
  alignmentGenerationId = null,
  onCleanupHistoryAccepted,
  onRemoveEditSaved,
  children,
}: {
  active: boolean;
  roomId: string | null;
  activeHistoryAssetId?: string | null;
  activeHistoryImageUrl?: string | null;
  alignmentGenerationId?: string | null;
  onCleanupHistoryAccepted?: (
    roomId: string,
    assetId: string,
    stillCurrent: () => boolean,
  ) => Promise<void>;
  onRemoveEditSaved?: (roomId: string, assetId: string) => Promise<void>;
  children: ReactNode;
}) {
  const stage = useOptionalStageEditor();
  if (!active || !stage) return children;

  return (
    <HarmonizeExportProvider>
      <RemoveAlignmentProvider
        roomId={roomId}
        activeHistoryAssetId={activeHistoryAssetId}
        activeHistoryImageUrl={activeHistoryImageUrl}
        alignmentGenerationId={alignmentGenerationId}
        onCleanupHistoryAccepted={onCleanupHistoryAccepted}
        onRemoveEditSaved={onRemoveEditSaved}
      >
      <BringForwardProvider>
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
      </BringForwardProvider>
      </RemoveAlignmentProvider>
    </HarmonizeExportProvider>
  );
}
