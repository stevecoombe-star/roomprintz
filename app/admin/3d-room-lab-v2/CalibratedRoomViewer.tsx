"use client";

import Image from "next/image";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { useEffect, useRef } from "react";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "@/app/admin/3d-room-lab/calibrated-camera-readonly-projection";

import type {
  SceneObjectLoadStatus,
  SceneObjectRecord,
  ViewportTransformMode,
  WorldTransform,
} from "./scene-layer-state";
import {
  applyWorldTransform,
  attachNormalizedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
  disposeObject3D,
  loadGlbFromUrl,
} from "./scene-object-runtime";
import {
  applyPlacementWorldPosition,
  bodyDragGrabOffset,
  deriveUniformScaleFromAxes,
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
} from "./scene-viewport-interaction";

export type FrozenV2CameraSnapshot = Readonly<{
  verticalFovDeg: number;
  pose: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    lookAt: Readonly<{ x: number; y: number; z: number }>;
    up: Readonly<{ x: number; y: number; z: number }>;
  }>;
  frame: Readonly<{ width: number; height: number }>;
}>;

type Props = Readonly<{
  originalImageUrl: string;
  camera: FrozenV2CameraSnapshot;
  floor: Readonly<{ worldWidthM: number; referenceDepthM: number }>;
  showFloorQuad: boolean;
  sceneObjects: readonly SceneObjectRecord[];
  selectedObjectId: string | null;
  transformMode: ViewportTransformMode;
  reportObjectLoadStatus?: (
    objectId: string,
    loadStatus: SceneObjectLoadStatus,
    loadError?: string | null,
  ) => void;
  reportSelection?: (objectId: string | null) => void;
  reportObjectTransform?: (objectId: string, transform: WorldTransform) => void;
}>;

type RuntimeEntry = {
  id: string;
  kind: SceneObjectRecord["kind"];
  objectUrl: string | null;
  placement: THREE.Group;
  autoBounds: THREE.Group;
  loadToken: number;
};

/**
 * Read-only realization of an already-frozen camera snapshot. It deliberately
 * has no solver, writer, or state callback: replacing the snapshot is the only
 * way to change the rendered camera. Scene objects are a downstream overlay.
 */
