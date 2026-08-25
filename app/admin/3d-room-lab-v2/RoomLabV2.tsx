"use client";

import Image from "next/image";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  AFC_STATUS_LABELS,
  INITIAL_AFC_ORCHESTRATION_STATE,
  reduceAfcOrchestrationState,
} from "./orchestration-state";
import {
  REPRESENTATION_DESCRIPTIONS,
  REPRESENTATION_KINDS,
  REPRESENTATION_LABELS,
  createInitialRepresentationState,
  setEmptyRepresentation,
  setOriginalRepresentation,
} from "./representation-state";
import CalibratedRoomViewer from "./CalibratedRoomViewer";

type OriginalBasis = {
  basisFingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  encodedOrientation: 1;
};

type AppliedAfcResult = {
  floor: {
    authorityKey: string;
    sourceNormalizedPolygon: readonly { x: number; y: number }[];
    worldWidthM: number;
    referenceDepthM: number;
    widthDepthRatio: number;
  };
  camera: {
    verticalFovDeg: number;
    originalBasisRestored: true;
    frame: { width: number; height: number };
    pose: {
      position: { x: number; y: number; z: number };
      lookAt: { x: number; y: number; z: number };
      up: { x: number; y: number; z: number };
    };
  };
  freezeReceipt: unknown;
  parityEvidence: unknown;
};

function isPreparedOriginal(
  value: unknown,
): value is { ok: true; basis: OriginalBasis } {
  return !!value && typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    !!(value as { basis?: unknown }).basis;
}

function isAppliedAfcResult(value: unknown): value is {
  status: "applied";
  floor: AppliedAfcResult["floor"];
  camera: AppliedAfcResult["camera"];
  freezeReceipt: unknown;
} {
  return !!value && typeof value === "object" &&
    (value as { status?: unknown }).status === "applied";
}

