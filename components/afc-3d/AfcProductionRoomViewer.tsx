"use client";

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import { resolveSceneObjectCollision } from "@/lib/afc-v2-runtime/collision-resolver";
import { containFitRect } from "@/lib/afc-v2-runtime/frame-layout";
import { cloneFurnitureGlbScene, loadFurnitureGlb } from "@/lib/afc-v2-runtime/furniture-glb-loader";
import {
  PI4A_FURNITURE_LOADING_MESSAGE,
  PI4B_INITIAL_SELECTED_OBJECT_ID,
  createPi4aFurnitureObjectFromAuthority,
  createPi4bSceneObjects,
  instantiateSceneObjectDefinitions,
  pi4aFurnitureGlbPublicPath,
} from "@/lib/afc-v2-runtime/furniture-runtime";
import {
  liveSceneObjectIds,
  shouldReplaceLiveScene,
} from "@/lib/afc-v2-runtime/persisted-scene";
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
  disposeObject3D,
  measurePlacementLocalAabb,
} from "@/lib/afc-v2-runtime/object-runtime";
import {
  attachTargetForSelectedObject,
  commitLiveSceneObjectTransform,
  createRuntimeSceneCollection,
  getLiveSceneObject,
  liveSceneObjectForBodyDrag,
  mountLiveRuntimeSceneObject,
  resolveSelectedObjectId,
  serializeRuntimeScene,
  setLiveSceneObject,
  type LiveRuntimeSceneObject,
} from "@/lib/afc-v2-runtime/scene-runtime";
import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";
import { validateProductionRuntimeAuthority } from "@/lib/afc-v2-runtime/runtime-authority";
import type {
  RuntimeTransformMode,
  SceneObjectDefinition,
  SerializedRuntimeScene,
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
  viewportModeToControlsMode,
  worldPositionXZ,
  worldTransformFromObject3D,
} from "@/lib/afc-v2-runtime/viewport-interaction";
import { INTEGRATED_3D_RESTORE_ERROR_MESSAGE } from "@/lib/afc-v2-runtime/editor-viewport-mode";
import {
  VIEWER_BACKGROUND_IMAGE_ALT,
  productionViewerWorldLifecycleKey,
  resolveViewerBackgroundImageUrl,
} from "@/lib/afc-v2-runtime/viewer-presentation";

type Props = Readonly<{
  roomId: string;
  authority: AfcV2ProductionRoomAuthority;
  backgroundImageUrl?: string | null;
  originalImageUrl?: string | null;
  transformMode?: RuntimeTransformMode;
  onTransformModeChange?: (mode: RuntimeTransformMode) => void;
  showInternalControls?: boolean;
  sceneObjects?: readonly SceneObjectDefinition[];
  sceneInstanceId?: string;
  sceneReady?: boolean;
  onObjectTransformCommitted?: (scene: SerializedRuntimeScene) => void;
}>;

type ReadyProps = Readonly<{
  roomId: string;
  authority: AfcV2ProductionRoomAuthority;
  visualImageUrl: string;
  originalImageUrl?: string | null;
  transformMode?: RuntimeTransformMode;
  onTransformModeChange?: (mode: RuntimeTransformMode) => void;
  showInternalControls?: boolean;
  sceneObjects?: readonly SceneObjectDefinition[];
  sceneInstanceId?: string;
  sceneReady?: boolean;
  onObjectTransformCommitted?: (scene: SerializedRuntimeScene) => void;
}>;

export function AfcProductionRoomViewer({
  roomId,
  authority,
  backgroundImageUrl,
  originalImageUrl,
  transformMode,
  onTransformModeChange,
  showInternalControls = true,
  sceneObjects,
  sceneInstanceId,
  sceneReady = true,
  onObjectTransformCommitted,
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
        {showInternalControls
          ? `AFC runtime refused this authority: ${validated.reason}`
          : INTEGRATED_3D_RESTORE_ERROR_MESSAGE}
      </div>
    );
  }
  if (!visualImageUrl) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 px-6 text-center text-sm text-red-200">
        {showInternalControls
          ? "AFC runtime refused this presentation: background image URL is missing"
          : INTEGRATED_3D_RESTORE_ERROR_MESSAGE}
      </div>
    );
  }
  return (
    <AfcProductionRoomViewerReady
      key={productionViewerWorldLifecycleKey(validated.authority)}
      roomId={roomId}
      authority={validated.authority}
      visualImageUrl={visualImageUrl}
      originalImageUrl={originalImageUrl}
      transformMode={transformMode}
      onTransformModeChange={onTransformModeChange}
      showInternalControls={showInternalControls}
      sceneObjects={sceneObjects}
      sceneInstanceId={sceneInstanceId}
      sceneReady={sceneReady}
      onObjectTransformCommitted={onObjectTransformCommitted}
    />
  );
}