export default function CalibratedRoomViewer({
  originalImageUrl,
  camera: snapshot,
  floor,
  showFloorQuad,
  sceneObjects,
  selectedObjectId,
  transformMode,
  reportObjectLoadStatus,
  reportSelection,
  reportObjectTransform,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const showFloorQuadRef = useRef(showFloorQuad);
  const sceneObjectsRef = useRef(sceneObjects);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const transformModeRef = useRef(transformMode);
  const reportLoadStatusRef = useRef(reportObjectLoadStatus);
  const reportSelectionRef = useRef(reportSelection);
  const reportObjectTransformRef = useRef(reportObjectTransform);

  useEffect(() => {
    showFloorQuadRef.current = showFloorQuad;
    sceneObjectsRef.current = sceneObjects;
    selectedObjectIdRef.current = selectedObjectId;
    transformModeRef.current = transformMode;
    reportLoadStatusRef.current = reportObjectLoadStatus;
    reportSelectionRef.current = reportSelection;
    reportObjectTransformRef.current = reportObjectTransform;
  }, [
    reportObjectLoadStatus,
    reportObjectTransform,
    reportSelection,
    sceneObjects,
    selectedObjectId,
    showFloorQuad,
    transformMode,
  ]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const result = buildCalibratedReadOnlyProjectionCamera({
      fovDeg: snapshot.verticalFovDeg,
      pose: snapshot.pose,
      frameSize: snapshot.frame,
      near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
      far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
    });
    if (!result.ok) return;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(snapshot.frame.width, snapshot.frame.height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "size-full bg-transparent";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(3, 6, 5);
    scene.add(ambient);
    scene.add(keyLight);

    const material = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      opacity: 0.08,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geometry = new THREE.PlaneGeometry(
      floor.worldWidthM,
      floor.referenceDepthM,
    );
    const floorSurface = new THREE.Mesh(geometry, material);
    floorSurface.rotation.x = -Math.PI / 2;
    scene.add(floorSurface);
    const edgesGeometry = new THREE.EdgesGeometry(geometry);
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.75,
    });
    const floorWireframe = new THREE.LineSegments(
      edgesGeometry,
      edgesMaterial,
    );
    floorWireframe.rotation.x = -Math.PI / 2;
    scene.add(floorWireframe);

    const objectLayer = new THREE.Group();
    scene.add(objectLayer);
    const runtime = new Map<string, RuntimeEntry>();
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const controls = new TransformControls(result.camera, renderer.domElement);
    const controlsHelper = controls.getHelper();
    scene.add(controlsHelper);
    controls.setSpace("world");
    controls.setSize(0.85);

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

    const removeEntry = (entry: RuntimeEntry) => {
      if (controls.object === entry.placement) controls.detach();
      objectLayer.remove(entry.placement);
      disposeObject3D(entry.placement);
    };

    const writeAttachedTransform = () => {
      const attached = controls.object;
      if (!attached) return;
      const objectId = typeof attached.userData.sceneObjectId === "string"
        ? attached.userData.sceneObjectId
        : null;
      if (!objectId) return;
      enforceNonNegativeWorldY(attached);
      if (controls.getMode() === "scale") {
        const record = sceneObjectsRef.current.find((item) => item.id === objectId);
        const uniform = deriveUniformScaleFromAxes(
          attached.scale,
          record?.transform.uniformScale ?? attached.scale.x,
        );
        attached.scale.setScalar(uniform);
      }
      reportObjectTransformRef.current?.(
        objectId,
        worldTransformFromObject3D(attached),
      );
    };

    const syncGizmo = () => {
      const selectedId = selectedObjectIdRef.current;
      const entry = selectedId ? runtime.get(selectedId) : undefined;
      const mode = viewportModeToControlsMode(transformModeRef.current);
      if (controls.getMode() !== mode) controls.setMode(mode);
      if (mode === "translate") controls.setSpace("world");
      if (!entry) {
        if (controls.object) controls.detach();
        return;
      }
      const target = transformControlsAttachmentTarget(entry);
      if (controls.object !== target) controls.attach(target);
    };

    const syncSceneObjects = () => {
      const current = sceneObjectsRef.current;
      const seen = new Set<string>();
      for (const record of current) {
        seen.add(record.id);
        let entry = runtime.get(record.id);
        if (!entry) {
          const root = createSceneObjectRoot();
          const created: RuntimeEntry = {
            id: record.id,
            kind: record.kind,
            objectUrl: record.objectUrl,
            placement: root.placement,
            autoBounds: root.autoBounds,
            loadToken: 0,
          };
          tagSceneObjectRoot(created.placement, record.id);
          objectLayer.add(created.placement);
          runtime.set(record.id, created);
          entry = created;
          if (record.kind === "test_cube") {
            attachNormalizedObject(created.autoBounds, createTestCubeMesh());
          } else if (record.objectUrl) {
            const loadToken = ++created.loadToken;
            const objectUrl = record.objectUrl;
            void loadGlbFromUrl(objectUrl).then((loaded) => {
              if (disposed || runtime.get(record.id)?.loadToken !== loadToken) {
                if (loaded.ok) disposeObject3D(loaded.scene);
                return;
              }
              if (!loaded.ok) {
                console.warn(
                  "[V2-S3E] GLB load failed",
                  record.id,
                  loaded.message,
                );
                reportLoadStatusRef.current?.(
                  record.id,
                  "failed",
                  loaded.message,
                );
                return;
              }
              attachNormalizedObject(created.autoBounds, loaded.scene);
              reportLoadStatusRef.current?.(record.id, "loaded", null);
            });
          }
        }
        const skipStateWrite =
          (gizmoDragging || bodyDrag?.active === true) &&
          (record.id === selectedObjectIdRef.current ||
            record.id === bodyDrag?.objectId);
        if (
          !skipStateWrite &&
          !objectMatchesWorldTransform(entry.placement, record.transform)
        ) {
          applyWorldTransform(entry.placement, record.transform);
        }
        enforceNonNegativeWorldY(entry.placement);
        if (bodyDrag?.active && record.id === bodyDrag.objectId) {
          entry.placement.position.y = bodyDrag.placementY;
        }
      }
      for (const [id, entry] of runtime) {
        if (seen.has(id)) continue;
        entry.loadToken += 1;
        runtime.delete(id);
        removeEntry(entry);
      }
      if (bodyDrag && !runtime.has(bodyDrag.objectId)) {
        endBodyDrag();
      }
      syncGizmo();
    };

    const pickHitsAt = (clientX: number, clientY: number) => {
      const ndc = pointerEventToNdc(
        clientX,
        clientY,
        renderer.domElement.getBoundingClientRect(),
      );
      if (!ndc) return [];
      pointerNdc.set(ndc.x, ndc.y);
      raycaster.setFromCamera(pointerNdc, result.camera);
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
      raycaster.setFromCamera(pointerNdc, result.camera);
      return intersectRayWithHorizontalPlane(raycaster.ray, planeY);
    };

    const releaseBodyDragCapture = (pointerId: number) => {
      try {
        if (renderer.domElement.hasPointerCapture(pointerId)) {
          renderer.domElement.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer already released with the element.
      }
    };

    const endBodyDrag = () => {
      const session = bodyDrag;
      if (!session) {
        controls.enabled = true;
        return;
      }
      bodyDrag = null;
      controls.enabled = true;
      releaseBodyDragCapture(session.pointerId);
      if (!session.active) return;
      const entry = runtime.get(session.objectId);
      if (!entry) return;
      entry.placement.position.y = session.placementY;
      enforceNonNegativeWorldY(entry.placement);
      reportObjectTransformRef.current?.(
        session.objectId,
        worldTransformFromObject3D(entry.placement),
      );
    };

    const applyBodyDragAt = (clientX: number, clientY: number) => {
      const session = bodyDrag;
      if (!session?.active) return;
      const entry = runtime.get(session.objectId);
      if (!entry) {
        endBodyDrag();
        return;
      }
      const hit = planeHitAt(clientX, clientY, session.grabPlaneY);
      if (!hit) return;
      const next = objectBodyDragWorldPosition({
        hitX: hit.x,
        hitZ: hit.z,
        offsetX: session.offsetX,
        offsetZ: session.offsetZ,
        placementY: session.placementY,
      });
      applyPlacementWorldPosition(entry.placement, next);
      entry.placement.position.y = session.placementY;
      reportObjectTransformRef.current?.(
        session.objectId,
        worldTransformFromObject3D(entry.placement),
      );
    };

    const pickFromPointer = (clientX: number, clientY: number) => {
      reportSelectionRef.current?.(pickSceneObjectId(pickHitsAt(clientX, clientY)));
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
      const entry = runtime.get(hitObjectId);
      if (!entry) return;
      const picked = hits.find((item) => resolveSceneObjectId(item.object) === hitObjectId);
      const placementY = entry.placement.position.y;
      const grabPlaneY = picked?.point && Number.isFinite(picked.point.y)
        ? picked.point.y
        : placementY;
      const hit = planeHitAt(event.clientX, event.clientY, grabPlaneY);
      selectedObjectIdRef.current = hitObjectId;
      reportSelectionRef.current?.(hitObjectId);
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
        // Capture is best-effort; pointerup on the canvas still ends the gesture.
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
      pickFromPointer(event.clientX, event.clientY);
    };

    const pointerCancelListener = (event: PointerEvent) => {
      if (bodyDrag && event.pointerId !== bodyDrag.pointerId) return;
      pointerGesture = null;
      endBodyDrag();
    };

    const draggingChangedListener = (event: { value?: unknown }) => {
      gizmoDragging = event.value === true;
      if (gizmoDragging) {
        if (pointerGesture) pointerGesture.pointerDownOnGizmo = true;
        if (bodyDrag) endBodyDrag();
      }
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
      floorSurface.visible = showFloorQuadRef.current;
      floorWireframe.visible = showFloorQuadRef.current;
      syncSceneObjects();
      if (controls.object) enforceNonNegativeWorldY(controls.object);
      renderer.render(scene, result.camera);
    };
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      pointerGesture = null;
      endBodyDrag();
      controls.removeEventListener("dragging-changed", draggingChangedListener);
      controls.removeEventListener("objectChange", objectChangeListener);
      renderer.domElement.removeEventListener("pointerdown", pointerDownListener);
      renderer.domElement.removeEventListener("pointermove", pointerMoveListener);
      renderer.domElement.removeEventListener("pointerup", pointerUpListener);
      renderer.domElement.removeEventListener("pointercancel", pointerCancelListener);
      controls.detach();
      controls.dispose();
      scene.remove(controlsHelper);
      for (const entry of runtime.values()) {
        removeEntry(entry);
      }
      runtime.clear();
      geometry.dispose();
      edgesGeometry.dispose();
      material.dispose();
      edgesMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [floor.referenceDepthM, floor.worldWidthM, snapshot]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black">
      <Image
        src={originalImageUrl}
        alt="Accepted Original room basis"
        fill
        unoptimized
        className="z-0 object-contain"
      />
      <div
        ref={mountRef}
        className="pointer-events-auto absolute inset-0 z-10 bg-transparent"
        aria-label="Read-only calibrated camera realization"
        data-scene-interaction="viewport"
      />
    </div>
  );
}
