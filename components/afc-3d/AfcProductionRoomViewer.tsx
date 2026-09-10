"use client";

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import { resolveSceneObjectCollision } from "@/lib/afc-v2-runtime/collision-resolver";
import { createPi3aCubeObjectFromAuthority } from "@/lib/afc-v2-runtime/cube-runtime";
import { containFitRect } from "@/lib/afc-v2-runtime/frame-layout";
import {
  applyRealizedFrozenCamera,
  buildProductionPerspectiveCamera,
} from "@/lib/afc-v2-runtime/frozen-camera";
import {
  canonicalizeObjectWorldTransform,
  realizeObjectWorldTransform,
} from "@/lib/afc-v2-runtime/metric-world-realization";
import {
  applyWorldTransform,
  attachImportedObject,
  createOneMetreCubeMesh,
  createSceneObjectRoot,
  disposeObject3D,
  measurePlacementLocalAabb,
} from "@/lib/afc-v2-runtime/object-runtime";
import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";
import { validateProductionRuntimeAuthority } from "@/lib/afc-v2-runtime/runtime-authority";
import type {
  RuntimeTransformMode,
  WorldTransform,
} from "@/lib/afc-v2-runtime/types";
import {
  applyPlacementWorldPosition,
  bodyDragGrabOffset,
  enforceNonNegativeWorldY,
  intersectRayWithHorizontalPlane,
  objectBodyDragWorldPosition,
  objectMatchesWorldTransform,
  pickSceneObjectId,
  pointerEventToNdc,
  resolveSceneObjectId,
  shouldActivateObjectBodyDrag,
  shouldBeginObjectBodyDrag,
  shouldSuppressSceneSelection,
  tagSceneObjectRoot,
  transformControlsAttachmentTarget,
  viewportModeToControlsMode,
  worldPositionXZ,
  worldTransformFromObject3D,
} from "@/lib/afc-v2-runtime/viewport-interaction";
import {
  VIEWER_BACKGROUND_IMAGE_ALT,
  productionViewerWorldLifecycleKey,
  resolveViewerBackgroundImageUrl,
} from "@/lib/afc-v2-runtime/viewer-presentation";

type Props = Readonly<{
  roomId: string;
  authority: AfcV2ProductionRoomAuthority;
  backgroundImageUrl?: string;
  originalImageUrl?: string;
  transformMode?: RuntimeTransformMode;
  onTransformModeChange?: (mode: RuntimeTransformMode) => void;
  showInternalControls?: boolean;
}>;

type ReadyProps = Readonly<{
  roomId: string;
  authority: AfcV2ProductionRoomAuthority;
  visualImageUrl: string;
  transformMode?: RuntimeTransformMode;
  onTransformModeChange?: (mode: RuntimeTransformMode) => void;
  showInternalControls?: boolean;
}>;

type RuntimeEntry = {
  objectId: string;
  placement: THREE.Group;
  importPlacement: THREE.Group;
  localAabb: ReturnType<typeof measurePlacementLocalAabb>;
  lastResolved: WorldTransform | null;
  canonicalTransform: WorldTransform;
};

export function AfcProductionRoomViewer({
  roomId,
  authority,
  backgroundImageUrl,
  originalImageUrl,
  transformMode,
  onTransformModeChange,
  showInternalControls = true,
}: Props) {
  const validated = useMemo(
    () => validateProductionRuntimeAuthority(authority),
    [authority],
  );
  const visualImageUrl = resolveViewerBackgroundImageUrl({
    backgroundImageUrl,
    originalImageUrl,
  });
  if (!validated.ok) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 px-6 text-center text-sm text-red-200">
        AFC runtime refused this authority: {validated.reason}
      </div>
    );
  }
  if (!visualImageUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 px-6 text-center text-sm text-red-200">
        AFC runtime refused this presentation: background image URL is missing
      </div>
    );
  }
  return (
    <AfcProductionRoomViewerReady
      key={productionViewerWorldLifecycleKey(validated.authority)}
      roomId={roomId}
      authority={validated.authority}
      visualImageUrl={visualImageUrl}
      transformMode={transformMode}
      onTransformModeChange={onTransformModeChange}
      showInternalControls={showInternalControls}
    />
  );
}

