/**
 * Isolated GLB preview for the furniture generator.
 *
 * The preview loads its own object. It does not receive the STAGE scene,
 * camera, selection, or undo stack. Save stays disabled until a future
 * trusted finalization path exists. MESHY-1B never treats the bundled
 * fixture as a generated candidate.
 */

import * as THREE from "three";

import { parseFurnitureGlb } from "@/lib/afc-v2-runtime/furniture-glb-loader";

export const FURNITURE_PREVIEW_FIXTURE_URL =
  "/afc-v2-runtime/test-fixtures/pi5d-lounge-chair.glb";

export const FURNITURE_PREVIEW_FIXTURE_DETAIL =
  "Bundled STAGE chair. Meshy did not generate this model.";

const PREVIEW_FOV_DEG = 35;
const PREVIEW_PHI_MIN = 0.18;
const PREVIEW_PHI_MAX = Math.PI - 0.18;

export type GlbPreviewRequest =
  | Readonly<{ kind: "fixture"; label: string }>
  | Readonly<{ kind: "library"; label: string; url: string; assetId: string }>
  | Readonly<{ kind: "candidate"; label: string; url: string }>;

export type PreviewModalState =
  | Readonly<{ open: false; session: number }>
  | Readonly<{ open: true; session: number; request: GlbPreviewRequest }>;

export type GroundedFurnitureBounds = Readonly<{
  widthM: number;
  depthM: number;
  heightM: number;
  minY: number;
  centerX: number;
  centerZ: number;
}>;

export type PreviewVec3 = Readonly<{ x: number; y: number; z: number }>;

export type PreviewOrbit = Readonly<{
  theta: number;
  phi: number;
  distance: number;
}>;

export type PreviewCameraPose = Readonly<{
  target: PreviewVec3;
  position: PreviewVec3;
  near: number;
  far: number;
  theta: number;
  phi: number;
  distance: number;
}>;

export type PreviewOrbitLimits = Readonly<{
  minDistance: number;
  maxDistance: number;
  minPhi: number;
  maxPhi: number;
}>;

export function closedPreviewModal(): PreviewModalState {
  return { open: false, session: 0 };
}

export function openGlbPreview(
  state: PreviewModalState,
  request: GlbPreviewRequest,
): PreviewModalState {
  return { open: true, session: state.session + 1, request };
}

export function closeGlbPreview(state: PreviewModalState): PreviewModalState {
  return { open: false, session: state.session };
}

export function previewLoadPlan(request: GlbPreviewRequest):
  | Readonly<{ action: "load"; url: string }>
  | Readonly<{ action: "refuse"; message: string }> {
  if (request.kind === "fixture") {
    return { action: "load", url: FURNITURE_PREVIEW_FIXTURE_URL };
  }
  if (request.kind === "candidate") {
    if (!isAuthorizedPreviewUrl(request.url) || isProviderAssetPreviewUrl(request.url)) {
      return { action: "refuse", message: "This preview link cannot be opened." };
    }
    return { action: "load", url: request.url };
  }
  if (!isAuthorizedPreviewUrl(request.url)) {
    return { action: "refuse", message: "This preview link cannot be opened." };
  }
  return { action: "load", url: request.url };
}

/**
 * Save is a later trusted-server step. The client cannot enable it.
 */
export function previewSaveState(request: GlbPreviewRequest | null): Readonly<{
  shown: boolean;
  enabled: false;
  reason: string;
}> {
  if (request?.kind === "candidate") {
    return {
      shown: true,
      enabled: false,
      reason: "Saving a generated model waits for a trusted finalization path.",
    };
  }
  return {
    shown: false,
    enabled: false,
    reason: "Only a trusted generated model can be saved.",
  };
}

export function previewCopy(request: GlbPreviewRequest): Readonly<{
  title: string;
  detail: string;
}> {
  if (request.kind === "fixture") {
    return { title: "Local test fixture", detail: FURNITURE_PREVIEW_FIXTURE_DETAIL };
  }
  if (request.kind === "library") {
    return {
      title: request.label,
      detail: "From My Furniture. This preview does not change the room.",
    };
  }
  return {
    title: request.label,
    detail: "Generated model. These dimensions are uncalibrated measurements from the file, not verified product sizes. Saving and real-world calibration wait for a later step.",
  };
}

function isProviderAssetPreviewUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "meshy.ai" || host.endsWith(".meshy.ai");
  } catch {
    return true;
  }
}

export function isAuthorizedPreviewUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === "https:") return true;
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  return parsed.protocol === "http:" && local;
}

export async function readPreviewGlb(bytes: ArrayBuffer): Promise<
  | Readonly<{ ok: true; scene: THREE.Group; bounds: GroundedFurnitureBounds }>
  | Readonly<{ ok: false; message: string }>
> {
  const parsed = await parseFurnitureGlb(bytes);
  if (!parsed.ok) return { ok: false, message: "This file isn't a supported GLB." };
  const bounds = groundAlignPreviewModel(parsed.scene);
  if (
    !Number.isFinite(bounds.widthM) ||
    !Number.isFinite(bounds.heightM) ||
    !Number.isFinite(bounds.depthM) ||
    bounds.widthM <= 0 ||
    bounds.heightM <= 0 ||
    bounds.depthM <= 0
  ) {
    disposePreviewObject(parsed.scene);
    return { ok: false, message: "The model has no measurable size." };
  }
  return { ok: true, scene: parsed.scene, bounds };
}

export function groundAlignPreviewModel(root: THREE.Object3D): GroundedFurnitureBounds {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x += -center.x;
  root.position.y += -box.min.y;
  root.position.z += -center.z;
  root.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(root);
  const size = grounded.getSize(new THREE.Vector3());
  const groundedCenter = grounded.getCenter(new THREE.Vector3());
  return {
    widthM: size.x,
    heightM: size.y,
    depthM: size.z,
    minY: grounded.min.y,
    centerX: groundedCenter.x,
    centerZ: groundedCenter.z,
  };
}

export function formatFurnitureDimensions(bounds: Readonly<{
  widthM: number;
  depthM: number;
  heightM: number;
}>): string {
  return formatPreviewDimensions(bounds, 2);
}

export function formatGeneratedDimensions(bounds: Readonly<{
  widthM: number;
  depthM: number;
  heightM: number;
}>): string {
  return formatPreviewDimensions(bounds, 3);
}

function formatPreviewDimensions(bounds: Readonly<{
  widthM: number;
  depthM: number;
  heightM: number;
}>, digits: number): string {
  const metres = (value: number) => `${value.toFixed(digits)} m`;
  return `${metres(bounds.widthM)} wide · ${metres(bounds.depthM)} deep · ${metres(bounds.heightM)} high`;
}

export function previewOrbitLimits(bounds: Readonly<{
  widthM: number;
  heightM: number;
  depthM: number;
}>): PreviewOrbitLimits {
  const radius = Math.max(0.05, 0.5 * Math.hypot(bounds.widthM, bounds.heightM, bounds.depthM));
  return {
    minDistance: Math.max(0.2, radius * 1.15),
    maxDistance: radius * 12,
    minPhi: PREVIEW_PHI_MIN,
    maxPhi: PREVIEW_PHI_MAX,
  };
}

export function initialPreviewCamera(bounds: Readonly<{
  widthM: number;
  heightM: number;
  depthM: number;
}>, aspect: number): PreviewCameraPose {
  const limits = previewOrbitLimits(bounds);
  const radius = Math.max(0.05, 0.5 * Math.hypot(bounds.widthM, bounds.heightM, bounds.depthM));
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 1;
  const halfV = (PREVIEW_FOV_DEG * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(halfV) * safeAspect);
  const limiting = Math.max(0.05, Math.min(halfV, halfH));
  const fitted = (radius / Math.sin(limiting)) * 1.12;
  const orbit = clampPreviewOrbit(
    { theta: 0.55, phi: 1.02, distance: fitted },
    limits,
  );
  const target = { x: 0, y: bounds.heightM / 2, z: 0 };
  const position = orbitPreviewPosition(target, orbit);
  return {
    target,
    position,
    near: previewNear(orbit.distance),
    far: previewFar(orbit.distance),
    ...orbit,
  };
}

