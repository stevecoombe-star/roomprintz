"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  RemoveBrushCanvas,
  type RemoveMaskHold,
  type RemoveMaskSummary,
} from "@/components/stage/RemoveBrushCanvas";
import { RemoveCleanupGeneration } from "@/components/stage/RemoveCleanupGeneration";
import { RemoveObjectOutlines } from "@/components/stage/RemoveObjectOutlines";
import {
  REMOVE_EDIT_ACTIVATE_ERROR,
  REMOVE_EDIT_ALIGNMENT_ERROR,
  REMOVE_EDIT_SAVE_ERROR,
  REMOVE_EDIT_STALE_ERROR,
  buildRemoveEditCoverage,
  bytesToBase64,
  removeEditExportAdmission,
  removeEditHasChanges,
  removeEditKeepAdmission,
  type RemoveKeepIdentity,
} from "@/lib/vibode-stage/remove-edit";
import {
  REMOVE_ALIGNMENT_NOTE,
  REMOVE_HARMONIZE_NOTE,
  REMOVE_OPACITY_PRESETS,
  initialRemoveInspectionState,
  interpretRemoveAlignmentResponse,
  reduceRemoveInspection,
  removeAlignmentArtifactPath,
  removeDecodedSizeDisagreement,
  removeFurnitureRenderingVisible,
  removeOpacityPreset,
  removeOverlayLayers,
  removeViewMode,
  type RemoveAlignmentLookup,
  type RemoveAlignmentReport,
} from "@/lib/vibode-stage/remove-alignment";
import {
  formatRemoveMaskedCoverage,
  removeBrushAdmission,
  type RemoveBrushAdmission,
  type RemoveBrushTool,
  type RemoveSessionMode,
} from "@/lib/vibode-stage/remove-mask";
import {
  REMOVE_CLEANUP_EXCLUSION_COPY,
  beginRemoveCleanupDownload,
  buildRemoveCleanupExportBody,
  cancelRemoveCleanupConfirmation,
  finishRemoveCleanupExport,
  hiddenRemoveCleanupObjects,
  initialRemoveCleanupUiState,
  openRemoveCleanupConfirmation,
  removeCleanupConfirmationSummary,
  removeCleanupExportAvailability,
  removeCleanupExportLabel,
  requestRemoveCleanupExport,
  saveRemoveCleanupZip,
  snapshotRemoveCleanupObjects,
  type RemoveCleanupSnapshotObject,
  type RemoveCleanupUiState,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import {
  REMOVE_OBJECT_EXPANSION_MAX_PX,
  applyRemoveObjectClick,
  failRemoveObjectLoad,
  formatRemoveObjectInferenceTime,
  formatRemoveObjectRejected,
  formatRemoveObjectSuppressed,
  formatRemovePredictionRejections,
  formatRemoveScanStatus,
  hideAllRemoveObjectUi,
  highlightRemoveObject,
  initialRemoveObjectUiState,
  reduceRemoveObjectSession,
  removeObjectProtectionAvailable,
  removeObjectProtectionEngaged,
  removeObjectUiIdentityKey,
  reuseRemoveObjectScan,
  showAllRemoveObjectUi,
  type RemoveObjectUiIdentity,
  type RemoveObjectUiState,
} from "@/lib/vibode-stage/remove-object-ui";
import {
  bringForwardScanKey,
  loadBringForwardScan,
  readBringForwardScan,
  readBringForwardScanError,
} from "@/lib/vibode-stage/bring-forward-cutout";
import {
  CLEANUP_HISTORY_ACTIVATION_ERROR,
  type CleanupFinalizeResult,
  shouldApplyRemoveAlignmentLookup,
} from "@/lib/vibode-stage/remove-readiness";
import {
  REMOVE_VOCABULARY_SAVE_ERROR,
  REMOVE_VOCABULARY_SCAN_CONFIRMATION,
  applyRemoveVocabularySave,
  displayedRemoveVocabularyChoice,
  initialRemoveVocabularyConfirmState,
  requestRemoveVocabularyChange,
  requestRemoveVocabularyProfile,
  saveRemoveVocabularyProfile,
  type RemoveVocabularyChoice,
  type RemoveVocabularyConfirmState,
  type RemoveVocabularyProfileResponse,
} from "@/lib/vibode-stage/remove-vocabulary-profile";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

type DisplayedSize = Readonly<{ width: number; height: number }>;

type RemoveAlignmentContextValue = Readonly<{
  roomId: string | null;
  active: boolean;
  access: RemoveAlignmentLookup["access"];
  report: RemoveAlignmentReport | null;
  opacity: number;
  furnitureHidden: boolean;
  furnitureRenderingVisible: boolean;
  disabledReason: string | null;
  mode: RemoveSessionMode;
  tool: RemoveBrushTool;
  diameterPx: number;
  featherPx: number;
  maskEpoch: number;
  sessionSerial: number;
  vocabularyRevision: number;
  objectExpansionPx: number;
  objectOutlinesVisible: boolean;
  objectProtectionEnabled: boolean;
  brushAdmission: RemoveBrushAdmission | null;
  maskSummary: RemoveMaskSummary | null;
  maskHoldRef: { current: RemoveMaskHold | null };
  revealMaskRef: { current: (() => boolean) | null };
  revealEmptyRoom: () => void;
  enter: () => void;
  exit: () => void;
  setOpacity: (opacity: number) => void;
  setPreset: (preset: (typeof REMOVE_OPACITY_PRESETS)[number]["id"]) => void;
  setFurnitureHidden: (hidden: boolean) => void;
  setMode: (mode: RemoveSessionMode) => void;
  setTool: (tool: RemoveBrushTool) => void;
  setDiameter: (diameterPx: number) => void;
  setFeather: (featherPx: number) => void;
  clearMask: () => void;
  clickObject: (x: number, y: number) => void;
  hideAllObjects: () => void;
  showAllObjects: () => void;
  setObjectExpansion: (expansionPx: number) => void;
  setObjectOutlinesVisible: (visible: boolean) => void;
  setObjectProtection: (enabled: boolean) => void;
  objectUi: RemoveObjectUiState;
  cleanupPhase: RemoveCleanupUiState["phase"];
  cleanupError: string | null;
  cleanupAvailable: boolean;
  cleanupLabel: string;
  cleanupSummary: string;
  openCleanupExport: () => void;
  cancelCleanupExport: () => void;
  downloadCleanupExport: () => void;
  noteDisplayedSize: (artifact: "original" | "empty", size: DisplayedSize) => void;
  noteMaskSummary: (summary: RemoveMaskSummary | null) => void;
  onCleanupHistoryAccepted: (roomId: string, assetId: string) => Promise<CleanupFinalizeResult>;
  noteCleanupAcceptancePending: (pending: boolean) => void;
  noteCleanupActivationBlocked: (assetId: string | null) => void;
  cleanupFinalizing: boolean;
  cleanupActivationBlocked: boolean;
  cleanupActivationError: string | null;
  cleanupActivationAssetId: string | null;
  showSavedCleanupImage: () => void;
  saveRemoveEdits: () => void;
  removeSavePhase: "idle" | "saving" | "error";
  removeSaveError: string | null;
  vocabularyChoice: RemoveVocabularyChoice;
  vocabularyPhase: RemoveVocabularyConfirmState["phase"];
  vocabularyRequested: RemoveVocabularyChoice | null;
  vocabularyError: string | null;
  requestVocabulary: (choice: RemoveVocabularyChoice) => void;
  confirmVocabulary: () => void;
  cancelVocabulary: () => void;
  keepImageUrl: string | null;
  keepAssetId: string | null;
  keepNotice: string | null;
  noteKeepIdentity: (identity: RemoveKeepIdentity) => void;
  originalDisagreement: string | null;
  emptyDisagreement: string | null;
}>;

const RemoveAlignmentContext = createContext<RemoveAlignmentContextValue | null>(null);
const RemovePresentationContext = createContext<"simple" | "advanced">("simple");

async function loadRemoveAlignment(roomId: string): Promise<RemoveAlignmentLookup> {
  const response = await fetch(
    `/api/vibode/admin/remove-alignment?roomId=${encodeURIComponent(roomId)}`,
    { method: "GET", credentials: "same-origin", cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  return interpretRemoveAlignmentResponse({ status: response.status, payload });
}

export function RemoveAlignmentProvider({
  roomId,
  activeHistoryAssetId = null,
  activeHistoryImageUrl = null,
  alignmentGenerationId = null,
  onCleanupHistoryAccepted,
  onRemoveEditSaved,
  children,
}: {
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
  const roomRef = useRef(roomId);
  const [lookup, setLookup] = useState<RemoveAlignmentLookup>({ access: "hidden" });
  const [inspection, dispatch] = useReducer(
    reduceRemoveInspection,
    initialRemoveInspectionState(),
  );
  const inspectionRef = useRef(inspection);
  inspectionRef.current = inspection;
  const [displayed, setDisplayed] = useState<Readonly<{
    original: DisplayedSize | null;
    empty: DisplayedSize | null;
  }>>({ original: null, empty: null });
  const [maskSummary, setMaskSummary] = useState<RemoveMaskSummary | null>(null);
  const maskHoldRef = useRef<RemoveMaskHold | null>(null);
  const revealMaskRef = useRef<(() => boolean) | null>(null);
  const [objectUi, setObjectUi] = useState<RemoveObjectUiState>(initialRemoveObjectUiState());
  const objectUiRef = useRef(objectUi);
  const [cleanupUi, setCleanupUi] = useState<RemoveCleanupUiState>(initialRemoveCleanupUiState());
  const [cleanupSnapshot, setCleanupSnapshot] = useState<RemoveCleanupSnapshotObject[]>([]);
  const [cleanupController, setCleanupController] = useState<AbortController | null>(null);
  const cleanupClaimRef = useRef(false);
  const ticketRef = useRef(0);
  const saveLock = useRef(false);
  const cleanupFinalizingRef = useRef(false);
  const cleanupActivationRef = useRef<Readonly<{ roomId: string | null; assetId: string | null }> | null>(null);
  const cleanupFinalizeLock = useRef(false);
  const cleanupExitLock = useRef(false);
  const alignmentRequestSerial = useRef(0);
  const alignmentGenerationRef = useRef<string | null>(alignmentGenerationId);
  const onCleanupHistoryAcceptedRef = useRef(onCleanupHistoryAccepted);
  const exitRef = useRef<() => void>(() => {});
  const frozenKeepIdRef = useRef<string | null>(null);
  const [frozenKeep, setFrozenKeep] = useState<Readonly<{ assetId: string; imageUrl: string }> | null>(null);
  const [keepIdentity, setKeepIdentity] = useState<RemoveKeepIdentity | null>(null);
  const [keepShaConflict, setKeepShaConflict] = useState(false);
  const [removeSavePhase, setRemoveSavePhase] = useState<"idle" | "saving" | "error">("idle");
  const [removeSaveError, setRemoveSaveError] = useState<string | null>(null);
  const [cleanupFinalizing, setCleanupFinalizing] = useState(false);
  const [cleanupActivationBlocked, setCleanupActivationBlocked] = useState(false);
  const [cleanupActivationError, setCleanupActivationError] = useState<string | null>(null);
  const [cleanupActivationAssetId, setCleanupActivationAssetId] = useState<string | null>(null);
  const [vocabularyRevision, setVocabularyRevision] = useState(0);
  const [vocabularyView, setVocabularyView] = useState<RemoveVocabularyProfileResponse | null>(null);
  const [vocabularyConfirm, setVocabularyConfirm] = useState<RemoveVocabularyConfirmState>(
    initialRemoveVocabularyConfirmState(),
  );
  const vocabularyTicket = useRef(0);
  const vocabularyLock = useRef(false);
  const [trackedRoomId, setTrackedRoomId] = useState(roomId);
  if (trackedRoomId !== roomId) {
    roomRef.current = roomId;
    setTrackedRoomId(roomId);
    setDisplayed({ original: null, empty: null });
    setLookup({ access: "hidden" });
    setVocabularyRevision(0);
    setVocabularyView(null);
    setVocabularyConfirm(initialRemoveVocabularyConfirmState());
    cleanupFinalizingRef.current = false;
    cleanupActivationRef.current = null;
    cleanupFinalizeLock.current = false;
    cleanupExitLock.current = false;
    setCleanupFinalizing(false);
    setCleanupActivationBlocked(false);
    setCleanupActivationError(null);
    setCleanupActivationAssetId(null);
    dispatch({ type: "exit" });
  }

  alignmentGenerationRef.current = alignmentGenerationId;
  onCleanupHistoryAcceptedRef.current = onCleanupHistoryAccepted;

  const commitLookup = useCallback((
    next: RemoveAlignmentLookup,
    request: Readonly<{ roomId: string; serial: number; generationId: string | null }>,
  ) => {
    const reportGenerationId = next.access === "ready" ? next.report.generationId : null;
    if (!shouldApplyRemoveAlignmentLookup({
      requestRoomId: request.roomId,
      currentRoomId: roomRef.current,
      requestSerial: request.serial,
      currentSerial: alignmentRequestSerial.current,
      requestedGenerationId: request.generationId,
      reportGenerationId,
      access: next.access,
    })) return;
    setLookup(next);
  }, []);

  const refresh = useCallback(async (nextRoomId: string) => {
    const serial = alignmentRequestSerial.current + 1;
    alignmentRequestSerial.current = serial;
    const generationId = alignmentGenerationRef.current;
    try {
      const next = await loadRemoveAlignment(nextRoomId);
      commitLookup(next, { roomId: nextRoomId, serial, generationId });
      return next;
    } catch {
      const hidden: RemoveAlignmentLookup = { access: "hidden" };
      commitLookup(hidden, { roomId: nextRoomId, serial, generationId });
      return hidden;
    }
  }, [commitLookup]);

  useEffect(() => {
    roomRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return undefined;
    const activeRoomId = roomId;
    const serial = alignmentRequestSerial.current + 1;
    alignmentRequestSerial.current = serial;
    const requestedGenerationId = alignmentGenerationId;
    let cancelled = false;
    void loadRemoveAlignment(activeRoomId).then((next) => {
      if (cancelled) return;
      commitLookup(next, { roomId: activeRoomId, serial, generationId: requestedGenerationId });
    }).catch(() => {
      if (cancelled) return;
      commitLookup({ access: "hidden" }, { roomId: activeRoomId, serial, generationId: requestedGenerationId });
    });
    return () => {
      cancelled = true;
    };
  }, [alignmentGenerationId, commitLookup, roomId]);

  useEffect(() => {
    if (!inspection.active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saveLock.current && !cleanupFinalizingRef.current) exitRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inspection.active]);

  const report = lookup.access === "ready" ? lookup.report : null;
  const sessionActive = inspection.active && lookup.access === "ready";
  const originalDisagreement = report
    ? removeDecodedSizeDisagreement({
      width: report.original.decodedWidth,
      height: report.original.decodedHeight,
    }, displayed.original)
    : null;
  const emptyDisagreement = report
    ? removeDecodedSizeDisagreement({
      width: report.empty.decodedWidth,
      height: report.empty.decodedHeight,
    }, displayed.empty)
    : null;
  const brushAdmission = report
    ? removeBrushAdmission({
      gridCompatibility: report.gridCompatibility,
      originalDisagreement,
      emptyDisagreement,
    })
    : null;

  if (!sessionActive && maskSummary !== null) setMaskSummary(null);
  if (
    inspection.active
    && inspection.mode === "brush"
    && brushAdmission?.allowed !== true
  ) {
    dispatch({ type: "mode", mode: "alignment" });
  }

  useEffect(() => {
    if (sessionActive) return;
    maskHoldRef.current = null;
  }, [sessionActive]);

  const objectIdentity = useMemo<RemoveObjectUiIdentity | null>(() => {
    if (!sessionActive || !roomId || !report) return null;
    return {
      roomId,
      generationId: report.generationId,
      originalSha256: report.original.sha256.toLowerCase(),
      originalWidth: report.original.decodedWidth,
      originalHeight: report.original.decodedHeight,
      sessionSerial: inspection.sessionSerial,
      vocabularyRevision,
    };
  }, [inspection.sessionSerial, report, roomId, sessionActive, vocabularyRevision]);
  const cleanupIdentityKey = objectIdentity
    ? removeObjectUiIdentityKey(objectIdentity)
    : "inactive";
  const [trackedCleanupKey, setTrackedCleanupKey] = useState(cleanupIdentityKey);
  if (trackedCleanupKey !== cleanupIdentityKey) {
    setTrackedCleanupKey(cleanupIdentityKey);
    cleanupController?.abort();
    setCleanupController(null);
    setCleanupSnapshot([]);
    setCleanupUi(initialRemoveCleanupUiState());
  }

  useEffect(() => {
    const decision = reduceRemoveObjectSession({
      state: objectUiRef.current,
      active: objectIdentity !== null,
      identity: objectIdentity,
    });
    objectUiRef.current = decision.state;
    setObjectUi(decision.state);
    if (decision.command === "abort" || !objectIdentity) return undefined;
    const scanKey = bringForwardScanKey(objectIdentity);
    if (decision.command === "fetch") {
      const cached = scanKey ? readBringForwardScan(scanKey) : null;
      if (cached) {
        const adopted = reuseRemoveObjectScan({
          state: decision.state,
          requestSerial: decision.state.requestSerial,
          identity: objectIdentity,
          objects: cached.objects,
          diagnostics: cached.diagnostics,
        });
        objectUiRef.current = adopted;
        setObjectUi(adopted);
        return undefined;
      }
    }
    if (decision.state.phase !== "loading") return undefined;
    const serial = decision.state.requestSerial;
    const ticket = ticketRef.current + 1;
    ticketRef.current = ticket;
    void loadBringForwardScan({ identity: objectIdentity }).then((scan) => {
      if (ticketRef.current !== ticket) return;
      setObjectUi((current) => {
        const next = scan
          ? reuseRemoveObjectScan({
            state: current,
            requestSerial: serial,
            identity: objectIdentity,
            objects: scan.objects,
            diagnostics: scan.diagnostics,
          })
          : failRemoveObjectLoad({
            state: current,
            requestSerial: serial,
            identity: objectIdentity,
            reason: scanKey ? readBringForwardScanError(scanKey) ?? undefined : undefined,
          });
        objectUiRef.current = next;
        return next;
      });
    });
    return () => {
      ticketRef.current += 1;
    };
  }, [objectIdentity]);

  useEffect(() => {
    cleanupClaimRef.current = false;
  }, [cleanupIdentityKey]);

  useEffect(() => {
    if (!sessionActive || !roomId) return undefined;
    const ticket = vocabularyTicket.current + 1;
    vocabularyTicket.current = ticket;
    const activeRoomId = roomId;
    const controller = new AbortController();
    void requestRemoveVocabularyProfile({
      roomId: activeRoomId,
      signal: controller.signal,
    }).then((view) => {
      if (ticket !== vocabularyTicket.current || roomRef.current !== activeRoomId || !view) return;
      setVocabularyView(view);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [roomId, sessionActive]);

  useEffect(() => {
    if (sessionActive) return;
    setVocabularyConfirm(initialRemoveVocabularyConfirmState());
  }, [sessionActive]);

  const enter = useCallback(() => {
    const requested = roomRef.current;
    if (!requested) return;
    const serial = alignmentRequestSerial.current;
    void refresh(requested).then((next) => {
      if (roomRef.current !== requested || next.access !== "ready") return;
      if (alignmentRequestSerial.current !== serial + 1) return;
      cleanupExitLock.current = false;
      dispatch({ type: "enter" });
    });
  }, [refresh]);
  const clearCleanupActivation = useCallback(() => {
    cleanupFinalizingRef.current = false;
    cleanupActivationRef.current = null;
    cleanupFinalizeLock.current = false;
    setCleanupFinalizing(false);
    setCleanupActivationBlocked(false);
    setCleanupActivationError(null);
    setCleanupActivationAssetId(null);
  }, []);
  const exit = useCallback(() => {
    clearCleanupActivation();
    dispatch({ type: "exit" });
  }, [clearCleanupActivation]);
  exitRef.current = exit;
  const blockCleanupPublication = useCallback((assetId: string | null) => {
    cleanupActivationRef.current = { roomId: roomRef.current, assetId };
    setCleanupActivationBlocked(true);
    setCleanupActivationAssetId(assetId);
    setCleanupActivationError(CLEANUP_HISTORY_ACTIVATION_ERROR);
    setRemoveSaveError(CLEANUP_HISTORY_ACTIVATION_ERROR);
    setRemoveSavePhase("error");
  }, []);
  const noteCleanupAcceptancePending = useCallback((pending: boolean) => {
    cleanupFinalizingRef.current = pending;
    setCleanupFinalizing(pending);
  }, []);
  const finalizeCleanupHistory = useCallback(async (
    acceptedRoomId: string,
    assetId: string,
  ): Promise<CleanupFinalizeResult> => {
    if (cleanupFinalizeLock.current) return "finalized";
    const sessionSerial = inspectionRef.current.sessionSerial;
    const stillCurrent = () =>
      roomRef.current === acceptedRoomId
      && inspectionRef.current.sessionSerial === sessionSerial
      && inspectionRef.current.active;
    if (!stillCurrent()) return "stale";
    const activate = onCleanupHistoryAcceptedRef.current;
    if (!activate) {
      blockCleanupPublication(assetId);
      return "failed";
    }
    cleanupFinalizeLock.current = true;
    cleanupFinalizingRef.current = true;
    setCleanupFinalizing(true);
    try {
      await activate(acceptedRoomId, assetId, stillCurrent);
      if (!stillCurrent()) return "stale";
      if (cleanupExitLock.current) return "finalized";
      cleanupExitLock.current = true;
      exit();
      return "finalized";
    } catch {
      if (!stillCurrent()) return "stale";
      blockCleanupPublication(assetId);
      return "failed";
    } finally {
      cleanupFinalizeLock.current = false;
      cleanupFinalizingRef.current = false;
      setCleanupFinalizing(false);
    }
  }, [blockCleanupPublication, exit]);
  const showSavedCleanupImage = useCallback(() => {
    const pending = cleanupActivationRef.current;
    if (!pending?.roomId || !pending.assetId) return;
    void finalizeCleanupHistory(pending.roomId, pending.assetId);
  }, [finalizeCleanupHistory]);
  const setOpacity = useCallback((opacity: number) => {
    dispatch({ type: "opacity", opacity });
  }, []);
  const setPreset = useCallback((preset: (typeof REMOVE_OPACITY_PRESETS)[number]["id"]) => {
    dispatch({ type: "preset", preset });
  }, []);
  const setFurnitureHidden = useCallback((hidden: boolean) => {
    dispatch({ type: "furniture", hidden });
  }, []);
  const setMode = useCallback((mode: RemoveSessionMode) => {
    dispatch({ type: "mode", mode });
  }, []);
  const setTool = useCallback((tool: RemoveBrushTool) => {
    dispatch({ type: "tool", tool });
  }, []);
  const setDiameter = useCallback((diameterPx: number) => {
    dispatch({ type: "diameter", diameterPx });
  }, []);
  const setFeather = useCallback((featherPx: number) => {
    dispatch({ type: "feather", featherPx });
  }, []);
  const setObjectExpansion = useCallback((expansionPx: number) => {
    dispatch({ type: "object-expansion", expansionPx });
  }, []);
  const setObjectOutlinesVisible = useCallback((visible: boolean) => {
    dispatch({ type: "object-outlines", visible });
  }, []);
  const setObjectProtection = useCallback((enabled: boolean) => {
    dispatch({ type: "object-protection", enabled });
  }, []);
  const clearMask = useCallback(() => {
    dispatch({ type: "clear-mask" });
  }, []);
  const revealEmptyRoom = useCallback(() => {
    revealMaskRef.current?.();
  }, []);
  const updateObjectUi = useCallback((reduce: (state: RemoveObjectUiState) => RemoveObjectUiState) => {
    setObjectUi((current) => {
      const next = reduce(current);
      objectUiRef.current = next;
      return next;
    });
  }, []);
  const clickObject = useCallback((x: number, y: number) => {
    updateObjectUi((current) => applyRemoveObjectClick(current, x, y));
  }, [updateObjectUi]);
  const hideAllObjects = useCallback(() => {
    updateObjectUi(hideAllRemoveObjectUi);
  }, [updateObjectUi]);
  const showAllObjects = useCallback(() => {
    updateObjectUi(showAllRemoveObjectUi);
  }, [updateObjectUi]);
  const hiddenCleanupObjects = useMemo(
    () => (objectUi.phase === "ready"
      ? hiddenRemoveCleanupObjects(objectUi.objects, objectUi.selectedIds)
      : []),
    [objectUi],
  );
  if (hiddenCleanupObjects.length === 0 && cleanupUi.phase === "confirming") {
    setCleanupSnapshot([]);
    setCleanupUi(cancelRemoveCleanupConfirmation(cleanupUi));
  }
  const openCleanupExport = useCallback(() => {
    const hidden = objectUi.phase === "ready"
      ? hiddenRemoveCleanupObjects(objectUi.objects, objectUi.selectedIds)
      : [];
    const available = removeCleanupExportAvailability({
      segmentationPhase: objectUi.phase,
      hiddenCount: hidden.length,
      exporting: cleanupUi.phase === "exporting",
    });
    if (!available || cleanupUi.phase === "exporting") return;
    setCleanupSnapshot(snapshotRemoveCleanupObjects(hidden));
    setCleanupUi(openRemoveCleanupConfirmation(cleanupUi, true));
  }, [cleanupUi, objectUi]);
  const cancelCleanupExport = useCallback(() => {
    setCleanupSnapshot([]);
    setCleanupUi(cancelRemoveCleanupConfirmation(cleanupUi));
  }, [cleanupUi]);
  const downloadCleanupExport = useCallback(() => {
    const begun = beginRemoveCleanupDownload({
      state: cleanupUi,
      claimed: cleanupClaimRef.current,
    });
    if (!begun.begin) return;
    cleanupClaimRef.current = true;
    setCleanupUi(begun.state);
    const identity = objectIdentity;
    const snapshot = cleanupSnapshot;
    const flightId = begun.state.flightId;
    if (!identity || snapshot.length === 0) {
      cleanupClaimRef.current = false;
      setCleanupUi(finishRemoveCleanupExport(begun.state, flightId, {
        ok: false,
        reason: "Clean Up export is not available for this room.",
      }));
      return;
    }
    const controller = new AbortController();
    setCleanupController(controller);
    void (async () => {
      let outcome: Readonly<
        | { ok: true; bytes: Uint8Array; fileName: string }
        | { ok: false; reason: string }
      >;
      try {
        const body = await buildRemoveCleanupExportBody({
          roomId: identity.roomId,
          generationId: identity.generationId,
          originalSha256: identity.originalSha256,
          originalDecodedWidth: identity.originalWidth,
          originalDecodedHeight: identity.originalHeight,
          objects: snapshot,
        });
        if (controller.signal.aborted) return;
        const exported = await requestRemoveCleanupExport({ body, signal: controller.signal });
        if (controller.signal.aborted) return;
        outcome = exported;
      } catch {
        if (controller.signal.aborted) return;
        outcome = { ok: false, reason: "Clean Up export failed." };
      }
      cleanupClaimRef.current = false;
      if (controller.signal.aborted) return;
      if (outcome.ok) {
        try {
          saveRemoveCleanupZip(outcome.fileName, outcome.bytes);
        } catch {
          outcome = { ok: false, reason: "Clean Up export could not be saved." };
        }
      }
      if (controller.signal.aborted) return;
      setCleanupUi((current) => finishRemoveCleanupExport(current, flightId, outcome));
    })();
  }, [cleanupSnapshot, cleanupUi, objectIdentity]);
  const noteDisplayedSize = useCallback((artifact: "original" | "empty", size: DisplayedSize) => {
    setDisplayed((current) => ({ ...current, [artifact]: size }));
  }, []);
  const noteMaskSummary = useCallback((summary: RemoveMaskSummary | null) => {
    setMaskSummary(summary);
  }, []);

  useEffect(() => {
    if (!sessionActive) {
      frozenKeepIdRef.current = null;
      setFrozenKeep(null);
      setKeepIdentity(null);
      setKeepShaConflict(false);
      return;
    }
    if (frozenKeepIdRef.current) return;
    if (!activeHistoryAssetId || !activeHistoryImageUrl) return;
    frozenKeepIdRef.current = activeHistoryAssetId;
    setFrozenKeep({ assetId: activeHistoryAssetId, imageUrl: activeHistoryImageUrl });
  }, [activeHistoryAssetId, activeHistoryImageUrl, sessionActive]);

  const keepStale = Boolean(
    frozenKeep && (activeHistoryAssetId !== frozenKeep.assetId || keepShaConflict),
  );
  const keepImageUrl = frozenKeep
    ? (activeHistoryAssetId === frozenKeep.assetId && activeHistoryImageUrl
      ? activeHistoryImageUrl
      : frozenKeep.imageUrl)
    : null;
  const keepAdmission = keepIdentity && report
    ? removeEditKeepAdmission({
      keepWidth: keepIdentity.width,
      keepHeight: keepIdentity.height,
      emptyWidth: report.empty.decodedWidth,
      emptyHeight: report.empty.decodedHeight,
    })
    : null;
  const keepNotice = keepStale
    ? REMOVE_EDIT_STALE_ERROR
    : keepAdmission && !keepAdmission.allowed
      ? keepAdmission.reason
      : null;
  const noteKeepIdentity = useCallback((identity: RemoveKeepIdentity) => {
    const frozenId = frozenKeepIdRef.current;
    if (!frozenId || identity.assetId !== frozenId) return;
    setKeepIdentity((current) => {
      if (current && current.sha256 !== identity.sha256) {
        setKeepShaConflict(true);
        return current;
      }
      return identity;
    });
  }, []);

  const saveRemoveEdits = useCallback(() => {
    if (saveLock.current) return;
    if (cleanupFinalizingRef.current || cleanupActivationRef.current) {
      setRemoveSaveError(CLEANUP_HISTORY_ACTIVATION_ERROR);
      setRemoveSavePhase("error");
      return;
    }
    const report = lookup.access === "ready" ? lookup.report : null;
    const hold = maskHoldRef.current;
    if (
      !roomId
      || !report
      || !hold
      || hold.roomId !== roomId
      || hold.generationId !== report.generationId
      || hold.width !== report.original.decodedWidth
      || hold.height !== report.original.decodedHeight
    ) {
      setRemoveSaveError(REMOVE_EDIT_ALIGNMENT_ERROR);
      setRemoveSavePhase("error");
      return;
    }
    const admission = removeEditExportAdmission(report);
    if (!admission.allowed) {
      setRemoveSaveError(admission.reason);
      setRemoveSavePhase("error");
      return;
    }
    const objects = objectUi.phase === "ready" ? objectUi.objects : [];
    const selectedIds = objectUi.phase === "ready" ? objectUi.selectedIds : new Set<string>();
    const coverage = buildRemoveEditCoverage({
      brush: hold.pixels,
      width: hold.width,
      height: hold.height,
      objects,
      selectedIds,
      expansionPx: inspection.objectExpansionPx,
    });
    if (!coverage) {
      setRemoveSaveError(REMOVE_EDIT_ALIGNMENT_ERROR);
      setRemoveSavePhase("error");
      return;
    }
    if (!removeEditHasChanges(coverage)) {
      dispatch({ type: "exit" });
      return;
    }
    if (
      !frozenKeep
      || !keepIdentity
      || keepIdentity.assetId !== frozenKeep.assetId
      || activeHistoryAssetId !== frozenKeep.assetId
      || keepShaConflict
    ) {
      setRemoveSaveError(
        frozenKeep && (activeHistoryAssetId !== frozenKeep.assetId || keepShaConflict)
          ? REMOVE_EDIT_STALE_ERROR
          : REMOVE_EDIT_ALIGNMENT_ERROR,
      );
      setRemoveSavePhase("error");
      return;
    }
    const activeKeepAdmission = removeEditKeepAdmission({
      keepWidth: keepIdentity.width,
      keepHeight: keepIdentity.height,
      emptyWidth: report.empty.decodedWidth,
      emptyHeight: report.empty.decodedHeight,
    });
    if (!activeKeepAdmission.allowed) {
      setRemoveSaveError(activeKeepAdmission.reason);
      setRemoveSavePhase("error");
      return;
    }
    saveLock.current = true;
    setRemoveSavePhase("saving");
    setRemoveSaveError(null);
    void (async () => {
      try {
        const response = await fetch("/api/vibode/admin/remove-edits", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            roomId,
            generationId: report.generationId,
            parentAssetId: frozenKeep.assetId,
            keepSha256: keepIdentity.sha256,
            keepWidth: keepIdentity.width,
            keepHeight: keepIdentity.height,
            width: hold.width,
            height: hold.height,
            coverageBase64: bytesToBase64(coverage),
          }),
        });
        const payload = await response.json().catch(() => null) as {
          saved?: boolean;
          assetId?: string;
          error?: string;
        } | null;
        if (!response.ok || payload?.saved !== true || typeof payload.assetId !== "string") {
          setRemoveSaveError(typeof payload?.error === "string" ? payload.error : REMOVE_EDIT_SAVE_ERROR);
          setRemoveSavePhase("error");
          return;
        }
        try {
          await onRemoveEditSaved?.(roomId, payload.assetId);
        } catch {
          setRemoveSaveError(REMOVE_EDIT_ACTIVATE_ERROR);
          setRemoveSavePhase("error");
          return;
        }
        setRemoveSavePhase("idle");
        dispatch({ type: "exit" });
      } catch {
        setRemoveSaveError(REMOVE_EDIT_SAVE_ERROR);
        setRemoveSavePhase("error");
      } finally {
        saveLock.current = false;
      }
    })();
  }, [
    activeHistoryAssetId,
    frozenKeep,
    inspection.objectExpansionPx,
    keepIdentity,
    keepShaConflict,
    lookup,
    objectUi,
    onRemoveEditSaved,
    roomId,
  ]);

  useEffect(() => {
    const selected = objectUi.phase === "ready" ? objectUi.selectedIds.size : 0;
    const dirty = (maskSummary?.coveragePercent ?? 0) > 0 || selected > 0;
    if (!sessionActive || !dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveLock.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [maskSummary, objectUi, sessionActive]);

  const requestVocabulary = useCallback((requested: RemoveVocabularyChoice) => {
    setVocabularyConfirm((current) => requestRemoveVocabularyChange(current, {
      displayed: displayedRemoveVocabularyChoice(vocabularyView),
      requested,
    }));
  }, [vocabularyView]);
  const cancelVocabulary = useCallback(() => {
    setVocabularyConfirm((current) => (current.phase === "saving" ? current : { phase: "idle" }));
  }, []);
  const confirmVocabulary = useCallback(() => {
    if (vocabularyLock.current || !roomId || vocabularyConfirm.phase !== "confirming") return;
    const requested = vocabularyConfirm.requested;
    vocabularyLock.current = true;
    setVocabularyConfirm({ phase: "saving", requested });
    void saveRemoveVocabularyProfile({ roomId, profile: requested }).then((result) => {
      if (roomRef.current !== roomId) return;
      const outcome = applyRemoveVocabularySave({ requested, result });
      if (!outcome.scan || !outcome.view) {
        setVocabularyConfirm({
          phase: "error",
          message: result.ok ? REMOVE_VOCABULARY_SAVE_ERROR : result.reason,
        });
        return;
      }
      vocabularyTicket.current += 1;
      setVocabularyView(outcome.view);
      setVocabularyRevision((current) => current + 1);
      setVocabularyConfirm({ phase: "idle" });
    }).catch(() => {
      setVocabularyConfirm({ phase: "error", message: REMOVE_VOCABULARY_SAVE_ERROR });
    }).finally(() => {
      vocabularyLock.current = false;
    });
  }, [roomId, vocabularyConfirm]);

  const value = useMemo<RemoveAlignmentContextValue>(() => ({
    roomId,
    active: sessionActive,
    access: lookup.access,
    report,
    opacity: inspection.opacity,
    furnitureHidden: inspection.furnitureHidden,
    furnitureRenderingVisible: removeFurnitureRenderingVisible({
      active: sessionActive,
      furnitureHidden: inspection.furnitureHidden,
    }),
    disabledReason: lookup.access === "disabled" ? lookup.reason : null,
    mode: inspection.mode,
    tool: inspection.tool,
    diameterPx: inspection.diameterPx,
    featherPx: inspection.featherPx,
    maskEpoch: inspection.maskEpoch,
    sessionSerial: inspection.sessionSerial,
    vocabularyRevision,
    objectExpansionPx: inspection.objectExpansionPx,
    objectOutlinesVisible: inspection.objectOutlinesVisible,
    objectProtectionEnabled: inspection.objectProtectionEnabled,
    brushAdmission,
    maskSummary,
    maskHoldRef,
    revealMaskRef,
    revealEmptyRoom,
    enter,
    exit,
    setOpacity,
    setPreset,
    setFurnitureHidden,
    setMode,
    setTool,
    setDiameter,
    setFeather,
    clearMask,
    clickObject,
    hideAllObjects,
    showAllObjects,
    setObjectExpansion,
    setObjectOutlinesVisible,
    setObjectProtection,
    objectUi,
    cleanupPhase: cleanupUi.phase,
    cleanupError: cleanupUi.error,
    cleanupAvailable: removeCleanupExportAvailability({
      segmentationPhase: objectUi.phase,
      hiddenCount: hiddenCleanupObjects.length,
      exporting: cleanupUi.phase === "exporting",
    }),
    cleanupLabel: removeCleanupExportLabel(hiddenCleanupObjects.length),
    cleanupSummary: removeCleanupConfirmationSummary(
      cleanupUi.phase === "idle" ? hiddenCleanupObjects : cleanupSnapshot,
    ),
    openCleanupExport,
    cancelCleanupExport,
    downloadCleanupExport,
    noteDisplayedSize,
    noteMaskSummary,
    onCleanupHistoryAccepted: finalizeCleanupHistory,
    noteCleanupAcceptancePending,
    noteCleanupActivationBlocked: blockCleanupPublication,
    cleanupFinalizing,
    cleanupActivationBlocked,
    cleanupActivationError,
    cleanupActivationAssetId,
    showSavedCleanupImage,
    saveRemoveEdits,
    removeSavePhase,
    removeSaveError,
    vocabularyChoice: displayedRemoveVocabularyChoice(vocabularyView),
    vocabularyPhase: vocabularyConfirm.phase,
    vocabularyRequested: vocabularyConfirm.phase === "confirming" || vocabularyConfirm.phase === "saving"
      ? vocabularyConfirm.requested
      : null,
    vocabularyError: vocabularyConfirm.phase === "error" ? vocabularyConfirm.message : null,
    requestVocabulary,
    confirmVocabulary,
    cancelVocabulary,
    keepImageUrl,
    keepAssetId: frozenKeep?.assetId ?? null,
    keepNotice,
    noteKeepIdentity,
    originalDisagreement,
    emptyDisagreement,
  }), [
    brushAdmission,
    cancelCleanupExport,
    cleanupSnapshot,
    cleanupUi,
    clearMask,
    clickObject,
    downloadCleanupExport,
    emptyDisagreement,
    enter,
    exit,
    hiddenCleanupObjects,
    hideAllObjects,
    frozenKeep,
    inspection.diameterPx,
    keepImageUrl,
    keepNotice,
    noteKeepIdentity,
    inspection.featherPx,
    inspection.furnitureHidden,
    inspection.maskEpoch,
    inspection.mode,
    inspection.objectExpansionPx,
    inspection.objectOutlinesVisible,
    inspection.objectProtectionEnabled,
    inspection.opacity,
    inspection.sessionSerial,
    inspection.tool,
    lookup,
    maskSummary,
    noteDisplayedSize,
    noteMaskSummary,
    objectUi,
    finalizeCleanupHistory,
    noteCleanupAcceptancePending,
    blockCleanupPublication,
    cleanupFinalizing,
    cleanupActivationBlocked,
    cleanupActivationError,
    cleanupActivationAssetId,
    showSavedCleanupImage,
    openCleanupExport,
    originalDisagreement,
    removeSaveError,
    removeSavePhase,
    revealEmptyRoom,
    revealMaskRef,
    requestVocabulary,
    confirmVocabulary,
    cancelVocabulary,
    vocabularyConfirm,
    vocabularyRevision,
    vocabularyView,
    roomId,
    report,
    saveRemoveEdits,
    sessionActive,
    setDiameter,
    setFeather,
    setFurnitureHidden,
    setMode,
    setObjectExpansion,
    setObjectOutlinesVisible,
    setObjectProtection,
    setOpacity,
    setPreset,
    setTool,
    showAllObjects,
  ]);

  return (
    <RemoveAlignmentContext.Provider value={value}>
      {children}
    </RemoveAlignmentContext.Provider>
  );
}

export function useRemoveAlignment(): RemoveAlignmentContextValue | null {
  return useContext(RemoveAlignmentContext);
}

export function RemoveAlignmentControl({
  blocked = false,
  blockedTitle = "Exit Bring Forward before Remove.",
}: {
  blocked?: boolean;
  blockedTitle?: string;
} = {}) {
  const session = useRemoveAlignment();
  if (!session || session.access === "hidden") return null;
  const disabled = session.access !== "ready" || blocked;
  return (
    <div className="relative shrink-0" data-remove-alignment="control">
      <button
        type="button"
        data-remove-alignment="toggle"
        aria-label="Remove"
        aria-pressed={session.active}
        disabled={disabled}
        title={blocked
          ? blockedTitle
          : disabled
          ? session.disabledReason ?? "ORIGINAL and EMPTY are not ready."
          : session.active
            ? "Exit Remove inspection"
            : "Inspect ORIGINAL and EMPTY alignment"}
        onClick={() => {
          if (disabled) return;
          if (session.active) session.exit();
          else session.enter();
        }}
        className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
          disabled
            ? "border-neutral-900 bg-neutral-950 text-neutral-600"
            : session.active
              ? "border-neutral-500 bg-neutral-800 text-neutral-100"
              : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
        }`}
      >
        Remove
      </button>
      {session.active && session.report ? (
        <RemoveInspectionPanel session={session} />
      ) : null}
    </div>
  );
}

function RemoveInspectionPanel({ session }: { session: RemoveAlignmentContextValue }) {
  const [presentation, setPresentation] = useState<"simple" | "advanced">("simple");
  const pressedPreset = removeOpacityPreset(session.opacity);
  const brushDisabled = session.brushAdmission?.allowed !== true;
  const brushTitle = session.brushAdmission?.allowed === false ? session.brushAdmission.reason : undefined;
  return (
    <RemovePresentationContext.Provider value={presentation}>
      <div
        role="region"
        aria-label="Remove inspection"
        data-remove-mode={session.mode}
        data-remove-presentation={presentation}
        className="absolute right-0 top-full z-50 mt-1 flex max-h-[70vh] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-md border border-neutral-700 bg-neutral-950 text-neutral-200 shadow-lg"
      >
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
          {presentation === "simple" ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Remove mode">
              <ModeButton
                pressed={session.mode === "objects"}
                onClick={() => session.setMode("objects")}
              >
                Objects
              </ModeButton>
              <ModeButton
                pressed={session.mode === "brush"}
                disabled={brushDisabled}
                title={brushTitle}
                onClick={() => session.setMode("brush")}
              >
                Brush
              </ModeButton>
              <ModeButton pressed={false} onClick={() => setPresentation("advanced")}>
                Advanced
              </ModeButton>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Remove mode">
              <ModeButton
                pressed={session.mode === "objects"}
                onClick={() => session.setMode("objects")}
              >
                Objects
              </ModeButton>
              <ModeButton
                pressed={session.mode === "alignment"}
                onClick={() => session.setMode("alignment")}
              >
                Alignment
              </ModeButton>
              <ModeButton
                pressed={session.mode === "brush"}
                disabled={brushDisabled}
                title={brushTitle}
                onClick={() => session.setMode("brush")}
              >
                Brush
              </ModeButton>
              <ModeButton pressed={false} onClick={() => setPresentation("simple")}>
                Simple
              </ModeButton>
            </div>
          )}
          {session.mode === "alignment" ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Alignment presets">
                {REMOVE_OPACITY_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={pressedPreset === preset.id}
                    onClick={() => session.setPreset(preset.id)}
                    className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
                      pressedPreset === preset.id
                        ? "border-neutral-500 bg-neutral-800 text-neutral-50"
                        : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="mt-3 block text-[11px] text-neutral-400">
                EMPTY opacity
                <span className="float-right tabular-nums text-neutral-200">{session.opacity}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={session.opacity}
                  aria-label="EMPTY opacity"
                  onChange={(event) => session.setOpacity(Number(event.target.value))}
                  className="mt-1 h-1 w-full accent-neutral-200"
                />
              </label>
            </>
          ) : session.mode === "brush" ? (
            <BrushControls session={session} />
          ) : (
            <ObjectControls session={session} />
          )}
          {presentation === "advanced" ? <AlignmentDetails session={session} /> : null}
        </div>
        <RemoveInspectionFooter session={session} />
      </div>
    </RemovePresentationContext.Provider>
  );
}

function RemoveInspectionFooter({ session }: { session: RemoveAlignmentContextValue }) {
  const doneBlocked = session.removeSavePhase === "saving"
    || session.cleanupFinalizing
    || session.cleanupActivationBlocked;
  const cancelBlocked = session.removeSavePhase === "saving" || session.cleanupFinalizing;
  return (
    <div className="min-w-0 shrink-0 break-words border-t border-neutral-800 p-3" data-remove-footer="true">
      <button
        type="button"
        aria-pressed={session.furnitureHidden}
        onClick={() => session.setFurnitureHidden(!session.furnitureHidden)}
        className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
          session.furnitureHidden
            ? "border-neutral-500 bg-neutral-800 text-neutral-50"
            : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
        }`}
      >
        {session.furnitureHidden ? "Show Furniture" : "Hide Furniture"}
      </button>
      <button
        type="button"
        data-remove-objects="done"
        disabled={doneBlocked}
        onClick={session.saveRemoveEdits}
        className={`mt-2 rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
          doneBlocked
            ? "border-neutral-900 bg-neutral-950 text-neutral-600"
            : "border-neutral-200 bg-neutral-100 text-neutral-950 hover:bg-white"
        }`}
      >
        {session.removeSavePhase === "saving" ? "Saving…" : "Done"}
      </button>
      <button
        type="button"
        data-remove-edit="cancel"
        disabled={cancelBlocked}
        onClick={session.exit}
        className={`mt-2 ml-1 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:border-neutral-900 disabled:bg-neutral-950 disabled:text-neutral-600 ${FOCUS}`}
      >
        Cancel
      </button>
      {session.cleanupActivationError ? (
        <div className="mt-2" data-remove-cleanup-activation="recovery">
          <p className="text-[11px] leading-relaxed text-red-300" role="alert" data-remove-cleanup-activation="error">
            {session.cleanupActivationError}
          </p>
          {session.cleanupActivationAssetId ? (
            <button
              type="button"
              data-remove-cleanup-activation="show-saved"
              disabled={session.cleanupFinalizing}
              onClick={() => void session.showSavedCleanupImage()}
              className={`mt-2 rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
                session.cleanupFinalizing
                  ? "border-neutral-900 bg-neutral-950 text-neutral-600"
                  : "border-neutral-500 text-neutral-100"
              }`}
            >
              Show saved image
            </button>
          ) : null}
        </div>
      ) : session.removeSaveError ? (
        <p className="mt-2 text-[11px] leading-relaxed text-red-300" role="alert" data-remove-edit="error">
          {session.removeSaveError}
        </p>
      ) : session.keepNotice ? (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-200" role="status" data-remove-edit="keep-notice">
          {session.keepNotice}
        </p>
      ) : null}
    </div>
  );
}

function ModeButton({
  pressed,
  disabled = false,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
        disabled
          ? "border-neutral-900 bg-neutral-950 text-neutral-600"
          : pressed
            ? "border-neutral-500 bg-neutral-800 text-neutral-50"
            : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

function protectionControl(session: RemoveAlignmentContextValue): Readonly<{
  available: boolean;
  pressed: boolean;
  status: "on" | "off" | "unavailable";
  label: string;
  title: string | undefined;
}> {
  const available = removeObjectProtectionAvailable(session.objectUi);
  if (!available) {
    const title = session.objectUi.phase === "loading" || session.objectUi.phase === "idle"
      ? "Finding objects…"
      : scanStatus(session);
    return { available: false, pressed: false, status: "unavailable", label: "Unavailable", title };
  }
  const pressed = session.objectProtectionEnabled === true;
  return {
    available: true,
    pressed,
    status: pressed ? "on" : "off",
    label: pressed ? "On" : "Off",
    title: undefined,
  };
}

function BrushControls({ session }: { session: RemoveAlignmentContextValue }) {
  const presentation = useContext(RemovePresentationContext);
  const protection = protectionControl(session);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Brush tool">
        <ModeButton pressed={session.tool === "reveal"} onClick={() => session.setTool("reveal")}>
          Reveal
        </ModeButton>
        <ModeButton pressed={session.tool === "restore"} onClick={() => session.setTool("restore")}>
          Restore
        </ModeButton>
      </div>
      <button
        type="button"
        aria-pressed={protection.pressed}
        disabled={!protection.available}
        title={protection.title}
        data-remove-brush="protect"
        data-remove-protection={protection.status}
        onClick={() => {
          if (!protection.available) return;
          session.setObjectProtection(!session.objectProtectionEnabled);
        }}
        className={`mt-3 flex w-full items-center justify-between rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
          protection.available
            ? protection.pressed
              ? "border-neutral-500 bg-neutral-800 text-neutral-50"
              : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            : "border-neutral-900 bg-neutral-950 text-neutral-600"
        }`}
      >
        <span>Protect Objects</span>
        <span className="tabular-nums">{protection.label}</span>
      </button>
      <BrushSlider
        label="Diameter"
        ariaLabel="Brush diameter in ORIGINAL pixels"
        min={1}
        max={512}
        value={session.diameterPx}
        onChange={session.setDiameter}
      />
      <BrushSlider
        label="Feather"
        ariaLabel="Brush feather in ORIGINAL pixels"
        min={0}
        max={Math.floor(session.diameterPx / 2)}
        value={session.featherPx}
        onChange={session.setFeather}
      />
      <div className="mt-3 flex flex-wrap gap-1">
        {presentation === "simple" ? (
          <button
            type="button"
            data-remove-brush="empty-room"
            onClick={session.revealEmptyRoom}
            className={`rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 ${FOCUS}`}
          >
            Empty Room
          </button>
        ) : null}
        <button
          type="button"
          onClick={session.clearMask}
          className={`rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 ${FOCUS}`}
        >
          Clear Mask
        </button>
      </div>
    </div>
  );
}

function BrushSlider({
  label,
  ariaLabel,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mt-3 block text-[11px] text-neutral-400">
      {label}
      <span className="float-right tabular-nums text-neutral-200">{value} px</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={Math.min(max, Math.max(min, value))}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 h-1 w-full accent-neutral-200"
      />
    </label>
  );
}

function ObjectControls({ session }: { session: RemoveAlignmentContextValue }) {
  const presentation = useContext(RemovePresentationContext);
  const simple = presentation === "simple";
  const ready = session.objectUi.phase === "ready" && session.objectUi.objects.length > 0;
  const canReveal = ready && session.brushAdmission?.allowed === true;
  const reason = session.brushAdmission?.allowed === false ? session.brushAdmission.reason : undefined;
  const outlineButton = (label: "Show Mask Outline" | "Show Mask Outlines") => (
    <button
      type="button"
      aria-pressed={session.objectOutlinesVisible}
      data-remove-objects="outlines"
      onClick={() => session.setObjectOutlinesVisible(!session.objectOutlinesVisible)}
      className={`mt-3 rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
        session.objectOutlinesVisible
          ? "border-neutral-500 bg-neutral-800 text-neutral-50"
          : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="mt-3">
      {simple ? (
        <label className="block text-[11px] text-neutral-400" data-remove-vocabulary="room-type">
          Room Type
          <select
            aria-label="Room Type"
            data-remove-vocabulary="choice"
            disabled={session.vocabularyPhase === "saving"}
            value={session.vocabularyChoice}
            onChange={(event) => {
              const value = event.target.value;
              if (value !== "default" && value !== "bedroom") return;
              session.requestVocabulary(value);
            }}
            className={`mt-1 block w-full max-w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-100 ${FOCUS}`}
          >
            <option value="default">Default</option>
            <option value="bedroom">Bedroom</option>
          </select>
        </label>
      ) : (
        <div role="group" aria-label="Detection vocabulary" data-remove-vocabulary="choices">
          <p className="text-[11px] text-neutral-400">Detection vocabulary</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <ModeButton
              pressed={session.vocabularyChoice === "default"}
              disabled={session.vocabularyPhase === "saving"}
              onClick={() => session.requestVocabulary("default")}
            >
              Default
            </ModeButton>
            <ModeButton
              pressed={session.vocabularyChoice === "bedroom"}
              disabled={session.vocabularyPhase === "saving"}
              onClick={() => session.requestVocabulary("bedroom")}
            >
              Bedroom
            </ModeButton>
          </div>
        </div>
      )}
      {session.vocabularyPhase === "confirming" || session.vocabularyPhase === "saving" ? (
        <div className="mt-2" data-remove-vocabulary="confirm">
          <p className="text-[11px] leading-relaxed text-neutral-300">
            {session.vocabularyRequested === "bedroom" ? "Bedroom" : "Default"}. {REMOVE_VOCABULARY_SCAN_CONFIRMATION}
          </p>
          <div className="mt-2 flex gap-1">
            <button
              type="button"
              data-remove-vocabulary="confirm-scan"
              disabled={session.vocabularyPhase === "saving"}
              onClick={session.confirmVocabulary}
              className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
                session.vocabularyPhase === "saving"
                  ? "border-neutral-900 bg-neutral-950 text-neutral-600"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {session.vocabularyPhase === "saving" ? "Saving…" : "Scan again"}
            </button>
            <button
              type="button"
              data-remove-vocabulary="cancel"
              disabled={session.vocabularyPhase === "saving"}
              onClick={session.cancelVocabulary}
              className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} disabled:border-neutral-900 disabled:bg-neutral-950 disabled:text-neutral-600 border-neutral-700 text-neutral-300 hover:bg-neutral-800`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {session.vocabularyError ? (
        <p className="mt-2 text-[11px] leading-relaxed text-red-300" role="alert" data-remove-vocabulary="error">
          {session.vocabularyError}
        </p>
      ) : null}
      {simple ? null : (
        <p className="mt-3 text-[11px] text-neutral-300" role="status" data-remove-objects="status">
          {objectStatus(session)}
        </p>
      )}
      {simple || !reason ? null : (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">{reason}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Object selection">
        <ModeButton
          pressed={false}
          disabled={!canReveal}
          title={reason}
          onClick={session.hideAllObjects}
        >
          Hide All
        </ModeButton>
        <ModeButton
          pressed={false}
          disabled={!canReveal}
          title={reason}
          onClick={session.showAllObjects}
        >
          Show All
        </ModeButton>
      </div>
      {simple ? outlineButton("Show Mask Outline") : null}
      <div className="mt-3" data-remove-cleanup="panel">
        {simple ? null : session.cleanupPhase === "idle" ? (
          <button
            type="button"
            data-remove-cleanup="export"
            disabled={!session.cleanupAvailable}
            onClick={session.openCleanupExport}
            className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
              session.cleanupAvailable
                ? "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                : "border-neutral-900 bg-neutral-950 text-neutral-600"
            }`}
          >
            {session.cleanupLabel}
          </button>
        ) : (
          <div data-remove-cleanup="confirm">
            <p className="text-[11px] leading-relaxed text-neutral-300">{session.cleanupSummary}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">{REMOVE_CLEANUP_EXCLUSION_COPY}</p>
            <div className="mt-2 flex gap-1">
              <button
                type="button"
                data-remove-cleanup="download"
                disabled={session.cleanupPhase === "exporting"}
                onClick={session.downloadCleanupExport}
                className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
                  session.cleanupPhase === "exporting"
                    ? "border-neutral-900 bg-neutral-950 text-neutral-600"
                    : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
                }`}
              >
                {session.cleanupPhase === "exporting" ? "Preparing…" : "Download"}
              </button>
              <button
                type="button"
                data-remove-cleanup="cancel"
                disabled={session.cleanupPhase === "exporting"}
                onClick={session.cancelCleanupExport}
                className={`rounded-md border px-2 py-1 text-[11px] ${FOCUS} disabled:border-neutral-900 disabled:bg-neutral-950 disabled:text-neutral-600 border-neutral-700 text-neutral-300 hover:bg-neutral-800`}
              >
                Cancel
              </button>
            </div>
            {session.cleanupPhase === "exporting" ? (
              <p className="mt-2 text-[11px] text-neutral-400" role="status" data-remove-cleanup="status">
                Preparing Clean Up inputs…
              </p>
            ) : null}
          </div>
        )}
        {simple || !session.cleanupError ? null : (
          <p className="mt-2 text-[11px] leading-relaxed text-red-300" role="alert" data-remove-cleanup="error">
            {session.cleanupError}
          </p>
        )}
        <RemoveCleanupGeneration
          key="remove-cleanup-generation"
          objectUi={session.objectUi}
          onHistoryAccepted={session.onCleanupHistoryAccepted}
          onAcceptancePending={session.noteCleanupAcceptancePending}
          onActivationBlocked={session.noteCleanupActivationBlocked}
        />
      </div>
      {simple ? null : (
        <div data-remove-objects="expansion">
          <BrushSlider
            label="Mask Expansion"
            ariaLabel="Mask Expansion"
            min={0}
            max={REMOVE_OBJECT_EXPANSION_MAX_PX}
            value={session.objectExpansionPx}
            onChange={session.setObjectExpansion}
          />
        </div>
      )}
      {simple ? null : outlineButton("Show Mask Outlines")}
    </div>
  );
}

function objectStatus(session: RemoveAlignmentContextValue): string {
  return scanStatus(session);
}

function scanStatus(session: RemoveAlignmentContextValue): string {
  const diagnostics = session.objectUi.diagnostics;
  return formatRemoveScanStatus({
    phase: session.objectUi.phase,
    error: session.objectUi.error,
    eligibleCount: session.objectUi.objects.length,
    hiddenCount: session.objectUi.selectedIds.size,
    rejectedCount: diagnostics?.rejected.length ?? 0,
    suppressedCount: diagnostics?.suppressed.length ?? 0,
    predictionRejectionCount: diagnostics?.predictionRejections.length ?? 0,
  });
}

function AlignmentDetails({ session }: { session: RemoveAlignmentContextValue }) {
  const report = session.report;
  if (!report) return null;
  return (
    <details className="mt-3 border-t border-neutral-800 pt-2">
      <summary className={`cursor-pointer text-[11px] text-neutral-300 ${FOCUS}`}>
        Alignment
      </summary>
      <dl className="mt-2 space-y-1 text-[10px] leading-relaxed text-neutral-400">
        <Row label="Mode" value={session.mode} />
        <Row label="Brush tool" value={session.tool} />
        <Row label="Diameter" value={`${session.diameterPx} ORIGINAL px`} />
        <Row label="Feather" value={`${session.featherPx} ORIGINAL px`} />
        <Row
          label="Mask resolution"
          value={session.maskSummary
            ? `${session.maskSummary.width}×${session.maskSummary.height}`
            : "not allocated"}
        />
        <Row
          label="Masked coverage"
          value={formatRemoveMaskedCoverage(session.maskSummary?.coveragePercent ?? 0)}
        />
        <Row label="Segmentation" value={segmentationLabel(session)} />
        {session.objectUi.diagnostics ? (
          <>
            <Row label="Provider" value={session.objectUi.diagnostics.provider} />
            <Row label="Model" value={session.objectUi.diagnostics.modelId} />
            <Row label="Mask count" value={String(session.objectUi.diagnostics.maskCount)} />
            <Row label="Eligible objects" value={String(session.objectUi.diagnostics.eligibleCount)} />
            <Row label="Hidden objects" value={String(session.objectUi.selectedIds.size)} />
            <Row
              label="Suppressed duplicates"
              value={formatRemoveObjectSuppressed(session.objectUi.diagnostics.suppressed)}
            />
            <Row
              label="Rejected masks"
              value={formatRemoveObjectRejected(session.objectUi.diagnostics.rejected)}
            />
            <Row
              label="Prediction rejections"
              value={formatRemovePredictionRejections(session.objectUi.diagnostics.predictionRejections)}
            />
            <Row
              label="Inference time"
              value={formatRemoveObjectInferenceTime(session.objectUi.diagnostics)}
            />
          </>
        ) : null}
        <Row label="ORIGINAL/EMPTY" value={report.gridCompatibility} />
        <Row
          label="Aspect rescaling"
          value={report.gridCompatibility === "aspect_compatible_rescaled" ? "yes" : "no"}
        />
        <Row label="Pixel registration" value={report.pixelRegistration} />
        <Row label="Grid comparison" value={report.gridCompatibility} />
        <Row label="Generation" value={report.generationId} />
        <Row label="ORIGINAL" value={describeImage(report.original, report.originalAspect)} />
        <Row label="EMPTY" value={describeImage(report.empty, report.emptyAspect)} />
        <Row label="Aspect error" value={formatError(report.relativeAspectError)} />
        <Row label="Authority frame" value={describeFrame(report.frame)} />
        <Row label="Camera frame" value={describeFrame(report.frozenCameraFrame)} />
        <Row label="EMPTY source" value={report.empty.artifactSource} />
        <Row label="Lineage" value={describeLineage(report)} />
        {session.originalDisagreement ? (
          <Row label="ORIGINAL display" value={session.originalDisagreement} />
        ) : null}
        {session.emptyDisagreement ? (
          <Row label="EMPTY display" value={session.emptyDisagreement} />
        ) : null}
      </dl>
      <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">{REMOVE_ALIGNMENT_NOTE}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-neutral-500">{REMOVE_HARMONIZE_NOTE}</p>
    </details>
  );
}

function segmentationLabel(session: RemoveAlignmentContextValue): string {
  if (session.objectUi.phase === "error") return session.objectUi.error ?? "Segmentation failed.";
  if (session.objectUi.phase === "ready") return scanStatus(session);
  return "Finding objects…";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="break-all font-mono text-neutral-300">{value}</dd>
    </div>
  );
}

function describeImage(
  image: Readonly<{ sha256: string; decodedWidth: number; decodedHeight: number; mimeType: string }>,
  aspect: number | null,
): string {
  return `${image.decodedWidth}×${image.decodedHeight} ${image.mimeType} aspect ${formatError(aspect)} ${image.sha256}`;
}

function describeFrame(frame: Readonly<{ width: number; height: number }>): string {
  return `${frame.width}×${frame.height}`;
}

function describeLineage(report: RemoveAlignmentReport): string {
  const reused = report.empty.reusedFromGenerationId ?? "none";
  const match = report.empty.lineageShaMatches ? "sha matches" : "sha not matched";
  return `${report.empty.lineageSource} reused ${reused} ${match}`;
}

function formatError(value: number | null): string {
  return value === null ? "unavailable" : value.toFixed(4);
}

export function RemoveAlignmentOverlay() {
  const session = useRemoveAlignment();
  const hoverKey = `${session?.sessionSerial ?? 0}:${session?.mode ?? ""}`;
  const [hoverKeySeen, setHoverKeySeen] = useState(hoverKey);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  if (hoverKeySeen !== hoverKey) {
    setHoverKeySeen(hoverKey);
    setHoveredId(null);
  }
  const report = session?.active ? session.report : null;
  if (!session || !report || !session.roomId) return null;
  const compositing = session.brushAdmission?.allowed === true
    && Boolean(session.keepImageUrl)
    && (session.mode === "brush" || session.mode === "objects");
  if (session.mode === "objects" || session.mode === "brush") {
    const objectsMode = session.mode === "objects";
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        data-remove-alignment-overlay="true"
        data-remove-view={session.mode}
        data-remove-mode={session.mode}
        data-remove-keep={session.keepAssetId ?? "missing"}
      >
        {compositing && session.keepImageUrl && session.keepAssetId ? (
          <RemoveBrushCanvas
            active={session.active}
            roomId={session.roomId}
            report={report}
            sessionSerial={session.sessionSerial}
            maskEpoch={session.maskEpoch}
            tool={session.tool}
            diameterPx={session.diameterPx}
            featherPx={session.featherPx}
            maskHoldRef={session.maskHoldRef}
            revealMaskRef={session.revealMaskRef}
            onMaskSummary={session.noteMaskSummary}
            onDisplayedSize={session.noteDisplayedSize}
            keepImageUrl={session.keepImageUrl}
            keepAssetId={session.keepAssetId}
            onKeepIdentity={session.noteKeepIdentity}
            interaction={objectsMode ? "objects" : "brush"}
            backdrop={false}
            objects={session.objectUi.objects}
            selectedIds={session.objectUi.selectedIds}
            expansionPx={session.objectExpansionPx}
            protectObjects={removeObjectProtectionEngaged({
              enabled: session.objectProtectionEnabled,
              state: session.objectUi,
            })}
            onObjectClick={(point) => session.clickObject(point.x, point.y)}
            onObjectHover={(point) => {
              const next = point ? highlightRemoveObject(session.objectUi, point.x, point.y) : null;
              setHoveredId((current) => current === next ? current : next);
            }}
          />
        ) : session.keepImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed History image is the frozen keep-layer
          <img
            src={session.keepImageUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        ) : null}
        {objectsMode ? <ObjectLayer session={session} hoveredId={hoveredId} /> : null}
      </div>
    );
  }
  const layers = removeOverlayLayers(session.opacity);
  const mode = removeViewMode(session.opacity);
  const note = session.noteDisplayedSize;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1]"
      data-remove-alignment-overlay="true"
      data-remove-view={mode}
      aria-hidden="true"
    >
      {layers.showOriginal ? (
        <OriginalInspectionImage
          roomId={session.roomId}
          generationId={report.generationId}
          onDisplayedSize={note}
        />
      ) : null}
      {layers.showEmpty ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin inspection bytes are served by the remove route
        <img
          alt=""
          draggable={false}
          src={removeAlignmentArtifactPath(session.roomId, "empty", report.generationId)}
          style={{ opacity: layers.emptyOpacity }}
          className="absolute inset-0 h-full w-full"
          onLoad={(event) => note("empty", naturalSize(event.currentTarget))}
        />
      ) : null}
    </div>
  );
}

function OriginalInspectionImage({
  roomId,
  generationId,
  onDisplayedSize,
}: {
  roomId: string;
  generationId: string;
  onDisplayedSize: (artifact: "original" | "empty", size: DisplayedSize) => void;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- admin inspection bytes are served by the remove route
    <img
      src={removeAlignmentArtifactPath(roomId, "original", generationId)}
      alt=""
      draggable={false}
      className="pointer-events-none absolute inset-0 h-full w-full"
      onLoad={(event) => onDisplayedSize("original", naturalSize(event.currentTarget))}
    />
  );
}

function ObjectLayer({
  session,
  hoveredId,
}: {
  session: RemoveAlignmentContextValue;
  hoveredId: string | null;
}) {
  return (
    <>
      {session.objectUi.phase === "ready" && session.objectUi.objects.length > 0 ? (
        <RemoveObjectOutlines
          objects={session.objectUi.objects}
          selectedIds={session.objectUi.selectedIds}
          hoveredId={hoveredId}
          outlinesVisible={session.objectOutlinesVisible}
        />
      ) : null}
      {session.objectUi.phase === "ready" ? null : session.objectUi.phase === "error" ? (
        <div
          className="pointer-events-none absolute inset-x-6 top-6 text-center text-xs text-neutral-100"
          role="alert"
          data-remove-objects="error"
        >
          {session.objectUi.error}
        </div>
      ) : (
        <div
          className="pointer-events-none absolute inset-x-6 top-6 text-center text-xs text-neutral-100"
          role="status"
        >
          Finding objects…
        </div>
      )}
    </>
  );
}

function naturalSize(image: HTMLImageElement): DisplayedSize {
  return { width: image.naturalWidth, height: image.naturalHeight };
}
