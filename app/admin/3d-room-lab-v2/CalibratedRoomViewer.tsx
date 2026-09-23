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
import type { RoomBoundaryWallBaseDiagnostic } from "./room-boundary-authority-contract";
import type {
  RoomCollisionEnabledWall,
  RoomCollisionWallDiagnostic,
} from "./room-collision-authority-contract";
import type { LocalAabb } from "./room-collision-footprint";
import { resolveSceneObjectCollision } from "./scene-collision-resolver";
import {
  canonicalizeObjectWorldTransform,
  realizeCollisionWalls,
  realizeObjectWorldTransform,
  realizeWallBaseDiagnostic,
  realizeCollisionWallDiagnostic,
} from "./scene-metric-world-realization";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  createTestCubeMesh,
  disposeObject3D,
  loadGlbFromUrl,
  measurePlacementLocalAabb,
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
  showWallBoundary: boolean;
  showCollisionBoundary: boolean;
  wallBaseDiagnostics?: readonly RoomBoundaryWallBaseDiagnostic[];
  collisionWallDiagnostics?: readonly RoomCollisionWallDiagnostic[];
  collisionWalls?: readonly RoomCollisionEnabledWall[];
  collisionWallColor?: number;
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
  reportObjectLocalAabb?: (objectId: string, aabb: LocalAabb | null) => void;
  metricScale?: number;
  worldScaleInputCaptured?: boolean;
  reportViewportInteraction?: (active: boolean) => void;
}>;

type RuntimeEntry = {
  id: string;
  kind: SceneObjectRecord["kind"];
  objectUrl: string | null;
  placement: THREE.Group;
  importPlacement: THREE.Group;
  loadToken: number;
  localAabb: LocalAabb | null;
  lastResolved: WorldTransform | null;
};

function applyRealizedCameraPose(
  camera: THREE.PerspectiveCamera,
  snapshot: FrozenV2CameraSnapshot,
  metricScale: number,
): void {
  const scale = Number.isFinite(metricScale) && metricScale > 0 ? metricScale : 1;
  camera.position.set(
    snapshot.pose.position.x * scale,
    snapshot.pose.position.y * scale,
    snapshot.pose.position.z * scale,
  );
  camera.up.set(snapshot.pose.up.x, snapshot.pose.up.y, snapshot.pose.up.z);
  camera.lookAt(
    snapshot.pose.lookAt.x * scale,
    snapshot.pose.lookAt.y * scale,
    snapshot.pose.lookAt.z * scale,
  );
  camera.updateMatrixWorld(true);
}

/**
 * Read-only realization of an already-frozen camera snapshot. It deliberately
 * has no solver, writer, or state callback: replacing the snapshot is the only
 * way to change the rendered camera. Scene objects are a downstream overlay.
 * World Scale updates camera translation in place and must not rebuild this
 * viewer.
 */