export function clampPreviewOrbit(
  orbit: PreviewOrbit,
  limits: PreviewOrbitLimits,
): PreviewOrbit {
  return {
    theta: orbit.theta,
    phi: clamp(orbit.phi, limits.minPhi, limits.maxPhi),
    distance: clamp(orbit.distance, limits.minDistance, limits.maxDistance),
  };
}

export function orbitPreviewPosition(target: PreviewVec3, orbit: PreviewOrbit): PreviewVec3 {
  const sinPhi = Math.sin(orbit.phi);
  return {
    x: target.x + orbit.distance * sinPhi * Math.sin(orbit.theta),
    y: target.y + orbit.distance * Math.cos(orbit.phi),
    z: target.z + orbit.distance * sinPhi * Math.cos(orbit.theta),
  };
}

export function nudgePreviewOrbit(
  orbit: PreviewOrbit,
  key: string,
  limits: PreviewOrbitLimits,
): PreviewOrbit | null {
  if (key === "ArrowLeft") return clampPreviewOrbit({ ...orbit, theta: orbit.theta - 0.12 }, limits);
  if (key === "ArrowRight") return clampPreviewOrbit({ ...orbit, theta: orbit.theta + 0.12 }, limits);
  if (key === "ArrowUp") return clampPreviewOrbit({ ...orbit, phi: orbit.phi - 0.08 }, limits);
  if (key === "ArrowDown") return clampPreviewOrbit({ ...orbit, phi: orbit.phi + 0.08 }, limits);
  if (key === "+" || key === "=") {
    return clampPreviewOrbit({ ...orbit, distance: orbit.distance * 0.9 }, limits);
  }
  if (key === "-" || key === "_") {
    return clampPreviewOrbit({ ...orbit, distance: orbit.distance * 1.1 }, limits);
  }
  return null;
}

export function previewNear(distance: number): number {
  return Math.max(0.01, distance / 80);
}

export function previewFar(distance: number): number {
  return Math.max(10, distance * 12);
}

export function disposePreviewObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      if (materials.has(item)) continue;
      materials.add(item);
      disposeMaterialTextures(item);
      item.dispose();
    }
  });
}

export function cycleFocusableIndex(current: number, count: number, reverse: boolean): number {
  if (count <= 0) return 0;
  const step = reverse ? -1 : 1;
  return (current + step + count) % count;
}

export type PreviewKeyboardAction = {
  stopPropagation: true;
  preventDefault: boolean;
  close: boolean;
  nextFocusIndex: number | null;
};

/**
 * Every key is kept inside the preview while it is open. The underlying STAGE
 * listeners stay on the window bubble path, so stopping propagation here is
 * what keeps Shift, Escape, and editing shortcuts away from the room.
 */
export function previewKeyboardAction(input: {
  key: string;
  shiftKey: boolean;
  nudged: boolean;
  focusIndex: number;
  focusCount: number;
}): PreviewKeyboardAction {
  if (input.key === "Escape") {
    return { stopPropagation: true, preventDefault: true, close: true, nextFocusIndex: null };
  }
  if (input.nudged) {
    return { stopPropagation: true, preventDefault: true, close: false, nextFocusIndex: null };
  }
  if (input.key === "Tab" && input.focusCount > 0) {
    const nextFocusIndex = cycleFocusableIndex(
      input.focusIndex < 0
        ? (input.shiftKey ? 0 : input.focusCount - 1)
        : input.focusIndex,
      input.focusCount,
      input.shiftKey,
    );
    const leavingEnds = input.shiftKey
      ? input.focusIndex <= 0
      : input.focusIndex === input.focusCount - 1 || input.focusIndex < 0;
    if (leavingEnds) {
      return { stopPropagation: true, preventDefault: true, close: false, nextFocusIndex };
    }
  }
  return { stopPropagation: true, preventDefault: false, close: false, nextFocusIndex: null };
}

const TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "aoMap",
  "alphaMap",
  "bumpMap",
  "lightMap",
] as const;

function disposeMaterialTextures(material: THREE.Material): void {
  const record = material as THREE.Material & Partial<Record<(typeof TEXTURE_KEYS)[number], THREE.Texture | null>>;
  for (const key of TEXTURE_KEYS) {
    const texture = record[key];
    if (texture) texture.dispose();
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
