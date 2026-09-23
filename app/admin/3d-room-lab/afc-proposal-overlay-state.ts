"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AfcProposalOverlayFailure,
  AfcProposalOverlayViewModel,
  AfcProposalReceiptSummary,
} from "./research/afc-proposal-overlay-view-model";
import {
  DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS,
  type AfcViewportDisplayControls,
} from "./afc-main-viewport-evidence";

export type AfcProposalOverlayLoadStatus = "unloaded" | "loading" | "valid" | "invalid" | "basis_mismatch" | "unsupported";
export type AfcProposalOverlayImageRole = "original" | "empty";
export type AfcProposalReceiptInventoryStatus = "idle" | "loading" | "loaded" | "failure";
export type AfcProposalReceiptInventoryState = Readonly<{
  status: AfcProposalReceiptInventoryStatus;
  receipts: readonly AfcProposalReceiptSummary[];
  invalidCandidateCount: number;
}>;
export type AfcProposalOverlayControls = Readonly<{
  showFill: boolean;
  showStroke: boolean;
  showCornerMarkers: boolean;
  showCornerNames: boolean;
  showNormalizedCoordinates: boolean;
  showSupportLabels: boolean;
  showEvidence: boolean;
  opacity: number;
}>;

const ROUTE = "/api/admin/3d-room-lab/afc-r3c/proposal-overlay";
export const DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS: AfcProposalOverlayControls = Object.freeze({
  showFill: true, showStroke: true, showCornerMarkers: true, showCornerNames: true,
  showNormalizedCoordinates: true, showSupportLabels: true, showEvidence: true, opacity: 0.32,
});

export function polygonPoints(viewModel: AfcProposalOverlayViewModel): string {
  return ["NL", "NR", "FR", "FL"].map((name) => {
    const point = viewModel.corners[name as keyof AfcProposalOverlayViewModel["corners"]];
    return `${point.x * 100},${point.y * 100}`;
  }).join(" ");
}

function isFailure(value: unknown): value is AfcProposalOverlayFailure {
  return !!value && typeof value === "object" && ["invalid", "basis_mismatch", "unsupported"].includes((value as { status?: string }).status ?? "") &&
    typeof (value as { reason?: unknown }).reason === "string" && typeof (value as { path?: unknown }).path === "string";
}
function errorMessage(value: unknown): string {
  return isFailure(value) ? `${value.reason} (${value.path})` : "The AFC evidence route returned an invalid response.";
}

/** Pure monotonic gate instantiated independently for asynchronous operation domains. */
export function createAfcProposalOverlayRequestGuard() {
  let current = 0;
  return Object.freeze({
    begin: () => ++current,
    invalidate: () => ++current,
    isCurrent: (generation: number) => generation === current,
    current: () => current,
  });
}

export function reconcileAfcProposalReceiptSelection(
  selectedReceiptFileName: string,
  receipts: readonly AfcProposalReceiptSummary[]
): string {
  return selectedReceiptFileName &&
    receipts.some((receipt) => receipt.receiptFileName === selectedReceiptFileName)
    ? selectedReceiptFileName
    : "";
}

export const EMPTY_AFC_PROPOSAL_RECEIPT_INVENTORY: AfcProposalReceiptInventoryState =
  Object.freeze({ status: "idle", receipts: Object.freeze([]), invalidCandidateCount: 0 });

export function loadingAfcProposalReceiptInventoryTransition(
  current: AfcProposalReceiptInventoryState
): AfcProposalReceiptInventoryState {
  return Object.freeze({ ...current, status: "loading" });
}

export function loadedAfcProposalReceiptInventoryTransition(
  receipts: readonly AfcProposalReceiptSummary[],
  invalidCandidateCount: number
): AfcProposalReceiptInventoryState {
  return Object.freeze({ status: "loaded", receipts, invalidCandidateCount });
}

export function failedAfcProposalReceiptInventoryTransition(
  current: AfcProposalReceiptInventoryState
): AfcProposalReceiptInventoryState {
  return Object.freeze({ ...current, status: "failure" });
}

export function verifiedImageUrl(receiptFileName: string, receiptSha256: string, role: AfcProposalOverlayImageRole): string {
  return `${ROUTE}?operation=image&receipt=${encodeURIComponent(receiptFileName)}&receiptSha256=${encodeURIComponent(receiptSha256)}&role=${role}`;
}

export function imageFailureTransition(reason: string): Readonly<{
  status: "invalid";
  imageUrl: null;
  error: string;
}> {
  return Object.freeze({
    status: "invalid" as const,
    imageUrl: null,
    error: `${reason} The proposal overlay is withheld until a verified image is loaded.`,
  });
}

export function canRenderAfcProposalOverlay(status: AfcProposalOverlayLoadStatus, imageUrl: string | null): imageUrl is string {
  return status === "valid" && typeof imageUrl === "string" && imageUrl.length > 0;
}