export default function CalibratedRoomViewer({
  originalImageUrl,
  camera: snapshot,
  floor,
  showFloorQuad,
  showWallBoundary,
  showCollisionBoundary,
  wallBaseDiagnostics = [],
  collisionWallDiagnostics = [],
  collisionWalls = [],
  collisionWallColor = 0xf43f5e,
  sceneObjects,
  selectedObjectId,
  transformMode,
  reportObjectLoadStatus,
  reportSelection,
  reportObjectTransform,
  reportObjectLocalAabb,
  metricScale = 1,
  worldScaleInputCaptured = false,
  reportViewportInteraction,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const showFloorQuadRef = useRef(showFloorQuad);
  const showWallBoundaryRef = useRef(showWallBoundary);
  const showCollisionBoundaryRef = useRef(showCollisionBoundary);
  const wallBaseDiagnosticsRef = useRef(wallBaseDiagnostics);
  const collisionWallDiagnosticsRef = useRef(collisionWallDiagnostics);
  const collisionWallsRef = useRef(collisionWalls);
  const collisionWallColorRef = useRef(collisionWallColor);
  const sceneObjectsRef = useRef(sceneObjects);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const transformModeRef = useRef(transformMode);
  const reportLoadStatusRef = useRef(reportObjectLoadStatus);
  const reportSelectionRef = useRef(reportSelection);
  const reportObjectTransformRef = useRef(reportObjectTransform);
  const reportObjectLocalAabbRef = useRef(reportObjectLocalAabb);
  const metricScaleRef = useRef(metricScale);
  const worldScaleInputCapturedRef = useRef(worldScaleInputCaptured);
  const reportViewportInteractionRef = useRef(reportViewportInteraction);

  useEffect(() => {
    showFloorQuadRef.current = showFloorQuad;
    showWallBoundaryRef.current = showWallBoundary;
    showCollisionBoundaryRef.current = showCollisionBoundary;
    wallBaseDiagnosticsRef.current = wallBaseDiagnostics;
    collisionWallDiagnosticsRef.current = collisionWallDiagnostics;
    collisionWallsRef.current = collisionWalls;
    collisionWallColorRef.current = collisionWallColor;
    sceneObjectsRef.current = sceneObjects;
    selectedObjectIdRef.current = selectedObjectId;
    transformModeRef.current = transformMode;
    reportLoadStatusRef.current = reportObjectLoadStatus;
    reportSelectionRef.current = reportSelection;
    reportObjectTransformRef.current = reportObjectTransform;
    reportObjectLocalAabbRef.current = reportObjectLocalAabb;
    metricScaleRef.current = metricScale;
    worldScaleInputCapturedRef.current = worldScaleInputCaptured;
    reportViewportInteractionRef.current = reportViewportInteraction;
  }, [
    collisionWallDiagnostics,
    collisionWalls,
    collisionWallColor,
    metricScale,
    reportObjectLoadStatus,
    reportObjectLocalAabb,
    reportObjectTransform,
    reportSelection,
    reportViewportInteraction,
    sceneObjects,
    selectedObjectId,
    showCollisionBoundary,
    showFloorQuad,
    showWallBoundary,
    wallBaseDiagnostics,
    transformMode,
    worldScaleInputCaptured,
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
    applyRealizedCameraPose(result.camera, snapshot, metricScaleRef.current);

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
    const applyFloorMeshScale = (scale: number) => {
      const next = Number.isFinite(scale) && scale > 0 ? scale : 1;
      floorSurface.scale.set(next, next, 1);
      floorWireframe.scale.set(next, next, 1);
    };
    applyFloorMeshScale(metricScaleRef.current);

    const objectLayer = new THREE.Group();
    scene.add(objectLayer);
    const wallBaseLayer = new THREE.Group();
    wallBaseLayer.name = "diagnosticWallBase";
    scene.add(wallBaseLayer);
    const wallBaseMaterial = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95,
    });
    const interiorTickMaterial = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.95,
    });
    const collisionWallLayer = new THREE.Group();
    collisionWallLayer.name = "diagnosticCollisionWall";
    scene.add(collisionWallLayer);
    const collisionWallMaterial = new THREE.LineBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.95,
    });
    const ignoreRaycast = () => {};
    let lastWallBaseDiagnostics: readonly RoomBoundaryWallBaseDiagnostic[] | null =
      null;
    let lastWallBaseMetricScale = Number.NaN;
    const clearWallBaseLayer = () => {
      while (wallBaseLayer.children.length > 0) {
        const child = wallBaseLayer.children[0];
        wallBaseLayer.remove(child);
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
        }
      }
    };
    const syncWallBaseDiagnostics = () => {
      const diagnostics = wallBaseDiagnosticsRef.current;
      const scale = metricScaleRef.current;
      if (
        diagnostics === lastWallBaseDiagnostics &&
        lastWallBaseMetricScale === scale
      ) {
        return;
      }
      lastWallBaseDiagnostics = diagnostics;
      lastWallBaseMetricScale = scale;
      clearWallBaseLayer();
      for (const canonical of diagnostics) {
        const segment = realizeWallBaseDiagnostic(canonical, scale);
        const baseGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(segment.start[0], segment.start[1], segment.start[2]),
          new THREE.Vector3(segment.end[0], segment.end[1], segment.end[2]),
        ]);
        const baseLine = new THREE.Line(baseGeometry, wallBaseMaterial);
        baseLine.raycast = ignoreRaycast;
        wallBaseLayer.add(baseLine);
        if (segment.interiorTick) {
          const tickGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(
              segment.interiorTick.from[0],
              segment.interiorTick.from[1],
              segment.interiorTick.from[2],
            ),
            new THREE.Vector3(
              segment.interiorTick.to[0],
              segment.interiorTick.to[1],
              segment.interiorTick.to[2],
            ),
          ]);
          const tickLine = new THREE.Line(tickGeometry, interiorTickMaterial);
          tickLine.raycast = ignoreRaycast;
          wallBaseLayer.add(tickLine);
        }
      }
    };
    let lastCollisionWallDiagnostics: readonly RoomCollisionWallDiagnostic[] | null =
      null;
    let lastCollisionDiagnosticMetricScale = Number.NaN;
    const clearCollisionWallLayer = () => {
      while (collisionWallLayer.children.length > 0) {
        const child = collisionWallLayer.children[0];
        collisionWallLayer.remove(child);
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
        }
      }
    };
    const syncCollisionWallDiagnostics = () => {
      const diagnostics = collisionWallDiagnosticsRef.current;
      const scale = metricScaleRef.current;
      collisionWallMaterial.color.setHex(collisionWallColorRef.current);
      if (
        diagnostics === lastCollisionWallDiagnostics &&
        lastCollisionDiagnosticMetricScale === scale
      ) {
        return;
      }
      lastCollisionWallDiagnostics = diagnostics;
      lastCollisionDiagnosticMetricScale = scale;
      clearCollisionWallLayer();
      for (const canonical of diagnostics) {
        const segment = realizeCollisionWallDiagnostic(canonical, scale);
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(segment.start[0], segment.start[1], segment.start[2]),
          new THREE.Vector3(segment.end[0], segment.end[1], segment.end[2]),
        ]);
        const line = new THREE.Line(geometry, collisionWallMaterial);
        line.raycast = ignoreRaycast;
        collisionWallLayer.add(line);
      }
    };
    const cacheEntryBounds = (entry: RuntimeEntry) => {
      entry.localAabb = measurePlacementLocalAabb(entry.placement, entry.importPlacement);
      reportObjectLocalAabbRef.current?.(entry.id, entry.localAabb);
    };
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

    const realizedCollisionWalls = () =>
      realizeCollisionWalls(collisionWallsRef.current, metricScaleRef.current);

    const reportCanonicalTransform = (
      objectId: string,
      realized: WorldTransform,
    ) => {
      reportObjectTransformRef.current?.(
        objectId,
        canonicalizeObjectWorldTransform(realized, metricScaleRef.current),
      );
    };

    const reportViewportInteraction = (active: boolean) => {
      reportViewportInteractionRef.current?.(active);
    };

    const syncControlsEnabled = () => {
      controls.enabled = !worldScaleInputCapturedRef.current && !bodyDrag;
    };

    // Collision kernel walls: collisionWallsRef.current realized after
    // the host's active wall selection. Qualification receipts stay canonical.

    const writeAttachedTransform = () => {
      const attached = controls.object;
      if (!attached) return;
      const objectId = typeof attached.userData.sceneObjectId === "string"
        ? attached.userData.sceneObjectId
        : null;
      if (!objectId) return;
      const entry = runtime.get(objectId);
      enforceNonNegativeWorldY(attached);
      if (controls.getMode() === "scale") {
        const record = sceneObjectsRef.current.find((item) => item.id === objectId);
        const uniform = deriveUniformScaleFromAxes(
          attached.scale,
          record?.transform.uniformScale ?? attached.scale.x,
        );
        attached.scale.setScalar(uniform);
      }
      const proposed = worldTransformFromObject3D(attached);
      const current = entry?.lastResolved ??
        realizeObjectWorldTransform(
          sceneObjectsRef.current.find((item) => item.id === objectId)?.transform ??
            proposed,
          metricScaleRef.current,
        );
      const resolved = resolveSceneObjectCollision({
        current,
        proposed,
        localAabb: entry?.localAabb ?? null,
        walls: realizedCollisionWalls(),
        mode: controls.getMode() === "translate" ? "move" : "pose",
      });
      applyWorldTransform(attached, resolved.transform);
      if (entry) entry.lastResolved = resolved.transform;
      reportCanonicalTransform(objectId, resolved.transform);
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
            importPlacement: root.importPlacement,
            loadToken: 0,
            localAabb: null,
            lastResolved: realizeObjectWorldTransform(
              record.transform,
              metricScaleRef.current,
            ),
          };
          tagSceneObjectRoot(created.placement, record.id);
          objectLayer.add(created.placement);
          runtime.set(record.id, created);
          entry = created;
          if (record.kind === "test_cube") {
            attachImportedObject(created.importPlacement, createTestCubeMesh());
            cacheEntryBounds(created);
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
              attachImportedObject(created.importPlacement, loaded.scene);
              cacheEntryBounds(created);
              reportLoadStatusRef.current?.(record.id, "loaded", null);
            });
          }
        }
        const skipStateWrite =
          (gizmoDragging || bodyDrag?.active === true) &&
          (record.id === selectedObjectIdRef.current ||
            record.id === bodyDrag?.objectId);
        const realizedTransform = realizeObjectWorldTransform(
          record.transform,
          metricScaleRef.current,
        );
        if (
          !skipStateWrite &&
          !objectMatchesWorldTransform(entry.placement, realizedTransform)
        ) {
          applyWorldTransform(entry.placement, realizedTransform);
          entry.lastResolved = realizedTransform;
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
        syncControlsEnabled();
        return;
      }
      bodyDrag = null;
      syncControlsEnabled();
      reportViewportInteraction(gizmoDragging);
      releaseBodyDragCapture(session.pointerId);
      if (!session.active) return;
      const entry = runtime.get(session.objectId);
      if (!entry) return;
      entry.placement.position.y = session.placementY;
      enforceNonNegativeWorldY(entry.placement);
      reportCanonicalTransform(
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
      const current = entry.lastResolved ?? worldTransformFromObject3D(entry.placement);
      const proposed = {
        ...current,
        position: {
          x: next.x,
          y: session.placementY,
          z: next.z,
        },
      };
      const resolved = resolveSceneObjectCollision({
        current,
        proposed,
        localAabb: entry.localAabb,
        walls: realizedCollisionWalls(),
        mode: "move",
      });
      applyPlacementWorldPosition(entry.placement, {
        x: resolved.transform.position.x,
        y: session.placementY,
        z: resolved.transform.position.z,
      });
      entry.placement.position.y = session.placementY;
      entry.lastResolved = {
        ...resolved.transform,
        position: {
          ...resolved.transform.position,
          y: session.placementY,
        },
      };
      reportCanonicalTransform(session.objectId, entry.lastResolved);
    };

    const pickFromPointer = (clientX: number, clientY: number) => {
      reportSelectionRef.current?.(pickSceneObjectId(pickHitsAt(clientX, clientY)));
    };

    const pointerDownListener = (event: PointerEvent) => {
      if (event.isPrimary === false) return;
      if (worldScaleInputCapturedRef.current) {
        pointerGesture = {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerDownOnGizmo: true,
        };
        return;
      }
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
        reportViewportInteraction(true);
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
        reportViewportInteraction(true);
      } else {
        reportViewportInteraction(bodyDrag?.active === true);
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
      applyFloorMeshScale(metricScaleRef.current);
      applyRealizedCameraPose(result.camera, snapshot, metricScaleRef.current);
      syncControlsEnabled();
      floorSurface.visible = showFloorQuadRef.current;
      floorWireframe.visible = showFloorQuadRef.current;
      wallBaseLayer.visible = showWallBoundaryRef.current;
      collisionWallLayer.visible = showCollisionBoundaryRef.current;
      syncWallBaseDiagnostics();
      syncCollisionWallDiagnostics();
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
      clearWallBaseLayer();
      clearCollisionWallLayer();
      wallBaseMaterial.dispose();
      interiorTickMaterial.dispose();
      collisionWallMaterial.dispose();
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
