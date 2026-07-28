"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AfcUi2aCurrentImageDescriptor = Readonly<{
  contractVersion: "afc-ui2a-current-image/v1";
  imageUrl: string;
  expectedFingerprint: string;
  expectedWidth: number;
  expectedHeight: number;
  qualificationStatus: string;
}>;
export type AfcUi2aRunnerStatus = "disabled" | "image_unqualified" | "idle" | "preparing" | "prepared" | "failed";
export type AfcUi2aPreparedResult = Readonly<{
  status: "prepared";
  preparationStage: "original_captured";
  preparationId: string;
  roomId: string;
  original: Readonly<{ fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: 1 }>;
  receipt: Readonly<{ fileName: string; sha256: string }>;
  reused: Readonly<{ original: boolean; receipt: boolean }>;
  safety: Readonly<{ emptyRoomGenerationCall: false; geminiFloorProposalCall: false; floorStateUnchanged: true; activeCameraUnchanged: true }>;
}>;
export type AfcUi2aFailure = Readonly<{ status: "failure"; failureCode: string; message: string; path?: string }>;
export type AfcUi2aStatusSummary = Readonly<{
  preparationId: string; roomId: string; originalSha256: string; decodedWidth: number; decodedHeight: number;
  mimeType: string; originalFileName: string; receiptFileName: string; receiptSha256: string; matchesCurrentFingerprint: boolean | null;
}>;

export function currentImageIdentity(image: AfcUi2aCurrentImageDescriptor | null): string | null {
  return image ? `${image.imageUrl}\n${image.expectedFingerprint}\n${image.expectedWidth}\n${image.expectedHeight}` : null;
}
export function sanitizeCurrentUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "unavailable";
  }
}
export function createAfcUi2aRequestGuard() {
  let generation = 0;
  return Object.freeze({ begin: () => ++generation, invalidate: () => ++generation, isCurrent: (candidate: number) => candidate === generation });
}
function initialStatus(enabled: boolean, currentImage: AfcUi2aCurrentImageDescriptor | null): AfcUi2aRunnerStatus {
  return !enabled ? "disabled" : currentImage ? "idle" : "image_unqualified";
}
function parsePrepared(value: unknown): AfcUi2aPreparedResult | null {
  if (!value || typeof value !== "object" || (value as { status?: unknown }).status !== "prepared") return null;
  const candidate = value as Partial<AfcUi2aPreparedResult>;
  return typeof candidate.preparationId === "string" && typeof candidate.roomId === "string" && candidate.original && candidate.receipt && candidate.reused ? candidate as AfcUi2aPreparedResult : null;
}
function parseFailure(value: unknown): AfcUi2aFailure {
  if (value && typeof value === "object" && (value as { status?: unknown }).status === "failure" && typeof (value as { failureCode?: unknown }).failureCode === "string" && typeof (value as { message?: unknown }).message === "string") {
    return value as AfcUi2aFailure;
  }
  return { status: "failure", failureCode: "unexpected_failure", message: "The preparation endpoint returned an invalid response." };
}

export function useAfcUi2aRunnerState(enabled: boolean, currentImage: AfcUi2aCurrentImageDescriptor | null) {
  const [status, setStatus] = useState<AfcUi2aRunnerStatus>(() => initialStatus(enabled, currentImage));
  const [roomLabel, setRoomLabel] = useState("");
  const [prepared, setPrepared] = useState<AfcUi2aPreparedResult | null>(null);
  const [failure, setFailure] = useState<AfcUi2aFailure | null>(null);
  const [pinnedFingerprint, setPinnedFingerprint] = useState<string | null>(null);
  const [inventory, setInventory] = useState<readonly AfcUi2aStatusSummary[]>([]);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const prepareGeneration = useRef(createAfcUi2aRequestGuard());
  const statusGeneration = useRef(createAfcUi2aRequestGuard());
  const identity = currentImageIdentity(currentImage);
  const [operationIdentity, setOperationIdentity] = useState<string | null>(identity);

  useEffect(() => {
    prepareGeneration.current.invalidate();
  }, [identity]); // identity deliberately captures all descriptor identity fields
  useEffect(() => () => {
    prepareGeneration.current.invalidate();
    statusGeneration.current.invalidate();
  }, []);

  const clear = useCallback(() => {
    prepareGeneration.current.invalidate();
    statusGeneration.current.invalidate();
    setOperationIdentity(currentImageIdentity(currentImage));
    setPrepared(null);
    setFailure(null);
    setPinnedFingerprint(null);
    setInventory([]);
    setInventoryError(null);
    setStatus(initialStatus(enabled, currentImage));
  }, [enabled, currentImage]);

  const prepare = useCallback(async () => {
    if (!enabled || !currentImage) return;
    const generation = prepareGeneration.current.begin();
    const controller = new AbortController();
    setOperationIdentity(currentImageIdentity(currentImage));
    setStatus("preparing");
    setPrepared(null);
    setFailure(null);
    setPinnedFingerprint(currentImage.expectedFingerprint);
    try {
      const response = await fetch("/api/admin/3d-room-lab/afc-ui2a/prepare", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractVersion: "afc-ui2a-prepare-original-request/v1",
          currentImage: {
            contractVersion: "afc-ui2a-current-image/v1", imageUrl: currentImage.imageUrl,
            expectedFingerprint: currentImage.expectedFingerprint, expectedWidth: currentImage.expectedWidth, expectedHeight: currentImage.expectedHeight,
          },
          roomLabel, executeCapture: true,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!prepareGeneration.current.isCurrent(generation)) return;
      const success = response.ok ? parsePrepared(body) : null;
      if (success) {
        setPrepared(success);
        setStatus("prepared");
      } else {
        setFailure(parseFailure(body));
        setStatus("failed");
      }
    } catch {
      if (!prepareGeneration.current.isCurrent(generation)) return;
      setFailure({ status: "failure", failureCode: "unexpected_failure", message: "The preparation request could not be completed." });
      setStatus("failed");
    }
  }, [enabled, currentImage, roomLabel]);

  const refreshInventory = useCallback(async () => {
    if (!enabled) return;
    const generation = statusGeneration.current.begin();
    setInventoryError(null);
    const query = currentImage ? `?expectedFingerprint=${encodeURIComponent(currentImage.expectedFingerprint)}` : "";
    try {
      const response = await fetch(`/api/admin/3d-room-lab/afc-ui2a/status${query}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!statusGeneration.current.isCurrent(generation)) return;
      if (!response.ok || !body || typeof body !== "object" || !Array.isArray((body as { preparations?: unknown }).preparations)) {
        setInventoryError("Prepared Originals could not be refreshed.");
        return;
      }
      setInventory((body as { preparations: readonly AfcUi2aStatusSummary[] }).preparations);
    } catch {
      if (statusGeneration.current.isCurrent(generation)) setInventoryError("Prepared Originals could not be refreshed.");
    }
  }, [enabled, currentImage]);

  const active = operationIdentity === identity;
  const visibleStatus = active ? status : initialStatus(enabled, currentImage);
  return useMemo(() => ({
    status: visibleStatus, roomLabel, setRoomLabel, prepared: active ? prepared : null, failure: active ? failure : null,
    pinnedFingerprint: active ? pinnedFingerprint : null, inventory, inventoryError,
    prepare, refreshInventory, clear,
  }), [visibleStatus, roomLabel, active, prepared, failure, pinnedFingerprint, inventory, inventoryError, prepare, refreshInventory, clear]);
}