function AfcProductionRoomViewerReady({
  roomId,
  authority,
  visualImageUrl,
  originalImageUrl,
  transformMode: transformModeProp,
  onTransformModeChange,
  showInternalControls = true,
  sceneObjects: sceneObjectsProp,
  sceneInstanceId: sceneInstanceIdProp,
  sceneReady = true,
  onObjectTransformCommitted,
}: ReadyProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [internalTransformMode, setInternalTransformMode] =
    useState<RuntimeTransformMode>("move");
  const transformMode = transformModeProp ?? internalTransformMode;
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(
    PI4B_INITIAL_SELECTED_OBJECT_ID,
  );
  const [furniturePhase, setFurniturePhase] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [frameBox, setFrameBox] = useState<{
    width: number;
    height: number;
    left: number;
    top: number;
  } | null>(null);
  const transformModeRef = useRef(transformMode);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const applyLiveSceneRef = useRef<null | ((input: Readonly<{
    instanceId: string;
    objects: readonly SceneObjectDefinition[];
    ready: boolean;
  }>) => void)>(null);

  const world = useMemo(() => realizeProductionWorld(authority), [authority]);
  const furniture = useMemo(
    () => createPi4aFurnitureObjectFromAuthority(roomId, authority),
    [authority, roomId],
  );
  const fallbackSceneObjects = useMemo(
    () =>
      createPi4bSceneObjects({
        roomId: furniture.roomId,
        generationId: furniture.generationId,
      }).map((object) => ({
        objectId: object.objectId,
        assetId: object.assetIdentity.id,
        transform: object.transform,
      })),
    [furniture.generationId, furniture.roomId],
  );
  const resolvedSceneObjects = sceneObjectsProp ?? fallbackSceneObjects;
  const resolvedSceneInstanceId = sceneInstanceIdProp ??
    `local:${roomId}:${authority.generationId}`;
  const sceneObjectsPropRef = useRef(resolvedSceneObjects);
  const sceneInstanceIdRef = useRef(resolvedSceneInstanceId);
  const sceneReadyRef = useRef(sceneReady);
  const onCommittedRef = useRef(onObjectTransformCommitted);
  sceneObjectsPropRef.current = resolvedSceneObjects;
  sceneInstanceIdRef.current = resolvedSceneInstanceId;
  sceneReadyRef.current = sceneReady;
  onCommittedRef.current = onObjectTransformCommitted;

  useEffect(() => {
    transformModeRef.current = transformMode;
  }, [transformMode]);
  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
  }, [selectedObjectId]);

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

    const sceneObjects = createRuntimeSceneCollection();
    const assetTemplates: THREE.Group[] = [];
    let appliedInstanceId: string | null = null;
    let appliedObjectIds: string[] = [];
    let template: THREE.Group | null = null;

    const controls = new TransformControls(camera, renderer.domElement);
    const controlsHelper = controls.getHelper();
    scene.add(controlsHelper);
    controls.setSpace("world");
    controls.setSize(0.85);
    controls.setMode("translate");
    let furnitureReady = false;

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

    const reportCanonical = (
      object: LiveRuntimeSceneObject,
      realized: WorldTransform,
    ) => {
      object.canonicalTransform = canonicalizeObjectWorldTransform(
        realized,
        world.metricScale,
      );
    };

    const writeAttachedTransform = () => {
      const attached = controls.object;
      if (!attached) return;
      const object = getLiveSceneObject(
        sceneObjects,
        resolveSceneObjectId(attached),
      );
      if (!object) return;
      enforceNonNegativeWorldY(attached);
      attached.scale.setScalar(1);
      const proposed = worldTransformFromObject3D(attached);
      const current = object.realizedTransform;
      const mode = controls.getMode() === "translate" ? "move" : "pose";
      const resolved = resolveSceneObjectCollision({
        current,
        proposed,
        localAabb: object.localAabb,
        walls: realizedWalls,
        mode,
      });
      applyWorldTransform(attached, {
        ...resolved.transform,
        uniformScale: 1,
      });
      attached.scale.setScalar(1);
      object.realizedTransform = {
        ...resolved.transform,
        uniformScale: 1,
      };
      reportCanonical(object, object.realizedTransform);
    };

    const syncGizmo = () => {
      if (!sceneReadyRef.current || !furnitureReady) {
        if (controls.object) controls.detach();
        return;
      }
      const mode = viewportModeToControlsMode(transformModeRef.current);
      if (controls.getMode() !== mode) controls.setMode(mode);
      if (mode === "translate") controls.setSpace("world");
      const target = furnitureReady
        ? attachTargetForSelectedObject(
          sceneObjects,
          selectedObjectIdRef.current,
        )
        : null;
      if (!target) {
        if (controls.object) controls.detach();
        return;
      }
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

    const emitCommittedScene = () => {
      if (sceneObjects.size === 0) return;
      onCommittedRef.current?.(serializeRuntimeScene(sceneObjects));
    };

    const endBodyDrag = () => {
      const session = bodyDrag;
      if (!session) return;
      bodyDrag = null;
      controls.enabled = true;
      releaseBodyDragCapture(session.pointerId);
      if (!session.active) return;
      const object = liveSceneObjectForBodyDrag(sceneObjects, session);
      if (!object) return;
      object.placement.position.y = session.placementY;
      enforceNonNegativeWorldY(object.placement);
      object.placement.scale.setScalar(1);
      object.realizedTransform = worldTransformFromObject3D(object.placement);
      reportCanonical(object, object.realizedTransform);
      emitCommittedScene();
    };

    const applyBodyDragAt = (clientX: number, clientY: number) => {
      const session = bodyDrag;
      if (!session?.active) return;
      const object = liveSceneObjectForBodyDrag(sceneObjects, session);
      if (!object) return;
      const hit = planeHitAt(clientX, clientY, session.grabPlaneY);
      if (!hit) return;
      const next = objectBodyDragWorldPosition({
        hitX: hit.x,
        hitZ: hit.z,
        offsetX: session.offsetX,
        offsetZ: session.offsetZ,
        placementY: session.placementY,
      });
      const current = object.realizedTransform;
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
        localAabb: object.localAabb,
        walls: realizedWalls,
        mode: "move",
      });
      applyPlacementWorldPosition(object.placement, {
        x: resolved.transform.position.x,
        y: session.placementY,
        z: resolved.transform.position.z,
      });
      object.placement.position.y = session.placementY;
      object.placement.scale.setScalar(1);
      object.realizedTransform = {
        ...resolved.transform,
        position: {
          ...resolved.transform.position,
          y: session.placementY,
        },
        uniformScale: 1,
      };
      reportCanonical(object, object.realizedTransform);
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
      const object = getLiveSceneObject(sceneObjects, hitObjectId);
      if (!object) return;
      selectedObjectIdRef.current = hitObjectId;
      setSelectedObjectId(hitObjectId);
      const picked = hits.find((item) => resolveSceneObjectId(item.object) === hitObjectId);
      const placementY = object.placement.position.y;
      const grabPlaneY = picked?.point && Number.isFinite(picked.point.y)
        ? picked.point.y
        : placementY;
      const hit = planeHitAt(event.clientX, event.clientY, grabPlaneY);
      if (!hit) return;
      const worldXZ = worldPositionXZ(object.placement);
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
      const id = resolveSelectedObjectId(
        pickSceneObjectId(pickHitsAt(event.clientX, event.clientY)),
      );
      const next = id && sceneObjects.has(id) ? id : null;
      selectedObjectIdRef.current = next;
      setSelectedObjectId(next);
    };

    const pointerCancelListener = (event: PointerEvent) => {
      if (bodyDrag && event.pointerId !== bodyDrag.pointerId) return;
      pointerGesture = null;
      endBodyDrag();
    };

    const draggingChangedListener = (event: { value?: unknown }) => {
      gizmoDragging = event.value === true;
      if (gizmoDragging && bodyDrag) endBodyDrag();
      if (!gizmoDragging) {
        writeAttachedTransform();
        emitCommittedScene();
      }
    };
    const objectChangeListener = () => {
      writeAttachedTransform();
    };

    const clearMountedObjects = () => {
      for (const object of sceneObjects.values()) {
        objectLayer.remove(object.placement);
      }
      sceneObjects.clear();
    };

    const mountDescriptors = (definitions: readonly SceneObjectDefinition[]) => {
      if (!template) return;
      clearMountedObjects();
      const instantiated = instantiateSceneObjectDefinitions({
        roomId: furniture.roomId,
        generationId: furniture.generationId,
        definitions,
      });
      if (instantiated.skipped.length > 0 && typeof console !== "undefined") {
        console.warn(
          "[afc-3d-scene] skipped objects with unknown asset identity",
          instantiated.skipped,
        );
      }
      for (const descriptor of instantiated.objects) {
        const realized = realizeObjectWorldTransform(
          descriptor.transform,
          world.metricScale,
        );
        const live = mountLiveRuntimeSceneObject({
          descriptor,
          imported: cloneFurnitureGlbScene(template),
          metricScale: world.metricScale,
        });
        live.localAabb = measurePlacementLocalAabb(
          live.placement,
          live.importPlacement,
        );
        commitLiveSceneObjectTransform(live, realized, world.metricScale);
        setLiveSceneObject(sceneObjects, live);
        objectLayer.add(live.placement);
      }
    };

    const applyLiveScene = (input: Readonly<{
      instanceId: string;
      objects: readonly SceneObjectDefinition[];
      ready: boolean;
    }>) => {
      if (!input.ready) {
        objectLayer.visible = false;
        return;
      }
      objectLayer.visible = true;
      const nextIds = liveSceneObjectIds(input.objects);
      if (
        !shouldReplaceLiveScene({
          appliedInstanceId,
          nextInstanceId: input.instanceId,
          appliedObjectIds,
          nextObjectIds: nextIds,
        })
      ) {
        return;
      }
      if (!template) return;
      mountDescriptors(input.objects);
      appliedInstanceId = input.instanceId;
      appliedObjectIds = nextIds;
      furnitureReady = true;
      const keep = selectedObjectIdRef.current &&
        sceneObjects.has(selectedObjectIdRef.current)
        ? selectedObjectIdRef.current
        : sceneObjects.has(PI4B_INITIAL_SELECTED_OBJECT_ID)
          ? PI4B_INITIAL_SELECTED_OBJECT_ID
          : (sceneObjects.keys().next().value ?? null);
      selectedObjectIdRef.current = keep;
      setSelectedObjectId(keep);
    };
    applyLiveSceneRef.current = applyLiveScene;

    void loadFurnitureGlb(pi4aFurnitureGlbPublicPath()).then((result) => {
      if (disposed) {
        if (result.ok) disposeObject3D(result.scene);
        return;
      }
      if (!result.ok) {
        setFurniturePhase("error");
        return;
      }
      template = result.scene;
      assetTemplates.push(result.scene);
      applyLiveScene({
        instanceId: sceneInstanceIdRef.current,
        objects: sceneObjectsPropRef.current,
        ready: sceneReadyRef.current,
      });
      setFurniturePhase("ready");
    });

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
      objectLayer.visible = sceneReadyRef.current;
      const skipObjectId = bodyDrag?.active
        ? bodyDrag.objectId
        : (gizmoDragging ? resolveSceneObjectId(controls.object) : null);
      for (const object of sceneObjects.values()) {
        object.placement.scale.setScalar(1);
        if (
          object.objectId !== skipObjectId &&
          !objectMatchesWorldTransform(object.placement, object.realizedTransform)
        ) {
          applyWorldTransform(object.placement, object.realizedTransform);
        }
        enforceNonNegativeWorldY(object.placement);
      }
      syncGizmo();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      applyLiveSceneRef.current = null;
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
      for (const object of sceneObjects.values()) {
        objectLayer.remove(object.placement);
      }
      sceneObjects.clear();
      for (const template of assetTemplates) {
        disposeObject3D(template);
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Certified History continuity: do not add visualImageUrl or version identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PI-3B/PI-4A frozen world deps
  }, [authority.generationId, furniture.objectId, furniture.transform, world]);

  useEffect(() => {
    applyLiveSceneRef.current?.({
      instanceId: resolvedSceneInstanceId,
      objects: resolvedSceneObjects,
      ready: sceneReady,
    });
  }, [resolvedSceneInstanceId, resolvedSceneObjects, sceneReady]);

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
            onError={(event) => {
              const image = event.currentTarget;
              const fallback = originalImageUrl?.trim() ?? "";
              if (
                !fallback ||
                fallback === visualImageUrl ||
                image.dataset.presentationFallback === "applied"
              ) {
                return;
              }
              image.dataset.presentationFallback = "applied";
              image.src = fallback;
            }}
          />
          <div
            ref={mountRef}
            className="absolute inset-0 z-10 bg-transparent"
            aria-label={
              showInternalControls
                ? "Production AFC frozen-camera runtime"
                : "3D room"
            }
            data-scene-interaction="viewport"
          />
          {furniturePhase === "loading" ? (
            <div
              className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
              role="status"
              aria-live="polite"
            >
              <div className="rounded-md bg-neutral-950/70 px-3 py-1.5 text-sm text-neutral-100">
                {PI4A_FURNITURE_LOADING_MESSAGE}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {showInternalControls ? (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex gap-2">
          <button
            type="button"
            className={`pointer-events-auto rounded-md border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
              transformMode === "move"
                ? "border-emerald-400/70 bg-emerald-950/70 text-emerald-100"
                : "border-neutral-700 bg-neutral-900/80 text-neutral-200"
            }`}
            aria-pressed={transformMode === "move"}
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
            className={`pointer-events-auto rounded-md border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 ${
              transformMode === "rotate"
                ? "border-emerald-400/70 bg-emerald-950/70 text-emerald-100"
                : "border-neutral-700 bg-neutral-900/80 text-neutral-200"
            }`}
            aria-pressed={transformMode === "rotate"}
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