export default function RoomLabV2() {
  const [representations, setRepresentations] = useState(
    createInitialRepresentationState,
  );
  const [orchestration, dispatch] = useReducer(
    reduceAfcOrchestrationState,
    INITIAL_AFC_ORCHESTRATION_STATE,
  );
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [preparedImageUrl, setPreparedImageUrl] = useState<string | null>(null);
  const [basis, setBasis] = useState<OriginalBasis | null>(null);
  const [applied, setApplied] = useState<AppliedAfcResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewerFrame, setViewerFrame] = useState({ width: 0, height: 0 });
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const loadGenerationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const selectedRepresentation =
    representations[orchestration.selectedRepresentation];
  const originalAvailable =
    representations.ORIGINAL.availability === "available" && basis !== null;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const update = () =>
      setViewerFrame({
        width: Math.round(viewer.clientWidth),
        height: Math.round(viewer.clientHeight),
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  async function prepareOriginal() {
    const requestedUrl = sourceImageUrl.trim();
    if (!requestedUrl) return;
    const imageUrl = new URL(requestedUrl, window.location.origin).toString();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    loadGenerationRef.current += 1;
    const generation = loadGenerationRef.current;
    setBasis(null);
    setPreparedImageUrl(null);
    setApplied(null);
    setError(null);
    dispatch({ type: "original_preparation_started" });
    try {
      const response = await fetch("/api/admin/3d-room-lab-v2/prepare-original", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ sourceImageUrl: imageUrl }),
      });
      const result: unknown = await response.json();
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      if (!response.ok || !isPreparedOriginal(result)) {
        throw new Error("The Original could not be authority-qualified.");
      }
      setBasis(result.basis);
      setPreparedImageUrl(imageUrl);
      setRepresentations((current) =>
        setOriginalRepresentation(current, {
          imageUrl,
          source: { type: "hosted-url", imageUrl },
        }),
      );
      dispatch({ type: "original_ready" });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Original preparation failed.");
      dispatch({ type: "analysis_failed" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function analyzeAndApply() {
    if (
      !basis ||
      !preparedImageUrl ||
      !originalAvailable ||
      viewerFrame.width <= 0 ||
      viewerFrame.height <= 0
    ) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = loadGenerationRef.current;
    const attemptId = `afc-v2-${window.crypto.randomUUID()}`;
    setApplied(null);
    setError(null);
    dispatch({ type: "analysis_stage", status: "generating_empty" });
    try {
      const response = await fetch("/api/admin/3d-room-lab-v2/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          attemptId,
          sourceImageUrl: preparedImageUrl,
          sourceImageIdentity: {
            sha256: basis.basisFingerprint,
            decodedWidth: basis.decodedWidth,
            decodedHeight: basis.decodedHeight,
            orientation: basis.encodedOrientation,
          },
          loadGeneration: generation,
          frame: viewerFrame,
          referenceDepthM: 4,
        }),
      });
      dispatch({ type: "analysis_stage", status: "generating_floor_scaffold" });
      const result: unknown = await response.json();
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      if (!response.ok || !isAppliedAfcResult(result)) {
        const reason = result && typeof result === "object" &&
          typeof (result as { reason?: unknown }).reason === "string"
          ? (result as { reason: string }).reason
          : "Certified floor AFC could not be applied.";
        throw new Error(reason);
      }
      dispatch({ type: "analysis_stage", status: "reading_floor" });
      setRepresentations((current) =>
        setEmptyRepresentation(
          current,
          `/api/admin/3d-room-lab-v2/attempt-empty?attemptId=${encodeURIComponent(attemptId)}`,
        ),
      );
      dispatch({ type: "analysis_stage", status: "calibrating_camera" });
      setApplied({
        floor: result.floor,
        camera: result.camera,
        freezeReceipt: result.freezeReceipt,
        parityEvidence: result,
      });
      dispatch({ type: "analysis_applied" });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "AFC analysis failed.");
      dispatch({ type: "analysis_failed" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function downloadParityEvidence() {
    if (!applied) return;
    const blob = new Blob(
      [JSON.stringify(applied.parityEvidence, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s2-parity-evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-5 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-cyan-200">
                AFC V2 · S2
              </span>
              <span className="text-xs text-slate-500">
                Certified floor AFC parity
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              3D Room Lab v2
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Run the certified floor-AFC path against an authority-qualified
              Original image URL. Floor-only TILED remains internal evidence.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="url"
              value={sourceImageUrl}
              onChange={(event) => setSourceImageUrl(event.target.value)}
              placeholder="https://…/original.jpg"
              aria-label="Original room image URL"
              className="min-w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
            />
            <button
              type="button"
              onClick={() => void prepareOriginal()}
              disabled={!sourceImageUrl.trim()}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600"
            >
              Prepare Original
            </button>
            <button
              type="button"
              disabled={!originalAvailable}
              onClick={() => void analyzeAndApply()}
              className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
              title={
                originalAvailable
                  ? "Run certified floor AFC"
                  : "Prepare an Original room image first"
              }
            >
              Analyze &amp; Apply AFC
            </button>
          </div>
        </header>

        <section
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]"
          aria-label="AFC v2 workspace"
        >
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div
                className="flex flex-wrap gap-1"
                role="tablist"
                aria-label="Room representations"
              >
                {REPRESENTATION_KINDS.map((kind) => {
                  const active =
                    orchestration.selectedRepresentation === kind;
                  const available =
                    representations[kind].availability === "available";
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() =>
                        dispatch({
                          type: "representation_selected",
                          representation: kind,
                        })
                      }
                      className={`rounded-md px-3 py-2 text-xs font-semibold tracking-wide transition ${
                        active
                          ? "bg-slate-700 text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {REPRESENTATION_LABELS[kind]}
                      {!available && kind !== "ORIGINAL" ? (
                        <span className="ml-2 text-slate-600">—</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-slate-500">
                {REPRESENTATION_DESCRIPTIONS[
                  orchestration.selectedRepresentation
                ]}
              </span>
            </div>

            <div
              ref={viewerRef}
              className="relative flex min-h-[440px] items-center justify-center bg-black/40 lg:min-h-[620px]"
              role="tabpanel"
              aria-label={`${REPRESENTATION_LABELS[orchestration.selectedRepresentation]} viewer`}
            >
              {selectedRepresentation.availability === "available" ? (
                <>
                  {orchestration.selectedRepresentation === "ORIGINAL" &&
                  applied ? (
                    <CalibratedRoomViewer
                      originalImageUrl={selectedRepresentation.imageUrl}
                      camera={applied.camera}
                      floor={{
                        worldWidthM: applied.floor.worldWidthM,
                        referenceDepthM: applied.floor.referenceDepthM,
                      }}
                    />
                  ) : (
                    <Image
                      src={selectedRepresentation.imageUrl}
                      alt="Loaded Original room"
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  )}
                  {selectedRepresentation.source ? (
                    <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
                      Original · authority-qualified
                    </div>
                  ) : null}
                  {orchestration.selectedRepresentation === "ORIGINAL" && applied ? (
                    <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Calibrated floor authority">
                      <polygon
                        points={applied.floor.sourceNormalizedPolygon.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="rgba(34, 211, 238, 0.13)"
                        stroke="rgb(103, 232, 249)"
                        strokeWidth="0.004"
                      />
                    </svg>
                  ) : null}
                </>
              ) : (
                <div className="max-w-md px-8 text-center">
                  <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-lg text-slate-500">
                    —
                  </div>
                  <h2 className="text-base font-semibold text-slate-200">
                    {
                      REPRESENTATION_LABELS[
                        orchestration.selectedRepresentation
                      ]
                    }{" "}
                    is unavailable
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {selectedRepresentation.reason}
                  </p>
                </div>
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-3" aria-label="AFC architecture status">
            <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-slate-100">
                  AFC Status
                </h2>
                <span className="size-2 rounded-full bg-cyan-300" />
              </div>
              <p
                className="mt-3 text-sm font-medium text-cyan-100"
                aria-live="polite"
              >
                {AFC_STATUS_LABELS[orchestration.status]}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {error ?? "The result is bound to the accepted Original basis."}
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Floor</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {applied
                  ? `Calibrated · width ${applied.floor.worldWidthM.toFixed(2)} m · reference depth ${applied.floor.referenceDepthM.toFixed(2)} m · ratio ${applied.floor.widthDepthRatio.toFixed(3)}`
                  : "No calibrated Floor authority."}
              </p>
            </section>
            {applied ? (
              <button
                type="button"
                onClick={downloadParityEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-cyan-200 transition hover:border-slate-500"
              >
                Download parity evidence
              </button>
            ) : null}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Camera</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {applied
                  ? `Calibrated · ${applied.camera.verticalFovDeg.toFixed(1)}° FOV · applied and frozen`
                    + " · Original identity restored"
                  : "No calibrated camera."}
              </p>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Room Boundaries</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Not implemented in V2-S2.
              </p>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Supports</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Not implemented in V2-S2.
              </p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