export function useAfcProposalOverlayState(enabled: boolean) {
  const [status, setStatus] = useState<AfcProposalOverlayLoadStatus>("unloaded");
  const [receiptInventory, setReceiptInventory] = useState<AfcProposalReceiptInventoryState>(
    EMPTY_AFC_PROPOSAL_RECEIPT_INVENTORY
  );
  const [selectedReceiptFileName, setSelectedReceiptFileName] = useState("");
  const [viewModel, setViewModel] = useState<AfcProposalOverlayViewModel | null>(null);
  const [imageRole, setImageRole] = useState<AfcProposalOverlayImageRole>("empty");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageRequestGeneration, setImageRequestGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [controls, setControls] = useState<AfcProposalOverlayControls>(DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS);
  const [viewportControls, setViewportControls] = useState<AfcViewportDisplayControls>(
    DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS
  );
  const loadImageRequestGenerationRef = useRef(createAfcProposalOverlayRequestGuard());
  const inventoryRequestGenerationRef = useRef(createAfcProposalOverlayRequestGuard());

  useEffect(() => () => {
    loadImageRequestGenerationRef.current.invalidate();
    inventoryRequestGenerationRef.current.invalidate();
  }, []);

  const refreshReceipts = useCallback(async () => {
    if (!enabled) return;
    const generation = inventoryRequestGenerationRef.current.begin();
    setReceiptInventory(loadingAfcProposalReceiptInventoryTransition);
    try {
      const response = await fetch(`${ROUTE}?operation=receipts`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!inventoryRequestGenerationRef.current.isCurrent(generation)) return;
      const candidateCount = (body as { invalidCandidateCount?: unknown } | null)?.invalidCandidateCount;
      if (!response.ok || !body || typeof body !== "object" ||
        (body as { status?: unknown }).status !== "valid" ||
        !Array.isArray((body as { receipts?: unknown }).receipts) ||
        typeof candidateCount !== "number" || !Number.isSafeInteger(candidateCount) || candidateCount < 0) {
        setReceiptInventory(failedAfcProposalReceiptInventoryTransition);
        return;
      }
      const discoveredReceipts = (body as { receipts: readonly AfcProposalReceiptSummary[] }).receipts;
      setReceiptInventory(loadedAfcProposalReceiptInventoryTransition(
        discoveredReceipts,
        candidateCount
      ));
      setSelectedReceiptFileName((current) =>
        reconcileAfcProposalReceiptSelection(current, discoveredReceipts)
      );
    } catch {
      if (inventoryRequestGenerationRef.current.isCurrent(generation)) {
        setReceiptInventory(failedAfcProposalReceiptInventoryTransition);
      }
    }
  }, [enabled]);

  const clear = useCallback(() => {
    loadImageRequestGenerationRef.current.invalidate();
    setStatus("unloaded");
    setSelectedReceiptFileName("");
    setViewModel(null);
    setImageUrl(null);
    setImageRequestGeneration(0);
    setImageRole("empty");
    setError(null);
    setControls(DEFAULT_AFC_PROPOSAL_OVERLAY_CONTROLS);
    setViewportControls(DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS);
  }, []);

  const selectImageRole = useCallback((role: AfcProposalOverlayImageRole) => {
    if (!viewModel) return;
    const generation = loadImageRequestGenerationRef.current.begin();
    setImageRole(role);
    setImageRequestGeneration(generation);
    setImageUrl(verifiedImageUrl(viewModel.artifactIdentity.receiptFileName, viewModel.artifactIdentity.receiptSha256, role));
  }, [viewModel]);

  const load = useCallback(async () => {
    if (!selectedReceiptFileName) return;
    const generation = loadImageRequestGenerationRef.current.begin();
    setStatus("loading");
    setViewModel(null);
    setImageUrl(null);
    setError(null);
    const response = await fetch(`${ROUTE}?operation=load&receipt=${encodeURIComponent(selectedReceiptFileName)}`, { cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!loadImageRequestGenerationRef.current.isCurrent(generation)) return;
    if (!response.ok || !body || typeof body !== "object" || (body as { status?: unknown }).status !== "valid" || !(body as { viewModel?: unknown }).viewModel) {
      const failure = isFailure(body) ? body : { status: "invalid" as const, reason: errorMessage(body), path: "$.response" };
      setStatus(failure.status);
      setError(`${failure.reason} (${failure.path})`);
      return;
    }
    const model = (body as { viewModel: AfcProposalOverlayViewModel }).viewModel;
    setViewModel(model);
    setImageRole("empty");
    setImageRequestGeneration(generation);
    setImageUrl(verifiedImageUrl(model.artifactIdentity.receiptFileName, model.artifactIdentity.receiptSha256, "empty"));
    setStatus("valid");
  }, [selectedReceiptFileName]);

  const imageFailed = useCallback((generation: number, reason = "The browser could not deliver the verified image bytes.") => {
    if (!loadImageRequestGenerationRef.current.isCurrent(generation)) return;
    const transition = imageFailureTransition(reason);
    setImageUrl(transition.imageUrl);
    setStatus(transition.status);
    setError(transition.error);
  }, []);
  const updateControls = useCallback((patch: Partial<AfcProposalOverlayControls>) => {
    setControls((current) => ({ ...current, ...patch }));
  }, []);
  const updateViewportControls = useCallback((patch: Partial<AfcViewportDisplayControls>) => {
    setViewportControls((current) => ({ ...current, ...patch }));
  }, []);

  return useMemo(() => ({
    status, receipts: receiptInventory.receipts, receiptInventoryStatus: receiptInventory.status, invalidCandidateCount: receiptInventory.invalidCandidateCount, selectedReceiptFileName, setSelectedReceiptFileName, viewModel, imageRole, imageUrl, imageRequestGeneration, error, controls, viewportControls,
    refreshReceipts, clear, load, selectImageRole, imageFailed, updateControls, updateViewportControls,
  }), [status, receiptInventory, selectedReceiptFileName, viewModel, imageRole, imageUrl, imageRequestGeneration, error, controls, viewportControls, refreshReceipts, clear, load, selectImageRole, imageFailed, updateControls, updateViewportControls]);
}
