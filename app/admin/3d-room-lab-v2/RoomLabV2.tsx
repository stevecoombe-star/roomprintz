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
  setTiledRepresentation,
} from "./representation-state";
import CalibratedRoomViewer from "./CalibratedRoomViewer";
import RoomEvidenceOverlay from "./RoomEvidenceOverlay";
import type {
  EmptyRoomObservationEvidence,
} from "./empty-room-observation-contract";
import {
  DEFAULT_SHOW_FLOOR_QUAD,
  SCENE_TRANSFORM_LIMITS,
  addGlbModel,
  addTestCube,
  createInitialSceneLayerState,
  getSelectedSceneObject,
  sceneObjectBlobUrls,
  selectSceneObject,
  setSceneObjectLoadStatus,
  setViewportTransformMode,
  applyObjectWorldTransform,
  blobUrlOwnedSolelyByObject,
  deleteSceneObject,
  resetSceneObjectTransform,
  updateSelectedPositionAxis,
  updateSelectedRotationAxis,
  updateSelectedUniformScale,
  type SceneLayerState,
  type SceneObjectLoadStatus,
} from "./scene-layer-state";

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
  tiled: {
    imageUrl: string;
    identity: {
      sha256: string;
      decodedWidth: number;
      decodedHeight: number;
    };
    provenance: {
      generatedFrom: "EMPTY";
      parentEmptySha256: string;
      originalAncestorSha256: string;
      lineageEvidenceDigest: string | null;
      generatorId: string;
      profileId: string;
      researchPreset: string;
    };
  } | null;
  empty: {
    imageUrl: string;
    identity: {
      sha256: string;
      decodedWidth: number;
      decodedHeight: number;
    };
    provenance: {
      generatedFrom: "ORIGINAL";
      parentOriginalSha256: string;
    };
  } | null;
  freezeReceipt: unknown;
};

