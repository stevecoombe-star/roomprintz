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
export type AfcUi2aPreparationSelector = Readonly<{ preparationId: string; receiptFileName: string; receiptSha256: string; roomId: string }>;
export type AfcUi2aPackageSummary = Readonly<{
  packageId: string; roomId: string; receipt: Readonly<{ fileName: string; sha256: string; reused?: boolean }>;
  manifest: Readonly<{ fileName: string; sha256: string; contractVersion: string; disposition?: string }>; originalPreparationId: string;
  original: Readonly<{ fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: 1 }>;
  emptyRoomAssist: Readonly<{ fileName: string; sha256: string; byteCount: number; mimeType: string; decodedWidth: number; decodedHeight: number; orientation: 1; generatedFromOriginalSha256: string; generatorId: string; requestedModelId: "NBP"; resolvedModelStatus: "not_reported_by_compositor" }>;
  compatibility: Readonly<{ version: string; tier: "exact_grid_compatible"; relativeAspectErrorRaw: number; relativeAspectError: number }>;
  sharedContextDigest: string;
  safety: Readonly<{ emptyRoomGenerationCall: false; geminiFloorProposalCall: false; afcR2Run: false }>;
}>;
export type AfcUi2aCompletionResult =
  | Readonly<{ status: "package_completed"; roomId: string; originalPreparationId: string; emptyResolutionSource: "disk_reused" | "cache_hit" | "generated"; emptyRoomGenerationCall: boolean; package: AfcUi2aPackageSummary; attemptSafety: Readonly<{ packageReplayVerified: true; emptyRoomGenerationCall: boolean }> }>
  | Readonly<{ status: "empty_generation_required"; roomId: string; originalPreparationId: string; requestedModelId: "NBP"; expectedCompositorCallCount: 1; emptyRoomGenerationCall: false }>
  | Readonly<{ status: "failure"; failureCode: string; message: string; emptyRoomGenerationCall: boolean }>;
