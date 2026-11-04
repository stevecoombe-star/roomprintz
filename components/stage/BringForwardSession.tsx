"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { BringForwardSelection } from "@/components/stage/BringForwardSelection";
import { useRemoveAlignment } from "@/components/stage/RemoveAlignmentSession";
import { removeAlignmentArtifactPath } from "@/lib/vibode-stage/remove-alignment";
import { loadBringForwardImage } from "@/lib/vibode-stage/bring-forward-image";
import {
  assessBringForwardDisplay,
  bringForwardDisplayKey,
  bringForwardImageIdentity,
  type BringForwardBackgroundClaim,
  bringForwardScanKey,
  bringForwardScanVersion,
  bringForwardStatusMessage,
  cancelBringForward,
  doneBringForward,
  emptyBringForwardEditor,
  enterBringForward,
  installBringForwardScan,
  loadBringForwardScan,
  readBringForwardScan,
  readBringForwardScanError,
  scopeBringForwardEditor,
  subscribeBringForwardScans,
  toggleBringForwardId,
  visibleBringForwardIds,
  type BringForwardDisplayPhase,
  type BringForwardEditor,
  type BringForwardScan,
} from "@/lib/vibode-stage/bring-forward-cutout";
import type { RemoveObjectUiIdentity } from "@/lib/vibode-stage/remove-object-ui";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

type VerifiedOriginal = Readonly<{
  key: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}>;

type BringForwardContextValue = Readonly<{
  editing: boolean;
  editor: BringForwardEditor;
  scan: BringForwardScan | null;
  visibleIds: ReadonlySet<string>;
  verified: VerifiedOriginal | null;
  display: BringForwardDisplayPhase;
  error: string | null;
  status: string;
  backgroundUrl: string | null;
  noteBackgroundUrl: (url: string | null) => void;
  enter: () => void;
  done: () => void;
  cancel: () => void;
  toggle: (id: string) => void;
}>;

const BringForwardContext = createContext<BringForwardContextValue | null>(null);

