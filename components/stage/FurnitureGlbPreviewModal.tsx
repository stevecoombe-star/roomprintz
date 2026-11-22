"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";

import { CandidateCalibrationForm } from "@/components/stage/CandidateCalibrationForm";
import { LibraryDimensionEditor } from "@/components/stage/LibraryDimensionEditor";
import type { CalibrationAxis } from "@/lib/vibode-furniture/generation/calibrate";
import {
  blurDimensionDraft,
  dimensionDraftCanSave,
  dimensionDraftSizingMode,
  dimensionPreviewScale,
  editDimensionDraft,
  setDimensionDraftLocked,
  setDimensionDraftUnit,
  startDimensionDraft,
  type DimensionDraft,
} from "@/lib/vibode-furniture/dimension-edit";
import { savePersonalFurnitureDimensions } from "@/lib/vibode-furniture/dimension-client";
import { saveCalibratedCandidate } from "@/lib/vibode-furniture/generator/calibrated-save-client";
import {
  buildCalibrationPreview,
  calibrationFailureLocks,
  claimCalibrationSubmit,
  formatGeneratedCentimetres,
  nextCalibrationPhase,
  type CalibrationSavePhase,
} from "@/lib/vibode-furniture/generator/calibration-ui";
import {
  clampPreviewOrbit,
  disposePreviewObject,
  formatFurnitureDimensions,
  formatGeneratedDimensions,
  initialPreviewCamera,
  nudgePreviewOrbit,
  orbitPreviewFromPointer,
  orbitPreviewPosition,
  previewCopy,
  previewFar,
  previewKeyboardAction,
  previewLoadPlan,
  previewNear,
  previewOrbitLimits,
  previewSaveState,
  readPreviewGlb,
  scaledPreviewPosition,
  type GlbPreviewRequest,
  type GroundedFurnitureBounds,
  type PreviewModalState,
} from "@/lib/vibode-furniture/generator/preview";
import type { ModelAxisScale } from "@/lib/afc-v2-runtime/model-axis-scale";
import type { ModelDimensions } from "@/lib/vibode-stage/model-dimensions";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const BUTTON = `rounded-md border px-2.5 py-1.5 text-xs ${FOCUS}`;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), canvas[tabindex]';