export type AfcUi2aCompletionStatus = "idle" | "resolving" | "generation_required" | "materializing" | "completed" | "failure";
export type AfcUi2aPackageClientState = Readonly<{
  inventoryStatus: "idle" | "loading" | "loaded" | "failure";
  completionStatus: AfcUi2aCompletionStatus;
  packages: readonly AfcUi2aPackageSummary[];
  invalidCandidateCount: number;
  lastCompletion: AfcUi2aCompletionResult | null;
  completionFailure: string | null;
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
export function createAfcUi2aInitialPackageClientState(): AfcUi2aPackageClientState {
  return Object.freeze({
    inventoryStatus: "idle" as const, completionStatus: "idle" as const, packages: Object.freeze([]),
    invalidCandidateCount: 0, lastCompletion: null, completionFailure: null,
  });
}
export function buildAfcUi2aCompleteRequest(
  roomLabel: string,
  preparation: AfcUi2aPreparationSelector,
  currentExpectedFingerprint: string | undefined,
  authorizeGeneration: boolean,
) {
  return Object.freeze({
    contractVersion: "afc-ui2a-complete-request/v1" as const,
    roomLabel,
    originalPreparation: Object.freeze({
      preparationId: preparation.preparationId, receiptFileName: preparation.receiptFileName, receiptSha256: preparation.receiptSha256,
    }),
    ...(currentExpectedFingerprint === undefined ? {} : { currentExpectedFingerprint }),
    executeCapture: true as const,
    ...(authorizeGeneration ? { executeEmptyRoomGeneration: true as const } : {}),
  });
}
export function buildAfcUi2aPackageInventoryUrl(roomId: string): string {
  return `/api/admin/3d-room-lab/afc-ui2a/packages?roomLabel=${encodeURIComponent(roomId)}`;
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
  const [selectedPreparation, setSelectedPreparation] = useState<AfcUi2aPreparationSelector | null>(null);
  const [packageInventoryStatus, setPackageInventoryStatus] = useState<"idle" | "loading" | "loaded" | "failure">("idle");
  const [packages, setPackages] = useState<readonly AfcUi2aPackageSummary[]>([]);
  const [invalidPackageCandidateCount, setInvalidPackageCandidateCount] = useState(0);
  const [completionStatus, setCompletionStatus] = useState<AfcUi2aCompletionStatus>("idle");
  const [lastCompletion, setLastCompletion] = useState<AfcUi2aCompletionResult | null>(null);
  const [completionFailure, setCompletionFailure] = useState<string | null>(null);
  const prepareGeneration = useRef(createAfcUi2aRequestGuard());
  const statusGeneration = useRef(createAfcUi2aRequestGuard());
  const packageGeneration = useRef(createAfcUi2aRequestGuard());
  const completionGeneration = useRef(createAfcUi2aRequestGuard());
  const identity = currentImageIdentity(currentImage);
  const [operationIdentity, setOperationIdentity] = useState<string | null>(identity);

  useEffect(() => {
    prepareGeneration.current.invalidate();
    packageGeneration.current.invalidate();
    completionGeneration.current.invalidate();
  }, [identity]); // identity deliberately captures all descriptor identity fields
  useEffect(() => () => {
    prepareGeneration.current.invalidate();
    statusGeneration.current.invalidate();
    packageGeneration.current.invalidate();
    completionGeneration.current.invalidate();
  }, []);

  const clear = useCallback(() => {
    prepareGeneration.current.invalidate();
    statusGeneration.current.invalidate();
    packageGeneration.current.invalidate();
    completionGeneration.current.invalidate();
    setOperationIdentity(currentImageIdentity(currentImage));
    setPrepared(null);
    setFailure(null);
    setPinnedFingerprint(null);
    setInventory([]);
    setInventoryError(null);
    setSelectedPreparation(null);
    setPackages([]);
    setInvalidPackageCandidateCount(0);
    setPackageInventoryStatus("idle");
    setCompletionStatus("idle");
    setLastCompletion(null);
    setCompletionFailure(null);
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
        setSelectedPreparation({
          roomId: success.roomId, preparationId: success.preparationId,
          receiptFileName: success.receipt.fileName, receiptSha256: success.receipt.sha256,
        });
        packageGeneration.current.invalidate();
        completionGeneration.current.invalidate();
        setPackages([]);
        setInvalidPackageCandidateCount(0);
        setPackageInventoryStatus("idle");
        setCompletionStatus("idle");
        setLastCompletion(null);
        setCompletionFailure(null);
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

  const resetCompletion = useCallback(() => {
    packageGeneration.current.invalidate();
    completionGeneration.current.invalidate();
    setPackages([]);
    setInvalidPackageCandidateCount(0);
    setPackageInventoryStatus("idle");
    setCompletionStatus("idle");
    setLastCompletion(null);
    setCompletionFailure(null);
  }, []);
  const selectPreparation = useCallback((entry: AfcUi2aPreparationSelector | null) => {
    setSelectedPreparation(entry);
    resetCompletion();
  }, [resetCompletion]);
  const changeRoomLabel = useCallback((value: string) => {
    setRoomLabel(value);
    resetCompletion();
  }, [resetCompletion]);
  const refreshPackageInventory = useCallback(async () => {
    if (!enabled || !selectedPreparation) return;
    const generation = packageGeneration.current.begin();
    setPackageInventoryStatus("loading");
    try {
      const response = await fetch(buildAfcUi2aPackageInventoryUrl(selectedPreparation.roomId), { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!packageGeneration.current.isCurrent(generation)) return;
      if (!response.ok || !body || typeof body !== "object" || (body as { status?: unknown }).status !== "inventory" || !Array.isArray((body as { packages?: unknown }).packages)) {
        setPackageInventoryStatus("failure");
        return;
      }
      setPackages((body as { packages: readonly AfcUi2aPackageSummary[] }).packages);
      setInvalidPackageCandidateCount(typeof (body as { invalidCandidateCount?: unknown }).invalidCandidateCount === "number" ? (body as { invalidCandidateCount: number }).invalidCandidateCount : 0);
      setPackageInventoryStatus("loaded");
    } catch {
      if (packageGeneration.current.isCurrent(generation)) setPackageInventoryStatus("failure");
    }
  }, [enabled, selectedPreparation]);
  const completePreparedPackage = useCallback(async (approveGeneration: boolean) => {
    if (!enabled || !currentImage || !selectedPreparation || completionStatus === "resolving" || completionStatus === "materializing") return;
    const generation = completionGeneration.current.begin();
    setCompletionStatus(approveGeneration ? "materializing" : "resolving");
    setCompletionFailure(null);
    try {
      const response = await fetch("/api/admin/3d-room-lab/afc-ui2a/complete", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAfcUi2aCompleteRequest(selectedPreparation.roomId, selectedPreparation, currentImage.expectedFingerprint, approveGeneration)),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!completionGeneration.current.isCurrent(generation)) return;
      if (!body || typeof body !== "object" || !["package_completed", "empty_generation_required", "failure"].includes(String((body as { status?: unknown }).status))) {
        setCompletionStatus("failure");
        setCompletionFailure("Prepared-package completion returned an invalid response.");
        return;
      }
      const result = body as AfcUi2aCompletionResult;
      setLastCompletion(result);
      if (result.status === "package_completed") {
        setCompletionStatus("completed");
        void refreshPackageInventory();
      } else if (result.status === "empty_generation_required") {
        setCompletionStatus("generation_required");
      } else {
        setCompletionStatus("failure");
        setCompletionFailure(result.message);
      }
    } catch {
      if (completionGeneration.current.isCurrent(generation)) {
        setCompletionStatus("failure");
        setCompletionFailure("Prepared-package completion could not be completed.");
      }
    }
  }, [completionStatus, currentImage, enabled, refreshPackageInventory, selectedPreparation]);

  const active = operationIdentity === identity;
  const visibleStatus = active ? status : initialStatus(enabled, currentImage);
  return useMemo(() => ({
    status: visibleStatus, roomLabel, setRoomLabel, prepared: active ? prepared : null, failure: active ? failure : null,
    pinnedFingerprint: active ? pinnedFingerprint : null, inventory, inventoryError,
    selectedPreparation: active ? selectedPreparation : null, selectPreparation, changeRoomLabel,
    packageInventoryStatus: active ? packageInventoryStatus : "idle", packages: active ? packages : [], invalidPackageCandidateCount: active ? invalidPackageCandidateCount : 0,
    completionStatus: active ? completionStatus : "idle", lastCompletion: active ? lastCompletion : null, completionFailure: active ? completionFailure : null,
    requestGenerationInFlight: active && (completionStatus === "resolving" || completionStatus === "materializing"),
    prepare, refreshInventory, refreshPackageInventory, completePreparedPackage, clear,
  }), [visibleStatus, roomLabel, active, prepared, failure, pinnedFingerprint, inventory, inventoryError, selectedPreparation, selectPreparation, changeRoomLabel, packageInventoryStatus, packages, invalidPackageCandidateCount, completionStatus, lastCompletion, completionFailure, prepare, refreshInventory, refreshPackageInventory, completePreparedPackage, clear]);
}
