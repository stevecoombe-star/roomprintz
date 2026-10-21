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
import { RemoveObjectOutlines } from "@/components/stage/RemoveObjectOutlines";
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
  hideAllRemoveObjectUi,
  highlightRemoveObject,
  initialRemoveObjectUiState,
  reduceRemoveObjectSession,
  removeObjectProtectionAvailable,
  removeObjectProtectionEngaged,
  removeObjectUiIdentityKey,
  requestRemoveObjects,
  settleRemoveObjectLoad,
  showAllRemoveObjectUi,
  type RemoveObjectUiIdentity,
  type RemoveObjectUiState,
} from "@/lib/vibode-stage/remove-object-ui";

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
  objectExpansionPx: number;
  objectOutlinesVisible: boolean;
  objectProtectionEnabled: boolean;
  brushAdmission: RemoveBrushAdmission | null;
  maskSummary: RemoveMaskSummary | null;
  maskHoldRef: { current: RemoveMaskHold | null };
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
  originalDisagreement: string | null;
  emptyDisagreement: string | null;
}>;

const RemoveAlignmentContext = createContext<RemoveAlignmentContextValue | null>(null);

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
  children,
}: {
  roomId: string | null;
  children: ReactNode;
}) {
  const roomRef = useRef(roomId);
  const [lookup, setLookup] = useState<RemoveAlignmentLookup>({ access: "hidden" });
  const [inspection, dispatch] = useReducer(
    reduceRemoveInspection,
    initialRemoveInspectionState(),
  );
  const [displayed, setDisplayed] = useState<Readonly<{
    original: DisplayedSize | null;
    empty: DisplayedSize | null;
  }>>({ original: null, empty: null });
  const [maskSummary, setMaskSummary] = useState<RemoveMaskSummary | null>(null);
  const maskHoldRef = useRef<RemoveMaskHold | null>(null);
  const [objectUi, setObjectUi] = useState<RemoveObjectUiState>(initialRemoveObjectUiState());
  const objectUiRef = useRef(objectUi);
  const [cleanupUi, setCleanupUi] = useState<RemoveCleanupUiState>(initialRemoveCleanupUiState());
  const [cleanupSnapshot, setCleanupSnapshot] = useState<RemoveCleanupSnapshotObject[]>([]);
  const [cleanupController, setCleanupController] = useState<AbortController | null>(null);
  const cleanupClaimRef = useRef(false);
  const loadRef = useRef<null | {
    key: string;
    serial: number;
    controller: AbortController;
    promise: Promise<Readonly<{ payload: unknown; elapsedMs: number }>>;
  }>(null);
  const ticketRef = useRef(0);
  const [trackedRoomId, setTrackedRoomId] = useState(roomId);
  if (trackedRoomId !== roomId) {
    setTrackedRoomId(roomId);
    setDisplayed({ original: null, empty: null });
    setLookup({ access: "hidden" });
    dispatch({ type: "exit" });
  }

  const refresh = useCallback(async (nextRoomId: string) => {
    try {
      const next = await loadRemoveAlignment(nextRoomId);
      if (roomRef.current === nextRoomId) setLookup(next);
      return next;
    } catch {
      const hidden: RemoveAlignmentLookup = { access: "hidden" };
      if (roomRef.current === nextRoomId) setLookup(hidden);
      return hidden;
    }
  }, []);

  useEffect(() => {
    roomRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return undefined;
    const activeRoomId = roomId;
    let cancelled = false;
    void loadRemoveAlignment(activeRoomId).then((next) => {
      if (!cancelled && roomRef.current === activeRoomId) setLookup(next);
    }).catch(() => {
      if (!cancelled && roomRef.current === activeRoomId) setLookup({ access: "hidden" });
    });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  useEffect(() => {
    if (!inspection.active) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "exit" });
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
    };
  }, [inspection.sessionSerial, report, roomId, sessionActive]);
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
    if (decision.command === "abort") {
      loadRef.current?.controller.abort();
      loadRef.current = null;
      return undefined;
    }
    if (!objectIdentity) return undefined;
    const objectIdentityKey = removeObjectUiIdentityKey(objectIdentity);
    if (decision.command === "fetch") {
      loadRef.current?.controller.abort();
      const controller = new AbortController();
      const serial = decision.state.requestSerial;
      const promise = requestRemoveObjects({ identity: objectIdentity, signal: controller.signal });
      loadRef.current = { key: objectIdentityKey, serial, controller, promise };
    }
    const entry = loadRef.current;
    if (!entry || decision.state.phase !== "loading" || entry.key !== objectIdentityKey) return undefined;
    const ticket = ticketRef.current + 1;
    ticketRef.current = ticket;
    const serial = entry.serial;
    void entry.promise.then((result) => {
      if (ticketRef.current !== ticket) return;
      setObjectUi((current) => {
        const next = settleRemoveObjectLoad({
          state: current,
          requestSerial: serial,
          identity: objectIdentity,
          payload: result.payload,
          elapsedMs: result.elapsedMs,
        });
        objectUiRef.current = next;
        return next;
      });
    }).catch(() => {
      if (ticketRef.current !== ticket) return;
      if (entry.controller.signal.aborted) return;
      setObjectUi((current) => {
        const next = failRemoveObjectLoad({
          state: current,
          requestSerial: serial,
          identity: objectIdentity,
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

  const enter = useCallback(() => {
    const requested = roomRef.current;
    if (!requested) return;
    void refresh(requested).then((next) => {
      if (roomRef.current !== requested || next.access !== "ready") return;
      dispatch({ type: "enter" });
    });
  }, [refresh]);
  const exit = useCallback(() => dispatch({ type: "exit" }), []);
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
    objectExpansionPx: inspection.objectExpansionPx,
    objectOutlinesVisible: inspection.objectOutlinesVisible,
    objectProtectionEnabled: inspection.objectProtectionEnabled,
    brushAdmission,
    maskSummary,
    maskHoldRef,
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
    inspection.diameterPx,
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
    openCleanupExport,
    originalDisagreement,
    roomId,
    report,
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

export function RemoveAlignmentControl() {
  const session = useRemoveAlignment();
  if (!session || session.access === "hidden") return null;
  const disabled = session.access !== "ready";
  const pressedPreset = removeOpacityPreset(session.opacity);
  return (
    <div className="relative shrink-0" data-remove-alignment="control">
      <button
        type="button"
        data-remove-alignment="toggle"
        aria-label="Remove"
        aria-pressed={session.active}
        disabled={disabled}
        title={disabled
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
        <div
          role="region"
          aria-label="Remove inspection"
          data-remove-mode={session.mode}
          className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-950 p-3 text-neutral-200 shadow-lg"
        >
          <div className="flex gap-1" role="group" aria-label="Remove mode">
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
              disabled={session.brushAdmission?.allowed !== true}
              title={session.brushAdmission?.allowed === false ? session.brushAdmission.reason : undefined}
              onClick={() => session.setMode("brush")}
            >
              Brush
            </ModeButton>
          </div>
          {session.mode === "alignment" ? (
            <>
              <div className="mt-3 flex gap-1" role="group" aria-label="Alignment presets">
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
          <button
            type="button"
            aria-pressed={session.furnitureHidden}
            onClick={() => session.setFurnitureHidden(!session.furnitureHidden)}
            className={`mt-3 rounded-md border px-2 py-1 text-[11px] ${FOCUS} ${
              session.furnitureHidden
                ? "border-neutral-500 bg-neutral-800 text-neutral-50"
                : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
          {session.furnitureHidden ? "Show furniture" : "Hide furniture"}
        </button>
        <button
          type="button"
          data-remove-objects="done"
          onClick={session.exit}
          className={`mt-2 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 hover:bg-neutral-800 ${FOCUS}`}
        >
          Done
        </button>
        <AlignmentDetails session={session} />
        </div>
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
      : session.objectUi.phase === "error"
        ? session.objectUi.error ?? "Object masks are unavailable."
        : "No removable objects found.";
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
  const protection = protectionControl(session);
  return (
    <div className="mt-3">
      <div className="flex gap-1" role="group" aria-label="Brush tool">
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
      <button
        type="button"
        onClick={session.clearMask}
        className={`mt-3 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 ${FOCUS}`}
      >
        Clear Mask
      </button>
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
  const ready = session.objectUi.phase === "ready" && session.objectUi.objects.length > 0;
  const canReveal = ready && session.brushAdmission?.allowed === true;
  const reason = session.brushAdmission?.allowed === false ? session.brushAdmission.reason : undefined;
  return (
    <div className="mt-3">
      <p className="text-[11px] text-neutral-300" role="status" data-remove-objects="status">
        {objectStatus(session)}
      </p>
      {reason ? (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">{reason}</p>
      ) : null}
      <div className="mt-3 flex gap-1" role="group" aria-label="Object selection">
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
      <div className="mt-3" data-remove-cleanup="panel">
        {session.cleanupPhase === "idle" ? (
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
        {session.cleanupError ? (
          <p className="mt-2 text-[11px] leading-relaxed text-red-300" role="alert" data-remove-cleanup="error">
            {session.cleanupError}
          </p>
        ) : null}
      </div>
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
        Show Mask Outlines
      </button>
    </div>
  );
}

function objectStatus(session: RemoveAlignmentContextValue): string {
  if (session.objectUi.phase === "error") {
    return session.objectUi.error ?? "Segmentation failed.";
  }
  if (session.objectUi.phase !== "ready") return "Finding objects…";
  if (session.objectUi.objects.length === 0) return "No removable objects found.";
  const hidden = session.objectUi.selectedIds.size;
  return hidden === 0
    ? `${session.objectUi.objects.length} objects`
    : `${session.objectUi.objects.length} objects, ${hidden} hidden`;
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
  if (session.objectUi.phase === "ready") return "ready";
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
    && (session.mode === "brush" || session.mode === "objects");
  if (compositing) {
    const objectsMode = session.mode === "objects";
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        data-remove-alignment-overlay="true"
        data-remove-view={session.mode}
        data-remove-mode={session.mode}
      >
        {objectsMode ? (
          <OriginalInspectionImage
            roomId={session.roomId}
            generationId={report.generationId}
            onDisplayedSize={session.noteDisplayedSize}
          />
        ) : null}
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
          onMaskSummary={session.noteMaskSummary}
          onDisplayedSize={session.noteDisplayedSize}
          interaction={objectsMode ? "objects" : "brush"}
          backdrop={!objectsMode}
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
        {objectsMode ? <ObjectLayer session={session} hoveredId={hoveredId} /> : null}
      </div>
    );
  }
  if (session.mode === "objects") {
    return (
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        data-remove-alignment-overlay="true"
        data-remove-view="objects"
        data-remove-mode="objects"
      >
        <OriginalInspectionImage
          roomId={session.roomId}
          generationId={report.generationId}
          onDisplayedSize={session.noteDisplayedSize}
        />
        <ObjectLayer session={session} hoveredId={null} />
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