export function BringForwardProvider({
  children,
  background = null,
}: {
  children: ReactNode;
  background?: BringForwardBackgroundClaim | null;
}) {
  const alignment = useRemoveAlignment();
  const roomId = alignment?.roomId ?? "";
  const generationId = alignment?.report?.generationId ?? "";
  const vocabularyRevision = alignment?.vocabularyRevision ?? 0;
  const removeActive = alignment?.active === true;
  const scanVersion = useSyncExternalStore(
    subscribeBringForwardScans,
    bringForwardScanVersion,
    bringForwardScanVersion,
  );
  const original = useMemo(() => {
    const report = alignment?.report;
    if (!report) return null;
    return bringForwardImageIdentity({
      sha256: report.original.sha256,
      width: report.original.decodedWidth,
      height: report.original.decodedHeight,
    });
  }, [alignment?.report]);
  const scanKey = original && roomId && generationId
    ? bringForwardScanKey({
      roomId,
      generationId,
      originalSha256: original.sha256,
      originalWidth: original.width,
      originalHeight: original.height,
      vocabularyRevision,
    })
    : null;
  const cached = scanKey ? readBringForwardScan(scanKey) : null;
  void scanVersion;
  const [editor, setEditor] = useState<BringForwardEditor>(emptyBringForwardEditor);
  let nextEditor = removeActive && editor.editing ? cancelBringForward(editor) : editor;
  nextEditor = scopeBringForwardEditor(nextEditor, { roomId, generationId, vocabularyRevision });
  if (cached) nextEditor = installBringForwardScan(nextEditor, cached);
  if (nextEditor !== editor) setEditor(nextEditor);
  const activeEditor = nextEditor;
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifiedOriginal | null>(null);
  const [displayNote, setDisplayNote] = useState<Readonly<{
    key: string;
    status: "show" | "hide";
  }> | null>(null);
  const noteBackgroundUrl = useCallback((url: string | null) => {
    setBackgroundUrl((current) => current === url ? current : url);
  }, []);
  const activeClaim = background && backgroundUrl && background.imageUrl === backgroundUrl
    ? background
    : null;
  const displayKey = original && backgroundUrl && roomId && generationId
    ? bringForwardDisplayKey({
      roomId,
      generationId,
      backgroundUrl,
      original,
      background: activeClaim,
    })
    : null;
  const visibleIds = visibleBringForwardIds(activeEditor);
  const needsPixels = activeEditor.editing || visibleIds.size > 0;
  const identity = useMemo<RemoveObjectUiIdentity | null>(() => {
    if (!original || !roomId || !generationId) return null;
    return {
      roomId,
      generationId,
      originalSha256: original.sha256,
      originalWidth: original.width,
      originalHeight: original.height,
      sessionSerial: 0,
      vocabularyRevision,
    };
  }, [generationId, original, roomId, vocabularyRevision]);

  useEffect(() => {
    if (!needsPixels || !displayKey || !original || !backgroundUrl || !roomId || !generationId) {
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const key = displayKey;
    const sourceUrl = removeAlignmentArtifactPath(roomId, "original", generationId);
    const shouldScan = activeEditor.editing;
    const scanIdentity = identity;
    void (async () => {
      const [displayed, source] = await Promise.all([
        loadBringForwardImage(backgroundUrl, controller.signal, false),
        loadBringForwardImage(sourceUrl, controller.signal, true),
      ]);
      if (cancelled) return;
      const decision = assessBringForwardDisplay({
        snapshot: { roomId, generationId, original, objects: [] },
        roomId,
        generationId,
        displayed: displayed
          ? { sha256: displayed.sha256, width: displayed.width, height: displayed.height }
          : null,
        source: source
          ? { sha256: source.sha256, width: source.width, height: source.height }
          : null,
        removeActive: false,
        background: activeClaim,
      });
      if (decision !== "show" || !source?.rgba) {
        setVerified((current) => (current && current.key === key ? null : current));
        setDisplayNote({ key, status: "hide" });
        return;
      }
      setVerified({
        key,
        rgba: source.rgba,
        width: source.width,
        height: source.height,
      });
      setDisplayNote({ key, status: "show" });
      if (!shouldScan || !scanIdentity) return;
      await loadBringForwardScan({ identity: scanIdentity });
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    activeClaim,
    activeEditor.editing,
    backgroundUrl,
    displayKey,
    generationId,
    identity,
    needsPixels,
    original,
    roomId,
  ]);

  const display: BringForwardDisplayPhase = !needsPixels
    ? "idle"
    : !displayKey
      ? "checking"
      : displayNote?.key === displayKey
        ? displayNote.status
        : "checking";
  const error = display === "show" && scanKey ? readBringForwardScanError(scanKey) : null;
  const scan = activeEditor.scan;
  const status = bringForwardStatusMessage({
    display,
    scanReady: scan !== null,
    objectCount: scan?.objects.length ?? 0,
    error: display === "show" ? error : null,
  });
  const enter = useCallback(() => {
    if (removeActive || alignment?.access !== "ready") return;
    setEditor((current) => enterBringForward(current));
  }, [alignment?.access, removeActive, setEditor]);
  const done = useCallback(() => {
    setEditor((current) => doneBringForward(current));
  }, [setEditor]);
  const cancel = useCallback(() => {
    setEditor((current) => cancelBringForward(current));
  }, [setEditor]);
  const toggle = useCallback((id: string) => {
    setEditor((current) => {
      if (!current.editing) return current;
      return { ...current, draftIds: toggleBringForwardId(current.draftIds, id) };
    });
  }, [setEditor]);
  const value = useMemo<BringForwardContextValue>(() => ({
    editing: activeEditor.editing,
    editor: activeEditor,
    scan,
    visibleIds,
    verified: verified && verified.key === displayKey ? verified : null,
    display,
    error,
    status,
    backgroundUrl,
    noteBackgroundUrl,
    enter,
    done,
    cancel,
    toggle,
  }), [
    activeEditor,
    backgroundUrl,
    cancel,
    display,
    displayKey,
    done,
    enter,
    error,
    noteBackgroundUrl,
    scan,
    status,
    toggle,
    verified,
    visibleIds,
  ]);
  return (
    <BringForwardContext.Provider value={value}>
      {children}
    </BringForwardContext.Provider>
  );
}

export function useBringForward(): BringForwardContextValue | null {
  return useContext(BringForwardContext);
}

export function BringForwardControl() {
  const alignment = useRemoveAlignment();
  const forward = useBringForward();
  if (!alignment || !forward || alignment.access === "hidden") return null;
  const removeActive = alignment.active;
  const unavailable = alignment.access !== "ready";
  const disabled = unavailable || removeActive;
  return (
    <div className="relative shrink-0" data-bring-forward="control">
      <button
        type="button"
        data-bring-forward="toggle"
        aria-label="Bring Forward"
        aria-pressed={forward.editing}
        disabled={disabled}
        title={removeActive
          ? "Exit Remove before Bring Forward."
          : unavailable
            ? alignment.disabledReason ?? "ORIGINAL and EMPTY are not ready."
            : forward.editing
              ? "Exit Bring Forward"
              : "Bring a photographed object in front of furniture"}
        onClick={() => {
          if (disabled) return;
          if (forward.editing) forward.cancel();
          else forward.enter();
        }}
        className={`rounded-md border px-2.5 py-1 text-xs whitespace-nowrap ${FOCUS} ${
          disabled
            ? "border-neutral-900 bg-neutral-950 text-neutral-600"
            : forward.editing
              ? "border-neutral-500 bg-neutral-800 text-neutral-100"
              : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
        }`}
      >
        Bring Forward
      </button>
      {forward.editing ? (
        <div
          role="region"
          aria-label="Bring Forward"
          data-bring-forward="panel"
          className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] rounded-md border border-neutral-700 bg-neutral-950 text-neutral-200 shadow-lg"
        >
          <p
            className="p-3 text-[11px] leading-relaxed text-neutral-300"
            role={forward.error || forward.display === "hide" ? "alert" : "status"}
            data-bring-forward="status"
          >
            {forward.status}
          </p>
          <div className="border-t border-neutral-800 p-3">
            <button
              type="button"
              data-bring-forward="done"
              onClick={forward.done}
              className={`rounded-md border border-neutral-200 bg-neutral-100 px-2 py-1 text-[11px] text-neutral-950 hover:bg-white ${FOCUS}`}
            >
              Done
            </button>
            <button
              type="button"
              data-bring-forward="cancel"
              onClick={forward.cancel}
              className={`mt-2 ml-1 rounded-md border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 ${FOCUS}`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BringForwardSelectionSurface() {
  const forward = useBringForward();
  if (!forward?.editing || forward.display !== "show" || !forward.scan) return null;
  if (forward.scan.objects.length === 0) return null;
  return (
    <BringForwardSelection
      objects={forward.scan.objects}
      selectedIds={forward.editor.draftIds}
      width={forward.scan.original.width}
      height={forward.scan.original.height}
      onToggle={forward.toggle}
    />
  );
}
