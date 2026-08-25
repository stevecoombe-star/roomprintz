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
  setFullyTiledRepresentation,
  setOriginalRepresentation,
} from "./representation-state";
import CalibratedRoomViewer from "./CalibratedRoomViewer";
import RoomEvidenceOverlay from "./RoomEvidenceOverlay";
import type { RoomObservationContract } from "./room-observation-contract";

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
  fullyTiled: {
    imageUrl: string;
    identity: {
      sha256: string;
      decodedWidth: number;
      decodedHeight: number;
    };
    provenance: {
      generationId: string;
      generatedFrom: "ORIGINAL";
      promptVersion: string;
    };
  } | null;
  roomObservation: RoomObservationContract | null;
  emptyIdentity: {
    decodedWidth: number;
    decodedHeight: number;
  } | null;
  freezeReceipt: unknown;
  analysisEvidence: unknown;
};

function isPreparedOriginal(
  value: unknown,
): value is { ok: true; basis: OriginalBasis } {
  return !!value && typeof value === "object" &&
    (value as { ok?: unknown }).ok === true &&
    !!(value as { basis?: unknown }).basis;
}

function isFloorAppliedAfcResult(value: unknown): value is {
  status: "applied" | "partial";
  reason?: string;
  floor: AppliedAfcResult["floor"];
  camera: AppliedAfcResult["camera"];
  fullyTiled: AppliedAfcResult["fullyTiled"];
  roomObservation: AppliedAfcResult["roomObservation"];
  product?: {
    emptyBasis?: {
      decodedWidth: number;
      decodedHeight: number;
    };
  };
  freezeReceipt: unknown;
} {
  return !!value && typeof value === "object" &&
    ((value as { status?: unknown }).status === "applied" ||
      (value as { status?: unknown }).status === "partial") &&
    !!(value as { floor?: unknown }).floor &&
    !!(value as { camera?: unknown }).camera;
}

function pipelineRepresentations(value: unknown): {
  emptyImageUrl: string | null;
  fullyTiled: AppliedAfcResult["fullyTiled"];
} {
  if (!value || typeof value !== "object") {
    return { emptyImageUrl: null, fullyTiled: null };
  }
  const candidate = value as {
    emptyImageUrl?: unknown;
    fullyTiled?: unknown;
  };
  const fullyTiled = candidate.fullyTiled &&
      typeof candidate.fullyTiled === "object" &&
      typeof (candidate.fullyTiled as { imageUrl?: unknown }).imageUrl ===
        "string"
    ? candidate.fullyTiled as AppliedAfcResult["fullyTiled"]
    : null;
  return {
    emptyImageUrl: typeof candidate.emptyImageUrl === "string"
      ? candidate.emptyImageUrl
      : null,
    fullyTiled,
  };
}