type PipelineEvidenceState = {
  empty: AppliedAfcResult["empty"];
  tiled: AppliedAfcResult["tiled"];
  roomObservation: EmptyRoomObservationEvidence | null;
  roomObservationStatus:
    | "observed"
    | "partial"
    | "failed"
    | "not_run_empty_unavailable";
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
  tiled: AppliedAfcResult["tiled"];
  empty: AppliedAfcResult["empty"];
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

function pipelineEvidence(value: unknown): PipelineEvidenceState {
  if (!value || typeof value !== "object") {
    return {
      empty: null,
      tiled: null,
      roomObservation: null,
      roomObservationStatus: "not_run_empty_unavailable",
      analysisEvidence: value,
    };
  }
  const candidate = value as {
    empty?: unknown;
    tiled?: unknown;
    roomObservation?: unknown;
    roomObservationStatus?: unknown;
  };
  const empty = candidate.empty &&
      typeof candidate.empty === "object" &&
      typeof (candidate.empty as { imageUrl?: unknown }).imageUrl ===
        "string"
    ? candidate.empty as AppliedAfcResult["empty"]
    : null;
  const tiled = candidate.tiled &&
      typeof candidate.tiled === "object" &&
      typeof (candidate.tiled as { imageUrl?: unknown }).imageUrl === "string"
    ? candidate.tiled as AppliedAfcResult["tiled"]
    : null;
  const roomObservation = candidate.roomObservation &&
      typeof candidate.roomObservation === "object" &&
      ((candidate.roomObservation as { observerStatus?: unknown })
          .observerStatus === "observed" ||
        (candidate.roomObservation as { observerStatus?: unknown })
            .observerStatus === "partial" ||
        (candidate.roomObservation as { observerStatus?: unknown })
            .observerStatus === "failed")
    ? candidate.roomObservation as EmptyRoomObservationEvidence
    : null;
  const roomObservationStatus =
    candidate.roomObservationStatus === "observed" ||
      candidate.roomObservationStatus === "partial" ||
      candidate.roomObservationStatus === "failed"
      ? candidate.roomObservationStatus
      : "not_run_empty_unavailable";
  return {
    empty,
    tiled,
    roomObservation,
    roomObservationStatus,
    analysisEvidence: value,
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

export function formatSelectedModelHeading(label: string | null): string {
  return `Selected Model — ${label ?? "None"}`;
}

function TransformControlRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onValue: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = Number.parseFloat(event.target.value);
            if (!Number.isFinite(next)) return;
            onValue(next);
          }}
          className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right text-[11px] text-slate-100 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:text-slate-600"
        />
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onValue(Number.parseFloat(event.target.value))}
        className="mt-1 w-full accent-cyan-400 disabled:cursor-not-allowed"
      />
    </label>
  );
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
  const [pipeline, setPipeline] = useState<PipelineEvidenceState | null>(null);
  const [showRoomObservationOverlay, setShowRoomObservationOverlay] =
    useState(true);
  const [showFloorQuad, setShowFloorQuad] = useState(DEFAULT_SHOW_FLOOR_QUAD);
  const [sceneLayer, setSceneLayer] = useState(createInitialSceneLayerState);
  const [selectedModelExpanded, setSelectedModelExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerFrame, setViewerFrame] = useState({ width: 0, height: 0 });
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  const sceneLayerRef = useRef(sceneLayer);
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
      "TILED" && pipeline?.tiled
    ? {
      width: pipeline.tiled.identity.decodedWidth,
      height: pipeline.tiled.identity.decodedHeight,
    }
    : orchestration.selectedRepresentation === "EMPTY" &&
        pipeline?.empty
    ? {
      width: pipeline.empty.identity.decodedWidth,
      height: pipeline.empty.identity.decodedHeight,
    }
    : basis
    ? { width: basis.decodedWidth, height: basis.decodedHeight }
    : null;
  const displayFrame = containedDisplayFrame(
    viewerFrame,
    selectedImageSize,
  );
  const selectedSceneObject = getSelectedSceneObject(sceneLayer);
  const sceneControlsEnabled = Boolean(applied);

  function resetSceneLayer(next: SceneLayerState = createInitialSceneLayerState()) {
    for (const url of sceneObjectBlobUrls(sceneLayerRef.current)) {
      URL.revokeObjectURL(url);
    }
    sceneLayerRef.current = next;
    setSceneLayer(next);
  }

  function reportObjectLoadStatus(
    objectId: string,
    loadStatus: SceneObjectLoadStatus,
    loadError: string | null = null,
  ) {
    setSceneLayer((current) =>
      setSceneObjectLoadStatus(current, objectId, loadStatus, loadError)
    );
  }

  function reportSelection(objectId: string | null) {
    setSceneLayer((current) => selectSceneObject(current, objectId));
  }

  function reportObjectTransform(
    objectId: string,
    transform: SceneLayerState["objects"][number]["transform"],
  ) {
    setSceneLayer((current) =>
      applyObjectWorldTransform(current, objectId, transform)
    );
  }

  function handleResetSelectedTransform() {
    setSceneLayer((current) => resetSceneObjectTransform(current));
  }

  function handleDeleteSelectedObject() {
    const current = sceneLayerRef.current;
    const selected = getSelectedSceneObject(current);
    if (!selected) return;
    const urlToRevoke = blobUrlOwnedSolelyByObject(current, selected);
    const next = deleteSceneObject(current, selected.id);
    sceneLayerRef.current = next;
    setSceneLayer(next);
    if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
  }

  function handleGlbFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !sceneControlsEnabled) return;
    const objectUrl = URL.createObjectURL(file);
    setSceneLayer((current) =>
      addGlbModel(current, { objectUrl, fileName: file.name })
    );
    if (glbInputRef.current) glbInputRef.current.value = "";
  }

  useEffect(() => {
    sceneLayerRef.current = sceneLayer;
  }, [sceneLayer]);

  useEffect(() => {
    return () => {
      for (const url of sceneObjectBlobUrls(sceneLayerRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

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
    setPipeline(null);
    resetSceneLayer();
    setShowFloorQuad(DEFAULT_SHOW_FLOOR_QUAD);
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
    setPipeline(null);
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
      const receivedPipeline = pipelineEvidence(result);
      setPipeline(receivedPipeline);
      setRepresentations((current) => {
        let next = current;
        if (receivedPipeline.empty) {
          next = setEmptyRepresentation(next, receivedPipeline.empty.imageUrl);
        }
        if (receivedPipeline.tiled) {
          next = setTiledRepresentation(
            next,
            receivedPipeline.tiled.imageUrl,
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
      if (receivedPipeline.roomObservation) {
        dispatch({ type: "analysis_stage", status: "observing_room" });
      }
      setApplied({
        floor: result.floor,
        camera: result.camera,
        tiled: result.tiled,
        empty: result.empty,
        freezeReceipt: result.freezeReceipt,
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

  function downloadAnalysisEvidence() {
    if (!pipeline?.analysisEvidence) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.analysisEvidence, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s3c-floor-camera-evidence.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadRoomObservationEvidence() {
    if (!pipeline?.roomObservation) return;
    const blob = new Blob(
      [JSON.stringify(pipeline.roomObservation, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "afc-v2-s3d-empty-room-observation-evidence.json";
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
                AFC V2 · S3E
              </span>
              <span className="text-xs text-slate-500">
                Frozen Floor/Camera + object scene harness
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              3D Room Lab v2
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              EMPTY now supplies conservative visible-room observation
              evidence while its TILED child remains the sole Floor and Camera
              authority path. Scene objects render under that frozen camera
              and never write it.
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
          <div className="flex min-w-0 flex-col gap-3">
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
              <div className="flex items-center gap-3">
                {orchestration.selectedRepresentation === "EMPTY" &&
                    pipeline?.roomObservation &&
                    pipeline.roomObservation.observerStatus !== "failed" ? (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={showRoomObservationOverlay}
                      onChange={(event) =>
                        setShowRoomObservationOverlay(event.target.checked)}
                      className="accent-cyan-400"
                    />
                    Observation overlay
                  </label>
                ) : null}
                <span className="text-xs text-slate-500">
                  {REPRESENTATION_DESCRIPTIONS[
                    orchestration.selectedRepresentation
                  ]}
                </span>
              </div>
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
                      showFloorQuad={showFloorQuad}
                      sceneObjects={sceneLayer.objects}
                      selectedObjectId={sceneLayer.selectedObjectId}
                      transformMode={sceneLayer.transformMode}
                      reportObjectLoadStatus={reportObjectLoadStatus}
                      reportSelection={reportSelection}
                      reportObjectTransform={reportObjectTransform}
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
                  {applied || pipeline?.roomObservation ? (
                    <RoomEvidenceOverlay
                      floorPolygon={applied?.floor.sourceNormalizedPolygon ?? []}
                      roomObservation={pipeline?.roomObservation ?? null}
                      showFloorAuthority={
                        Boolean(applied) &&
                        orchestration.selectedRepresentation === "TILED" &&
                        showFloorQuad
                      }
                      showRoomObservation={
                        showRoomObservationOverlay &&
                        orchestration.selectedRepresentation === "EMPTY"
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

          <section className="shrink-0 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <h2 className="text-sm font-semibold text-slate-200">
              Scene / Models
            </h2>
            <p className="mt-2 text-[11px] leading-4 text-slate-600">
              Object scene layer. Renders under the frozen camera. Does not
              write Floor, Camera, or EMPTY observation.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={!sceneControlsEnabled}
                onClick={() => setSceneLayer((current) => addTestCube(current))}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600 sm:min-w-[10rem] sm:flex-1"
              >
                Add Test Cube
              </button>
              <button
                type="button"
                disabled={!sceneControlsEnabled}
                onClick={() => glbInputRef.current?.click()}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600 sm:min-w-[10rem] sm:flex-1"
              >
                Load Model / GLB
              </button>
              <input
                ref={glbInputRef}
                type="file"
                accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                className="hidden"
                aria-label="Load Model / GLB"
                onChange={(event) => handleGlbFile(event.target.files)}
              />
            </div>
            {sceneLayer.objects.length > 0 ? (
              <ul className="mt-3 space-y-1">
                {sceneLayer.objects.map((object) => (
                  <li key={object.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSceneLayer((current) =>
                          selectSceneObject(current, object.id)
                        )}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-[11px] ${
                        sceneLayer.selectedObjectId === object.id
                          ? "bg-slate-700 text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {object.label}
                      {object.kind === "glb"
                        ? ` · ${object.loadStatus}`
                        : ""}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1">
              {(["move", "rotate", "scale"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!sceneControlsEnabled}
                  aria-pressed={sceneLayer.transformMode === mode}
                  onClick={() =>
                    setSceneLayer((current) =>
                      setViewportTransformMode(current, mode)
                    )
                  }
                  className={`min-w-[4.5rem] flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize ${
                    sceneLayer.transformMode === mode
                      ? "bg-cyan-400 text-slate-950"
                      : "border border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  } disabled:cursor-not-allowed disabled:text-slate-600`}
                >
                  {mode === "move" ? "Move" : mode === "rotate" ? "Rotate" : "Scale"}
                </button>
              ))}
            </div>
            {selectedSceneObject ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!sceneControlsEnabled}
                  onClick={handleResetSelectedTransform}
                  className="min-w-[9rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  Reset Transform
                </button>
                <button
                  type="button"
                  disabled={!sceneControlsEnabled}
                  onClick={handleDeleteSelectedObject}
                  className="min-w-[9rem] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  Delete Object
                </button>
              </div>
            ) : null}
          </section>
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
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showFloorQuad}
                  disabled={!applied}
                  onChange={(event) => setShowFloorQuad(event.target.checked)}
                  className="accent-cyan-400"
                  aria-label="Show Floor Quad"
                />
                Show Floor Quad
              </label>
              <p className="mt-1 text-[11px] leading-4 text-slate-600">
                Diagnostic visibility only. Authority, Apply, freeze, and
                restore are unchanged.
              </p>
            </section>
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Lineage</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {pipeline?.empty && pipeline.tiled
                  ? `Original ${pipeline.empty.provenance.parentOriginalSha256.slice(0, 10)}… → EMPTY ${pipeline.empty.identity.sha256.slice(0, 10)}… → TILED ${pipeline.tiled.identity.sha256.slice(0, 10)}…`
                  : pipeline?.empty
                  ? `Original ${pipeline.empty.provenance.parentOriginalSha256.slice(0, 10)}… → EMPTY ${pipeline.empty.identity.sha256.slice(0, 10)}…`
                  : "Awaiting Original → EMPTY → TILED evidence."}
              </p>
              {pipeline?.tiled ? (
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Full-raster certified tiled-perspective reader
                </p>
              ) : null}
            </section>
            {applied ? (
              <button
                type="button"
                onClick={downloadAnalysisEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-cyan-200 transition hover:border-slate-500"
              >
                Download V2-S3C Floor/Camera evidence
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
              {pipeline?.roomObservation ? (
                <div className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
                  <p className="font-medium text-slate-300">
                    Basis: EMPTY · Authority: observation only
                  </p>
                  <p>
                    Status: {pipeline.roomObservation.observerStatus}
                  </p>
                  <p>
                    {pipeline.roomObservation.observedPlanes.length} visible
                    planes ·{" "}
                    {pipeline.roomObservation.observedVisibleFloorRegions.length}{" "}
                    visible floor regions
                  </p>
                  <p>
                    {pipeline.roomObservation.observedSeams.length} seams ·{" "}
                    {pipeline.roomObservation.observedOpenings.length} openings ·{" "}
                    {pipeline.roomObservation.observedJunctions.length} junctions
                  </p>
                  <p className="text-slate-600">
                    {pipeline.roomObservation.schemaVersion}
                  </p>
                  {pipeline.roomObservation.qualityGate
                      .openingClosureAdjustments.length > 0 ? (
                    <p className="text-amber-300/70">
                      {
                        pipeline.roomObservation.qualityGate
                          .openingClosureAdjustments.length
                      }{" "}
                      opening closure claim(s) preserved as partial
                    </p>
                  ) : null}
                  {pipeline.roomObservation.failure ? (
                    <p className="text-amber-300/70">
                      {pipeline.roomObservation.failure.safeDetail}
                    </p>
                  ) : pipeline.roomObservation.qualityGate.unresolved[0] ? (
                    <p className="text-amber-300/70">
                      Unresolved:{" "}
                      {pipeline.roomObservation.qualityGate.unresolved[0]}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  No retained EMPTY observation basis was available.
                </p>
              )}
            </section>
            {pipeline?.roomObservation ? (
              <button
                type="button"
                onClick={downloadRoomObservationEvidence}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left text-xs font-medium text-orange-200 transition hover:border-slate-500"
              >
                Download V2-S3D EMPTY Room Observation evidence
              </button>
            ) : null}
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <button
                type="button"
                aria-expanded={selectedModelExpanded}
                aria-controls="v2-selected-model-details"
                onClick={() =>
                  setSelectedModelExpanded((open) => !open)
                }
                className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-800/60"
              >
                <h2 className="min-w-0 truncate text-sm font-semibold text-slate-200">
                  {formatSelectedModelHeading(
                    selectedSceneObject?.label ?? null,
                  )}
                </h2>
                <span className="shrink-0 text-xs text-slate-500" aria-hidden="true">
                  {selectedModelExpanded ? "▾" : "▸"}
                </span>
              </button>
              {selectedModelExpanded ? (
                <div
                  id="v2-selected-model-details"
                  className="mt-3"
                >
                  {selectedSceneObject ? (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-300">
                        {selectedSceneObject.kind === "test_cube"
                          ? "Test Cube"
                          : "GLB"}
                        {" · "}
                        {selectedSceneObject.label}
                      </p>
                      {selectedSceneObject.loadError ? (
                        <p className="text-[11px] text-amber-300/80">
                          {selectedSceneObject.loadError}
                        </p>
                      ) : null}
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Move
                        </p>
                        <div className="space-y-2">
                          <TransformControlRow
                            label="X"
                            value={selectedSceneObject.transform.position.x}
                            min={SCENE_TRANSFORM_LIMITS.positionX.min}
                            max={SCENE_TRANSFORM_LIMITS.positionX.max}
                            step={SCENE_TRANSFORM_LIMITS.positionX.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedPositionAxis(current, "x", value)
                              )}
                          />
                          <TransformControlRow
                            label="Y"
                            value={selectedSceneObject.transform.position.y}
                            min={SCENE_TRANSFORM_LIMITS.positionY.min}
                            max={SCENE_TRANSFORM_LIMITS.positionY.max}
                            step={SCENE_TRANSFORM_LIMITS.positionY.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedPositionAxis(current, "y", value)
                              )}
                          />
                          <TransformControlRow
                            label="Z"
                            value={selectedSceneObject.transform.position.z}
                            min={SCENE_TRANSFORM_LIMITS.positionZ.min}
                            max={SCENE_TRANSFORM_LIMITS.positionZ.max}
                            step={SCENE_TRANSFORM_LIMITS.positionZ.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedPositionAxis(current, "z", value)
                              )}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Rotate
                        </p>
                        <div className="space-y-2">
                          <TransformControlRow
                            label="X"
                            value={selectedSceneObject.transform.rotationDeg.x}
                            min={SCENE_TRANSFORM_LIMITS.rotationDeg.min}
                            max={SCENE_TRANSFORM_LIMITS.rotationDeg.max}
                            step={SCENE_TRANSFORM_LIMITS.rotationDeg.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedRotationAxis(current, "x", value)
                              )}
                          />
                          <TransformControlRow
                            label="Y"
                            value={selectedSceneObject.transform.rotationDeg.y}
                            min={SCENE_TRANSFORM_LIMITS.rotationDeg.min}
                            max={SCENE_TRANSFORM_LIMITS.rotationDeg.max}
                            step={SCENE_TRANSFORM_LIMITS.rotationDeg.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedRotationAxis(current, "y", value)
                              )}
                          />
                          <TransformControlRow
                            label="Z"
                            value={selectedSceneObject.transform.rotationDeg.z}
                            min={SCENE_TRANSFORM_LIMITS.rotationDeg.min}
                            max={SCENE_TRANSFORM_LIMITS.rotationDeg.max}
                            step={SCENE_TRANSFORM_LIMITS.rotationDeg.step}
                            disabled={!sceneControlsEnabled}
                            onValue={(value) =>
                              setSceneLayer((current) =>
                                updateSelectedRotationAxis(current, "z", value)
                              )}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Scale
                        </p>
                        <TransformControlRow
                          label="Uniform"
                          value={selectedSceneObject.transform.uniformScale}
                          min={SCENE_TRANSFORM_LIMITS.uniformScale.min}
                          max={SCENE_TRANSFORM_LIMITS.uniformScale.max}
                          step={SCENE_TRANSFORM_LIMITS.uniformScale.step}
                          disabled={!sceneControlsEnabled}
                          onValue={(value) =>
                            setSceneLayer((current) =>
                              updateSelectedUniformScale(current, value)
                            )}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-5 text-slate-500">
                      No selected model. Add a Test Cube or load a GLB after Apply.
                    </p>
                  )}
                </div>
              ) : null}
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
