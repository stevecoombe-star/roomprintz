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
  enter: () => void;
  exit: () => void;
  setOpacity: (opacity: number) => void;
  setPreset: (preset: (typeof REMOVE_OPACITY_PRESETS)[number]["id"]) => void;
  setFurnitureHidden: (hidden: boolean) => void;
  noteDisplayedSize: (artifact: "original" | "empty", size: DisplayedSize) => void;
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
  const noteDisplayedSize = useCallback((artifact: "original" | "empty", size: DisplayedSize) => {
    setDisplayed((current) => ({ ...current, [artifact]: size }));
  }, []);

  const value = useMemo<RemoveAlignmentContextValue>(() => ({
    roomId,
    active: inspection.active && lookup.access === "ready",
    access: lookup.access,
    report,
    opacity: inspection.opacity,
    furnitureHidden: inspection.furnitureHidden,
    furnitureRenderingVisible: removeFurnitureRenderingVisible({
      active: inspection.active && lookup.access === "ready",
      furnitureHidden: inspection.furnitureHidden,
    }),
    disabledReason: lookup.access === "disabled" ? lookup.reason : null,
    enter,
    exit,
    setOpacity,
    setPreset,
    setFurnitureHidden,
    noteDisplayedSize,
    originalDisagreement: report
      ? removeDecodedSizeDisagreement({
        width: report.original.decodedWidth,
        height: report.original.decodedHeight,
      }, displayed.original)
      : null,
    emptyDisagreement: report
      ? removeDecodedSizeDisagreement({
        width: report.empty.decodedWidth,
        height: report.empty.decodedHeight,
      }, displayed.empty)
      : null,
  }), [
    displayed.empty,
    displayed.original,
    enter,
    exit,
    inspection.active,
    inspection.furnitureHidden,
    inspection.opacity,
    lookup,
    noteDisplayedSize,
    roomId,
    report,
    setFurnitureHidden,
    setOpacity,
    setPreset,
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
          className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-neutral-700 bg-neutral-950 p-3 text-neutral-200 shadow-lg"
        >
          <div className="flex gap-1" role="group" aria-label="Alignment presets">
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
          <AlignmentDetails session={session} />
        </div>
      ) : null}
    </div>
  );
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
  const report = session?.active ? session.report : null;
  if (!session || !report) return null;
  if (!session.roomId) return null;
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
        // eslint-disable-next-line @next/next/no-img-element -- admin inspection bytes are served by the remove route
        <img
          src={removeAlignmentArtifactPath(session.roomId, "original", report.generationId)}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full"
          onLoad={(event) => note("original", naturalSize(event.currentTarget))}
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

function naturalSize(image: HTMLImageElement): DisplayedSize {
  return { width: image.naturalWidth, height: image.naturalHeight };
}