export function containedDisplayFrame(
  container: Readonly<{ width: number; height: number }>,
  source: Readonly<{ width: number; height: number }> | null,
): { width: number; height: number } {
  if (
    !source ||
    container.width <= 0 ||
    container.height <= 0 ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    return container;
  }
  const scale = Math.min(
    container.width / source.width,
    container.height / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
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
  const originalDisplayFrame = containedDisplayFrame(
    viewerFrame,
    basis
      ? { width: basis.decodedWidth, height: basis.decodedHeight }
      : null,
  );
  const selectedImageSize = orchestration.selectedRepresentation ===
      "FULLY_TILED" && applied?.fullyTiled
    ? {
      width: applied.fullyTiled.identity.decodedWidth,
      height: applied.fullyTiled.identity.decodedHeight,
    }
    : orchestration.selectedRepresentation === "EMPTY" &&
        applied?.emptyIdentity
    ? {
      width: applied.emptyIdentity.decodedWidth,
      height: applied.emptyIdentity.decodedHeight,
    }
    : basis
    ? { width: basis.decodedWidth, height: basis.decodedHeight }
    : null;
  const displayFrame = containedDisplayFrame(
    viewerFrame,
    selectedImageSize,
  );

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
      originalDisplayFrame.width <= 0 ||
      originalDisplayFrame.height <= 0
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
          frame: originalDisplayFrame,
          referenceDepthM: 4,
        }),
      });
      const result: unknown = await response.json();
      if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
      const pipeline = pipelineRepresentations(result);
      setRepresentations((current) => {
        let next = current;
        if (pipeline.emptyImageUrl) {
          next = setEmptyRepresentation(next, pipeline.emptyImageUrl);
        }
        if (pipeline.fullyTiled) {
          next = setFullyTiledRepresentation(
            next,
            pipeline.fullyTiled.imageUrl,
          );
        }
        return next;
      });
      if (!response.ok || !isFloorAppliedAfcResult(result)) {
        const reason = result && typeof result === "object" &&
          typeof (result as { reason?: unknown }).reason === "string"
          ? (result as { reason: string }).reason
          : "Certified floor AFC could not be applied.";
        throw new Error(reason);
      }
      dispatch({ type: "analysis_stage", status: "reading_floor" });
      dispatch({ type: "analysis_stage", status: "calibrating_camera" });
      if (result.roomObservation) {
        dispatch({ type: "analysis_stage", status: "observing_room" });
      }
      setApplied({
        floor: result.floor,
        camera: result.camera,
        fullyTiled: result.fullyTiled,
        roomObservation: result.roomObservation,
        emptyIdentity: result.product?.emptyBasis ?? null,
        freezeReceipt: result.freezeReceipt,
        analysisEvidence: result,
      });
      if (result.status === "partial") {
        setError(result.reason ?? "Room-envelope observation did not complete.");
        dispatch({ type: "analysis_failed" });
      } else {
        dispatch({ type: "analysis_applied" });
      }
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "AFC analysis failed.");
      dispatch({ type: "analysis_failed" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function downloadAnalysisEvidence() {
    if (!applied) return;
    const blob = new Blob(
      [JSON.stringify(applied.analysisEvidence, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s3-room-observation-evidence.json";
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
                AFC V2 · S3
              </span>
              <span className="text-xs text-slate-500">
                FULLY TILED room-envelope observation
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              3D Room Lab v2
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Generate one FULLY TILED scaffold for the certified Floor read
              and visible room-envelope observation, while camera authority
              remains frozen upstream of this read-only viewer.
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
                <div
                  className="relative overflow-hidden bg-black"
                  style={{
                    width: displayFrame.width,
                    height: displayFrame.height,
                  }}
                >
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
                      alt={`${REPRESENTATION_LABELS[orchestration.selectedRepresentation]} room representation`}
                      fill
                      unoptimized
                      className="object-contain"
                    />
                  )}
                  {selectedRepresentation.source ? (
                    <div className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
                      Original · authority-qualified
                    </div>
                  ) : null}
                  {applied ? (
                    <RoomEvidenceOverlay
                      floorPolygon={applied.floor.sourceNormalizedPolygon}
                      roomObservation={applied.roomObservation}
                      showFloorAuthority={
                        orchestration.selectedRepresentation !== "ORIGINAL"
                      }
                      showRoomObservation={
                        orchestration.selectedRepresentation === "FULLY_TILED"
                      }
                    />
                  ) : null}
                </div>
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
                onClick={downloadAnalysisEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-cyan-200 transition hover:border-slate-500"
              >
                Download V2-S3 observation evidence
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
              <h2 className="text-sm font-semibold text-slate-200">
                Room Observations
              </h2>
              {applied?.roomObservation ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                  <p>
                    {applied.roomObservation.observedPlanes.length} planes ·{" "}
                    {applied.roomObservation.observedGridFamilies.length} grid
                    families
                  </p>
                  <p>
                    {applied.roomObservation.observedSeams.length} seams ·{" "}
                    {applied.roomObservation.observedOpenings.length} openings ·{" "}
                    {applied.roomObservation.adjacency.length} adjacencies
                  </p>
                  <p>
                    {Array.from(new Set(
                      applied.roomObservation.observedPlanes.map((plane) =>
                        plane.category
                      ),
                    )).join(", ") || "No confident plane categories"}
                  </p>
                  <p className="text-slate-600">
                    {applied.roomObservation.observationVersion}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  No FULLY TILED room observation contract.
                </p>
              )}
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Room Boundaries</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Final world geometry is deferred to V2-S4.
              </p>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Supports</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Not implemented.
              </p>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