export function FurnitureGlbPreviewModal({
  state,
  onClose,
  onCandidateSaved,
  onCandidateLibraryChanged,
  onDimensionsSaved,
}: {
  state: PreviewModalState;
  onClose: () => void;
  onCandidateSaved?: (saved: Readonly<{
    assetId: string;
    displayName: string;
    idempotent: boolean;
  }>) => void;
  onCandidateLibraryChanged?: () => void;
  onDimensionsSaved?: (saved: Readonly<{ assetId: string; dimensions: ModelDimensions }>) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const sessionRef = useRef<PreviewSession | null>(null);
  const [trackedSession, setTrackedSession] = useState(state.session);
  const [phase, setPhase] = useState<PreviewPhase>({ status: "loading" });
  const [bounds, setBounds] = useState<GroundedFurnitureBounds | null>(null);
  onCloseRef.current = onClose;

  if (state.session !== trackedSession) {
    setTrackedSession(state.session);
    setPhase(state.open ? { status: "loading" } : { status: "loading" });
    setBounds(null);
  }

  useEffect(() => {
    if (!state.open) return undefined;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const items = dialog ? [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
      const nudged = event.target === canvasRef.current
        ? (sessionRef.current?.nudge(event.key) ?? false)
        : false;
      const action = previewKeyboardAction({
        key: event.key,
        shiftKey: event.shiftKey,
        nudged,
        focusIndex: items.indexOf(document.activeElement as HTMLElement),
        focusCount: items.length,
      });
      event.stopPropagation();
      if (action.preventDefault) event.preventDefault();
      if (action.close) onCloseRef.current();
      if (action.nextFocusIndex != null) items[action.nextFocusIndex]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus();
    };
  }, [state.open, state.session]);

  const activeRequest = state.open ? state.request : null;
  useEffect(() => {
    if (!activeRequest) return undefined;
    const canvas = canvasRef.current;
    const plan = previewLoadPlan(activeRequest);
    if (!canvas || plan.action === "refuse") {
      sessionRef.current = null;
      if (plan.action === "refuse") setPhase({ status: "error", message: plan.message });
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    let session: PreviewSession | null = null;
    setPhase({ status: "loading" });
    setBounds(null);
    void (async () => {
      try {
        const response = await fetch(plan.url, { signal: controller.signal });
        if (!response.ok) throw new Error("load");
        const loaded = await readPreviewGlb(await response.arrayBuffer());
        if (cancelled) {
          if (loaded.ok) disposePreviewObject(loaded.scene);
          return;
        }
        if (!loaded.ok) {
          setPhase({ status: "error", message: loaded.message });
          return;
        }
        try {
          session = mountFurniturePreview({
            canvas,
            model: loaded.scene,
            bounds: loaded.bounds,
          });
        } catch {
          disposePreviewObject(loaded.scene);
          throw new Error("preview");
        }
        if (cancelled) {
          session.dispose();
          return;
        }
        sessionRef.current = session;
        setBounds(loaded.bounds);
        setPhase({ status: "ready" });
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setPhase({
          status: "error",
          message: activeRequest.kind === "candidate"
            ? "The private preview link could not be loaded. Open preview again."
            : "The model could not be loaded.",
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      session?.dispose();
      sessionRef.current = null;
    };
  }, [activeRequest]);

  if (!state.open || typeof document === "undefined") return null;
  return createPortal(
    <FurnitureGlbPreviewDialog
      session={state.session}
      request={state.request}
      titleId={titleId}
      phase={phase}
      bounds={bounds}
      dialogRef={dialogRef}
      canvasRef={canvasRef}
      closeRef={closeRef}
      onClose={onClose}
      onReset={() => sessionRef.current?.reset()}
      onBackdrop={() => onClose()}
      onCandidateSaved={onCandidateSaved}
      onCandidateLibraryChanged={onCandidateLibraryChanged}
      onDimensionsSaved={onDimensionsSaved}
      onPreviewScale={(scale) => sessionRef.current?.setScale(scale)}
    />,
    document.body,
  );
}

export function FurnitureGlbPreviewDialog({
  session = 0,
  request,
  titleId,
  phase,
  bounds,
  dialogRef,
  canvasRef,
  closeRef,
  onClose,
  onReset,
  onBackdrop,
  onCandidateSaved,
  onCandidateLibraryChanged,
  onDimensionsSaved,
  onPreviewScale,
}: {
  session?: number;
  request: GlbPreviewRequest;
  titleId: string;
  phase: PreviewPhase;
  bounds: GroundedFurnitureBounds | null;
  dialogRef?: Ref<HTMLDivElement>;
  canvasRef?: Ref<HTMLCanvasElement>;
  closeRef?: Ref<HTMLButtonElement>;
  onClose: () => void;
  onReset: () => void;
  onBackdrop?: () => void;
  onCandidateSaved?: (saved: Readonly<{
    assetId: string;
    displayName: string;
    idempotent: boolean;
  }>) => void;
  onCandidateLibraryChanged?: () => void;
  onDimensionsSaved?: (saved: Readonly<{ assetId: string; dimensions: ModelDimensions }>) => void;
  onPreviewScale?: (scale: ModelAxisScale | null) => void;
}) {
  const copy = previewCopy(request);
  const save = previewSaveState(request);
  const ready = phase.status === "ready";
  const [seenSession, setSeenSession] = useState(session);
  const [axis, setAxis] = useState<CalibrationAxis>("height");
  const [targetText, setTargetText] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");
  const [savePhase, setSavePhase] = useState<CalibrationSavePhase>("edit");
  const [notice, setNotice] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const libraryDimensions = request.kind === "library" ? request.dimensions ?? null : null;
  const [dimensionEditing, setDimensionEditing] = useState(false);
  const [dimensionDraft, setDimensionDraft] = useState<DimensionDraft | null>(null);
  const [savedDimensions, setSavedDimensions] = useState<ModelDimensions | null>(libraryDimensions);
  const [dimensionNotice, setDimensionNotice] = useState<string | null>(null);
  const [dimensionSaving, setDimensionSaving] = useState(false);
  const submitGate = useRef({ pending: false });
  const onPreviewScaleRef = useRef(onPreviewScale);
  onPreviewScaleRef.current = onPreviewScale;
  if (session !== seenSession) {
    setSeenSession(session);
    setAxis("height");
    setTargetText("");
    setDisplayName("");
    setCategory("");
    setSavePhase("edit");
    setNotice(null);
    setLocked(false);
    setDimensionEditing(false);
    setDimensionDraft(null);
    setSavedDimensions(libraryDimensions);
    setDimensionNotice(null);
    setDimensionSaving(false);
    submitGate.current.pending = false;
  }
  useEffect(() => {
    const target = dimensionEditing && dimensionDraft ? dimensionDraft.current : savedDimensions;
    if (!bounds || !target) {
      onPreviewScaleRef.current?.(null);
      return;
    }
    onPreviewScaleRef.current?.(dimensionPreviewScale({
      widthM: bounds.widthM,
      heightM: bounds.heightM,
      depthM: bounds.depthM,
    }, target));
  }, [bounds, dimensionDraft, dimensionEditing, savedDimensions]);
  const calibration = request.kind === "candidate"
    ? buildCalibrationPreview({
      measured: bounds,
      axis,
      targetText,
      displayName,
      category,
    })
    : null;
  const saveEnabled = savePhase === "confirm" && calibration?.ready === true && !locked;
  const shownDimensions = dimensionEditing && dimensionDraft ? dimensionDraft.current : savedDimensions;
  const commitDimensions = () => {
    if (request.kind !== "library" || !dimensionDraft || dimensionSaving) return;
    if (!dimensionDraftCanSave(dimensionDraft)) return;
    const assetId = request.assetId;
    const widthM = dimensionDraft.current.widthM;
    const heightM = dimensionDraft.current.heightM;
    const depthM = dimensionDraft.current.depthM;
    const sizingMode = dimensionDraftSizingMode(dimensionDraft);
    setDimensionSaving(true);
    setDimensionNotice(null);
    void (async () => {
      try {
        const token = await readOwnerAccessToken();
        if (!token) {
          setDimensionNotice("Sign in again to save these dimensions.");
          return;
        }
        const result = await savePersonalFurnitureDimensions({
          assetId,
          token,
          widthM,
          heightM,
          depthM,
          sizingMode,
        });
        if (!result.ok) {
          setDimensionNotice(result.message);
          return;
        }
        setSavedDimensions(result.dimensions);
        setDimensionDraft(null);
        setDimensionEditing(false);
        onDimensionsSaved?.({ assetId, dimensions: result.dimensions });
      } catch {
        setDimensionNotice("The model dimensions could not be saved. Check the connection and try again.");
      } finally {
        setDimensionSaving(false);
      }
    })();
  };
  const editCalibration = (apply: () => void) => {
    if (submitGate.current.pending || locked) return;
    apply();
    setSavePhase((current) => nextCalibrationPhase(current, "edit", false));
    setNotice(null);
  };
  const commitSave = () => {
    if (!calibration?.ready || calibration.targetM == null || calibration.displayName == null) return;
    if (request.kind !== "candidate" || locked) return;
    if (nextCalibrationPhase(savePhase, "commit", true) !== "saving") return;
    if (!claimCalibrationSubmit(submitGate.current)) return;
    const targetM = calibration.targetM;
    const savedName = calibration.displayName;
    const savedCategory = calibration.category;
    const savedAxis = calibration.axis;
    const jobId = request.jobId;
    setSavePhase("saving");
    setNotice(null);
    void (async () => {
      try {
        const token = await readOwnerAccessToken();
        if (!token) {
          setNotice("Sign in again to save this model.");
          setSavePhase("edit");
          return;
        }
        const result = await saveCalibratedCandidate({
          jobId,
          token,
          displayName: savedName,
          category: savedCategory,
          axis: savedAxis,
          targetM,
        });
        if (!result.ok) {
          setNotice(result.message);
          setLocked(calibrationFailureLocks(result.errorCode));
          setSavePhase("edit");
          if (result.errorCode === "ALREADY_SAVED") onCandidateLibraryChanged?.();
          return;
        }
        setLocked(true);
        setSavePhase("edit");
        setNotice(result.idempotent
          ? `${result.displayName} is already in My Furniture.`
          : `${result.displayName} was saved to My Furniture.`);
        onCandidateSaved?.({
          assetId: result.assetId,
          displayName: result.displayName,
          idempotent: result.idempotent,
        });
      } catch {
        setNotice("The model could not be saved. Check the connection and try again.");
        setSavePhase("edit");
      } finally {
        submitGate.current.pending = false;
      }
    })();
  };
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/75 p-3 sm:p-6"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onBackdrop?.();
      }}
      onWheel={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-preview-scroll]")) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={phase.status === "loading"}
        data-preview-kind={request.kind}
        data-preview-phase={phase.status}
        data-save-enabled={saveEnabled ? "true" : "false"}
        className="flex h-[min(820px,calc(100vh-1.5rem))] w-[min(1080px,calc(100vw-1.5rem))] max-w-full flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-xl"
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-medium text-neutral-100">{copy.title}</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-400">{copy.detail}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!ready}
              onClick={onReset}
              className={`${BUTTON} border-neutral-700 text-neutral-200 disabled:cursor-not-allowed disabled:text-neutral-600`}
            >
              Reset camera
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className={`${BUTTON} border-neutral-500 bg-neutral-800 text-neutral-100`}
            >
              Close
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-neutral-900">
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label={`${copy.title} 3D preview`}
            className="h-full w-full touch-none outline-none"
          />
          {phase.status === "loading" ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
              Loading model…
            </div>
          ) : null}
          {phase.status === "error" ? (
            <div role="alert" className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-amber-200">
              {phase.message}
            </div>
          ) : null}
        </div>
        <div data-preview-scroll className="max-h-[46%] shrink-0 overflow-y-auto border-t border-neutral-800 px-4 py-3">
          <p className="text-xs text-neutral-200" data-preview-dimensions={bounds || shownDimensions ? "ready" : "pending"}>
            {shownDimensions
              ? formatFurnitureDimensions(shownDimensions)
              : bounds
                ? (request.kind === "candidate" ? formatGeneratedDimensions(bounds) : formatFurnitureDimensions(bounds))
                : "Dimensions appear after the model loads."}
          </p>
          {request.kind === "library" && savedDimensions && ready && !dimensionEditing ? (
            <button
              type="button"
              onClick={() => {
                const next = startDimensionDraft(savedDimensions);
                if (!next) return;
                setDimensionNotice(null);
                setDimensionDraft(next);
                setDimensionEditing(true);
              }}
              className={`${BUTTON} mt-3 border-neutral-500 bg-neutral-800 text-neutral-100`}
            >
              Edit dimensions
            </button>
          ) : null}
          {dimensionEditing && dimensionDraft ? (
            <LibraryDimensionEditor
              draft={dimensionDraft}
              saving={dimensionSaving}
              notice={dimensionNotice}
              onEdit={(axisName, value) => {
                setDimensionDraft((current) => current ? editDimensionDraft(current, axisName, value) : current);
              }}
              onUnit={(unit) => {
                setDimensionDraft((current) => current ? setDimensionDraftUnit(current, unit) : current);
              }}
              onLocked={(nextLocked) => {
                setDimensionDraft((current) => current ? setDimensionDraftLocked(current, nextLocked) : current);
              }}
              onBlur={() => {
                setDimensionDraft((current) => current ? blurDimensionDraft(current) : current);
              }}
              onSave={commitDimensions}
              onCancel={() => {
                if (dimensionSaving) return;
                setDimensionEditing(false);
                setDimensionDraft(null);
                setDimensionNotice(null);
              }}
            />
          ) : null}
          <p className="mt-1 text-[11px] leading-5 text-neutral-500">
            Drag to orbit. Scroll to zoom. Arrow keys orbit when the view is focused.
          </p>
          {save.available && calibration ? (
            <div className="mt-3">
              <CandidateCalibrationForm
                generatedCentimetres={bounds ? formatGeneratedCentimetres(bounds) : "Waiting for the model"}
                axis={calibration.axis}
                targetText={targetText}
                displayName={displayName}
                category={category}
                targetLabel={calibration.targetLabel}
                resultLabel={calibration.resultLabel}
                issue={calibration.measurementIssue ?? calibration.detailIssue}
                phase={savePhase}
                notice={notice}
                canReview={calibration.ready && ready}
                locked={locked}
                onAxis={(next) => editCalibration(() => setAxis(next))}
                onTarget={(value) => editCalibration(() => setTargetText(value))}
                onDisplayName={(value) => editCalibration(() => setDisplayName(value))}
                onCategory={(value) => editCalibration(() => setCategory(value))}
                onReview={() => {
                  if (!calibration.ready || locked) return;
                  setSavePhase((current) => nextCalibrationPhase(current, "review", true));
                }}
                onBack={() => setSavePhase((current) => nextCalibrationPhase(current, "back", false))}
                onCommit={commitSave}
              />
            </div>
          ) : null}
          {save.shown && !save.available ? (
            <p className="mt-2 text-[11px] text-neutral-500">{save.reason}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

async function readOwnerAccessToken(): Promise<string | null> {
  const browser = await import("@/lib/supabaseBrowser");
  return browser.getSupabaseBrowserAccessToken();
}

type PreviewPhase =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "error"; message: string }>;

type PreviewSession = Readonly<{
  reset: () => void;
  nudge: (key: string) => boolean;
  setScale: (scale: ModelAxisScale | null) => void;
  dispose: () => void;
}>;

function mountFurniturePreview(input: {
  canvas: HTMLCanvasElement;
  model: THREE.Object3D;
  bounds: GroundedFurnitureBounds;
}): PreviewSession {
  const width = Math.max(input.canvas.clientWidth, 1);
  const height = Math.max(input.canvas.clientHeight, 1);
  const renderer = new THREE.WebGLRenderer({
    canvas: input.canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x171717, 1);

  const scene = new THREE.Scene();
  input.model.position.y += 0.001;
  scene.add(input.model);
  const gridSize = Math.max(2, input.bounds.widthM * 4, input.bounds.depthM * 4);
  const grid = new THREE.GridHelper(gridSize, 8, 0x404040, 0x2a2a2a);
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.95));
  const light = new THREE.DirectionalLight(0xffffff, 1.35);
  scene.add(light);

  const limits = previewOrbitLimits(input.bounds);
  const initial = initialPreviewCamera(input.bounds, width / height);
  const orbit = {
    theta: initial.theta,
    phi: initial.phi,
    distance: initial.distance,
  };
  const home = { ...orbit };
  const camera = new THREE.PerspectiveCamera(35, width / height, initial.near, initial.far);
  let scaleSpan = 1;
  const groundedPosition = input.model.position.clone();
  const apply = () => {
    const position = orbitPreviewPosition(initial.target, orbit);
    camera.position.set(position.x, position.y, position.z);
    camera.near = previewNear(orbit.distance);
    camera.far = previewFar(orbit.distance) * scaleSpan;
    camera.lookAt(initial.target.x, initial.target.y, initial.target.z);
    camera.updateProjectionMatrix();
    light.position.set(position.x, position.y + orbit.distance * 0.2, position.z);
  };
  apply();

  let userMoved = false;
  const resize = () => {
    const nextWidth = input.canvas.clientWidth;
    const nextHeight = input.canvas.clientHeight;
    if (nextWidth < 2 || nextHeight < 2) return;
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    if (!userMoved) {
      const framed = initialPreviewCamera(input.bounds, nextWidth / nextHeight);
      orbit.theta = framed.theta;
      orbit.phi = framed.phi;
      orbit.distance = framed.distance;
      home.theta = framed.theta;
      home.phi = framed.phi;
      home.distance = framed.distance;
    }
    apply();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(input.canvas);

  let frame = 0;
  const render = () => {
    frame = window.requestAnimationFrame(render);
    renderer.render(scene, camera);
  };
  render();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    input.canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    if (event.clientX !== lastX || event.clientY !== lastY) userMoved = true;
    const next = orbitPreviewFromPointer(orbit, {
      x: event.clientX - lastX,
      y: event.clientY - lastY,
    }, limits);
    lastX = event.clientX;
    lastY = event.clientY;
    orbit.theta = next.theta;
    orbit.phi = next.phi;
    orbit.distance = next.distance;
    apply();
  };
  const endDrag = () => {
    dragging = false;
  };
  const onWheel = (event: WheelEvent) => {
    userMoved = true;
    event.preventDefault();
    event.stopPropagation();
    const next = clampPreviewOrbit({
      ...orbit,
      distance: orbit.distance * Math.exp(event.deltaY * 0.0012),
    }, limits);
    orbit.distance = next.distance;
    apply();
  };
  input.canvas.addEventListener("pointerdown", onPointerDown);
  input.canvas.addEventListener("pointermove", onPointerMove);
  input.canvas.addEventListener("pointerup", endDrag);
  input.canvas.addEventListener("pointercancel", endDrag);
  input.canvas.addEventListener("wheel", onWheel, { passive: false });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    input.canvas.removeEventListener("pointerdown", onPointerDown);
    input.canvas.removeEventListener("pointermove", onPointerMove);
    input.canvas.removeEventListener("pointerup", endDrag);
    input.canvas.removeEventListener("pointercancel", endDrag);
    input.canvas.removeEventListener("wheel", onWheel);
    disposePreviewObject(scene);
    renderer.dispose();
    renderer.forceContextLoss();
  };

  return {
    reset: () => {
      userMoved = false;
      orbit.theta = home.theta;
      orbit.phi = home.phi;
      orbit.distance = home.distance;
      apply();
    },
    setScale: (scale) => {
      const next = scale && [scale.x, scale.y, scale.z].every((value) => Number.isFinite(value) && value > 0)
        ? scale
        : { x: 1, y: 1, z: 1 };
      scaleSpan = Math.max(next.x, next.y, next.z, 1);
      input.model.scale.set(next.x, next.y, next.z);
      const position = scaledPreviewPosition(groundedPosition, next);
      input.model.position.set(position.x, position.y, position.z);
      apply();
    },
    nudge: (key: string) => {
      const next = nudgePreviewOrbit(orbit, key, limits);
      if (next) userMoved = true;
      if (!next) return false;
      orbit.theta = next.theta;
      orbit.phi = next.phi;
      orbit.distance = next.distance;
      apply();
      return true;
    },
    dispose,
  };
}