function AfcProductionRoomViewerReady({
  roomId,
  authority,
  visualImageUrl,
  transformMode: transformModeProp,
  onTransformModeChange,
  showInternalControls = true,
}: ReadyProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [internalTransformMode, setInternalTransformMode] =
    useState<RuntimeTransformMode>("move");
  const transformMode = transformModeProp ?? internalTransformMode;
  const [selected, setSelected] = useState(true);
  const [frameBox, setFrameBox] = useState<{
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);
  const transformModeRef = useRef(transformMode);
  const selectedRef = useRef(selected);

  const world = useMemo(() => realizeProductionWorld(authority), [authority]);
  const cube = useMemo(
    () => createPi3aCubeObjectFromAuthority(roomId, authority),
    [authority, roomId],
  );

  useEffect(() => {
    transformModeRef.current = transformMode;
  }, [transformMode]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = authority.frozenCamera.frame;
    const apply = () => {
      const rect = containFitRect(
        viewport.clientWidth,
        viewport.clientHeight,
        frame.width,
        frame.height,
      );
      if (!rect) return;
      setFrameBox({
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      });
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [authority.frozenCamera.frame]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const built = buildProductionPerspectiveCamera(world.camera);
    if (!built.ok) return;
    const camera = built.camera;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "size-full bg-transparent";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(3, 6, 5);
    scene.add(ambient);
    scene.add(keyLight);

    const objectLayer = new THREE.Group();
    scene.add(objectLayer);

    const root = createSceneObjectRoot();
    const entry: RuntimeEntry = {
      objectId: cube.objectId,
      placement: root.placement,
      importPlacement: root.importPlacement,
      localAabb: null,
      lastResolved: realizeObjectWorldTransform(cube.transform, world.metricScale),
      canonicalTransform: cube.transform,
    };
    tagSceneObjectRoot(entry.placement, cube.objectId);
    attachImportedObject(entry.importPlacement, createOneMetreCubeMesh());
    entry.localAabb = measurePlacementLocalAabb(entry.placement, entry.importPlacement);
    const initialTransform = entry.lastResolved ??
      realizeObjectWorldTransform(cube.transform, world.metricScale);
    applyWorldTransform(entry.placement, initialTransform);
    entry.lastResolved = initialTransform;
    objectLayer.add(entry.placement);

    const controls = new TransformControls(camera, renderer.domElement);
    const controlsHelper = controls.getHelper();
    scene.add(controlsHelper);
    controls.setSpace("world");
    controls.setSize(0.85);
    controls.setMode("translate");
    controls.attach(transformControlsAttachmentTarget(entry));

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let disposed = false;
    let animationFrame = 0;
    let gizmoDragging = false;
    let pointerGesture: {
      clientX: number;
      clientY: number;
      pointerDownOnGizmo: boolean;
    } | null = null;
    let bodyDrag: {
      objectId: string;
      grabPlaneY: number;
      placementY: number;
      offsetX: number;
      offsetZ: number;
      startClientX: number;
      startClientY: number;
      pointerId: number;
      active: boolean;
    } | null = null;

    const resizeRenderer = () => {
      const width = Math.max(1, Math.floor(mount.clientWidth));
      const height = Math.max(1, Math.floor(mount.clientHeight));
      renderer.setSize(width, height, false);
      applyRealizedFrozenCamera(camera, world.camera);
    };
    resizeRenderer();
    const frameObserver = new ResizeObserver(resizeRenderer);
    frameObserver.observe(mount);

    const realizedWalls = world.collisionWalls;

    const reportCanonical = (realized: WorldTransform) => {
      entry.canonicalTransform = canonicalizeObjectWorldTransform(
        realized,
        world.metricScale,
      );
    };

    const writeAttachedTransform = () => {
      const attached = controls.object;
      if (!attached) return;
      enforceNonNegativeWorldY(attached);
      attached.scale.setScalar(1);
      const proposed = worldTransformFromObject3D(attached);
      const current = entry.lastResolved ?? proposed;
      const mode = controls.getMode() === "translate" ? "move" : "pose";
      const resolved = resolveSceneObjectCollision({
        current,
        proposed,
        localAabb: entry.localAabb,
        walls: realizedWalls,
        mode,
      });
      applyWorldTransform(attached, {
        ...resolved.transform,
        uniformScale: 1,
      });
      attached.scale.setScalar(1);
      entry.lastResolved = {
        ...resolved.transform,
        uniformScale: 1,
      };
      reportCanonical(entry.lastResolved);
    };

    const syncGizmo = () => {
      const mode = viewportModeToControlsMode(transformModeRef.current);
      if (controls.getMode() !== mode) controls.setMode(mode);
      if (mode === "translate") controls.setSpace("world");
      if (!selectedRef.current) {
        if (controls.object) controls.detach();
        return;
      }
      const target = transformControlsAttachmentTarget(entry);
      if (controls.object !== target) controls.attach(target);
    };

    const pickHitsAt = (clientX: number, clientY: number) => {
      const ndc = pointerEventToNdc(
        clientX,
        clientY,
        renderer.domElement.getBoundingClientRect(),
      );
      if (!ndc) return [];
      pointerNdc.set(ndc.x, ndc.y);
      raycaster.setFromCamera(pointerNdc, camera);
      return raycaster.intersectObject(objectLayer, true);
    };

    const planeHitAt = (clientX: number, clientY: number, planeY: number) => {
      const ndc = pointerEventToNdc(
        clientX,
        clientY,
        renderer.domElement.getBoundingClientRect(),
      );
      if (!ndc) return null;
      pointerNdc.set(ndc.x, ndc.y);
      raycaster.setFromCamera(pointerNdc, camera);
      return intersectRayWithHorizontalPlane(raycaster.ray, planeY);
    };

    const releaseBodyDragCapture = (pointerId: number) => {
      try {
        if (renderer.domElement.hasPointerCapture(pointerId)) {
          renderer.domElement.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer already released.
      }
    };

    const endBodyDrag = () => {
      const session = bodyDrag;
      if (!session) return;
      bodyDrag = null;
      controls.enabled = true;
      releaseBodyDragCapture(session.pointerId);
      if (!session.active) return;
      entry.placement.position.y = session.placementY;
      enforceNonNegativeWorldY(entry.placement);
      entry.placement.scale.setScalar(1);
      entry.lastResolved = worldTransformFromObject3D(entry.placement);
      reportCanonical(entry.lastResolved);
    };

    const applyBodyDragAt = (clientX: number, clientY: number) => {
      const session = bodyDrag;
      if (!session?.active) return;
      const hit = planeHitAt(clientX, clientY, session.grabPlaneY);
      if (!hit) return;
      const next = objectBodyDragWorldPosition({
        hitX: hit.x,
        hitZ: hit.z,
        offsetX: session.offsetX,
        offsetZ: session.offsetZ,
        placementY: session.placementY,
      });
      const current = entry.lastResolved ?? worldTransformFromObject3D(entry.placement);
      const proposed = {
        ...current,
        position: {
          x: next.x,
          y: session.placementY,
          z: next.z,
        },
        uniformScale: 1,
      };
      const resolved = resolveSceneObjectCollision({
        current,
        proposed,
        localAabb: entry.localAabb,
        walls: realizedWalls,
        mode: "move",
      });
      applyPlacementWorldPosition(entry.placement, {
        x: resolved.transform.position.x,
        y: session.placementY,
        z: resolved.transform.position.z,
      });
      entry.placement.position.y = session.placementY;
      entry.placement.scale.setScalar(1);
      entry.lastResolved = {
        ...resolved.transform,
        position: {
          ...resolved.transform.position,
          y: session.placementY,
        },
        uniformScale: 1,
      };
      reportCanonical(entry.lastResolved);
    };

    const pointerDownListener = (event: PointerEvent) => {
      if (event.isPrimary === false) return;
      const pointerDownOnGizmo = controls.axis !== null || gizmoDragging;
      pointerGesture = {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerDownOnGizmo,
      };
      if (pointerDownOnGizmo) {
        endBodyDrag();
        return;
      }
      const hits = pickHitsAt(event.clientX, event.clientY);
      const hitObjectId = pickSceneObjectId(hits);
      if (
        !shouldBeginObjectBodyDrag({
          pointerDownOnGizmo,
          gizmoDragging,
          hitObjectId,
        }) ||
        !hitObjectId
      ) {
        return;
      }
      selectedRef.current = true;
      setSelected(true);
      const picked = hits.find((item) => resolveSceneObjectId(item.object) === hitObjectId);
      const placementY = entry.placement.position.y;
      const grabPlaneY = picked?.point && Number.isFinite(picked.point.y)
        ? picked.point.y
        : placementY;
      const hit = planeHitAt(event.clientX, event.clientY, grabPlaneY);
      if (!hit) return;
      const worldXZ = worldPositionXZ(entry.placement);
      const grab = bodyDragGrabOffset(hit, worldXZ);
      bodyDrag = {
        objectId: hitObjectId,
        grabPlaneY,
        placementY,
        offsetX: grab.offsetX,
        offsetZ: grab.offsetZ,
        startClientX: event.clientX,
        startClientY: event.clientY,
        pointerId: event.pointerId,
        active: false,
      };
      controls.enabled = false;
      try {
        renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // Capture is best-effort.
      }
    };

    const pointerMoveListener = (event: PointerEvent) => {
      const session = bodyDrag;
      if (!session || event.pointerId !== session.pointerId) return;
      if (gizmoDragging || pointerGesture?.pointerDownOnGizmo) {
        endBodyDrag();
        return;
      }
      const movement = Math.hypot(
        event.clientX - session.startClientX,
        event.clientY - session.startClientY,
      );
      if (!session.active) {
        if (!shouldActivateObjectBodyDrag(movement)) return;
        session.active = true;
      }
      applyBodyDragAt(event.clientX, event.clientY);
    };

    const pointerUpListener = (event: PointerEvent) => {
      if (bodyDrag && event.pointerId !== bodyDrag.pointerId) return;
      const gesture = pointerGesture;
      pointerGesture = null;
      const dragWasActive = bodyDrag?.active === true;
      endBodyDrag();
      if (dragWasActive) return;
      if (!gesture) return;
      const movement = Math.hypot(
        event.clientX - gesture.clientX,
        event.clientY - gesture.clientY,
      );
      if (
        shouldSuppressSceneSelection({
          gizmoDragging,
          pointerDownOnGizmo: gesture.pointerDownOnGizmo,
          pointerMovementPx: movement,
          bodyDragging: dragWasActive,
        })
      ) {
        return;
      }
      const id = pickSceneObjectId(pickHitsAt(event.clientX, event.clientY));
      selectedRef.current = id === cube.objectId;
      setSelected(id === cube.objectId);
    };

    const pointerCancelListener = (event: PointerEvent) => {
      if (bodyDrag && event.pointerId !== bodyDrag.pointerId) return;
      pointerGesture = null;
      endBodyDrag();
    };

    const draggingChangedListener = (event: { value?: unknown }) => {
      gizmoDragging = event.value === true;
      if (gizmoDragging && bodyDrag) endBodyDrag();
      if (!gizmoDragging) writeAttachedTransform();
    };
    const objectChangeListener = () => {
      writeAttachedTransform();
    };

    controls.addEventListener("dragging-changed", draggingChangedListener);
    controls.addEventListener("objectChange", objectChangeListener);
    renderer.domElement.addEventListener("pointerdown", pointerDownListener);
    renderer.domElement.addEventListener("pointermove", pointerMoveListener);
    renderer.domElement.addEventListener("pointerup", pointerUpListener);
    renderer.domElement.addEventListener("pointercancel", pointerCancelListener);

    const animate = () => {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(animate);
      applyRealizedFrozenCamera(camera, world.camera);
      if (controls.getMode() === "scale") controls.setMode("translate");
      entry.placement.scale.setScalar(1);
      if (
        entry.lastResolved &&
        !gizmoDragging &&
        bodyDrag?.active !== true &&
        !objectMatchesWorldTransform(entry.placement, entry.lastResolved)
      ) {
        applyWorldTransform(entry.placement, entry.lastResolved);
      }
      enforceNonNegativeWorldY(entry.placement);
      syncGizmo();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      frameObserver.disconnect();
      pointerGesture = null;
      bodyDrag = null;
      controls.removeEventListener("dragging-changed", draggingChangedListener);
      controls.removeEventListener("objectChange", objectChangeListener);
      renderer.domElement.removeEventListener("pointerdown", pointerDownListener);
      renderer.domElement.removeEventListener("pointermove", pointerMoveListener);
      renderer.domElement.removeEventListener("pointerup", pointerUpListener);
      renderer.domElement.removeEventListener("pointercancel", pointerCancelListener);
      controls.detach();
      controls.dispose();
      scene.remove(controlsHelper);
      objectLayer.remove(entry.placement);
      disposeObject3D(entry.placement);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [authority.generationId, cube.objectId, cube.transform, world]);

  return (
    <div className="relative h-full min-h-0 w-full bg-neutral-950">
      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-hidden bg-black"
        data-afc-runtime-viewport="true"
      >
        <div
          ref={frameRef}
          className="absolute overflow-hidden"
          data-afc-runtime-frame="true"
          data-afc-generation-id={authority.generationId}
          style={
            frameBox
              ? {
                left: frameBox.left,
                top: frameBox.top,
                width: frameBox.width,
                height: frameBox.height,
              }
              : { inset: 0 }
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed room image URL is not a Next image domain */}
          <img
            src={visualImageUrl}
            alt={VIEWER_BACKGROUND_IMAGE_ALT}
            className="absolute inset-0 z-0 h-full w-full"
            draggable={false}
          />
          <div
            ref={mountRef}
            className="absolute inset-0 z-10 bg-transparent"
            aria-label="Production AFC frozen-camera runtime"
            data-scene-interaction="viewport"
          />
        </div>
      </div>
      {showInternalControls ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex gap-2">
          <button
            type="button"
            className={`pointer-events-auto rounded-md border px-2 py-1 text-xs ${
              transformMode === "move"
                ? "border-emerald-400/70 bg-emerald-950/70 text-emerald-100"
                : "border-neutral-700 bg-neutral-900/80 text-neutral-200"
            }`}
            onClick={() => {
              if (transformModeProp === undefined) {
                setInternalTransformMode("move");
              }
              onTransformModeChange?.("move");
            }}
          >
            Move
          </button>
          <button
            type="button"
            className={`pointer-events-auto rounded-md border px-2 py-1 text-xs ${
              transformMode === "rotate"
                ? "border-emerald-400/70 bg-emerald-950/70 text-emerald-100"
                : "border-neutral-700 bg-neutral-900/80 text-neutral-200"
            }`}
            onClick={() => {
              if (transformModeProp === undefined) {
                setInternalTransformMode("rotate");
              }
              onTransformModeChange?.("rotate");
            }}
          >
            Rotate
          </button>
        </div>
      ) : null}
    </div>
  );
}
