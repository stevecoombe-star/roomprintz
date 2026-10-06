import * as THREE from "three";

/**
 * LIGHT-1 STAGE grounding.
 *
 * Production STAGE draws one local contact card under each furniture root.
 * Directional cast shadows stay in this module for a later rig, and the
 * production path does not enable them.
 *
 * The photographed room stays an HTML image behind the canvas. This module
 * does not read or persist lighting.
 */

export const STAGE_LIGHTING_VISUAL = "stageLightingVisual";
export const STAGE_CONTACT_SHADOW_NAME = "stage-contact-shadow";

export const STAGE_LIGHTING_V1 = {
  ambientColor: 0xffffff,
  ambientIntensity: 0.8,
  mainLightColor: 0xffffff,
  mainLightIntensity: 1,
  mainLightPosition: { x: 3, y: 6, z: 5 },
  shadowOpacity: 0.42,
  shadowMapSize: 2048,
  shadowBias: -0.0002,
  shadowNormalBias: 0.035,
  shadowRadius: 2.5,
  shadowCameraPaddingM: 0.75,
  shadowVolumeHeightM: 2.5,
  receiverLiftM: 0.003,
  contactShadowOpacity: 0.34,
  contactShadowSoftness: 0.42,
  contactLiftM: 0.008,
} as const;

export type StageShadowFloor = Readonly<{
  worldWidthM: number;
  referenceDepthM: number;
}>;

export type StageContactFootprint = Readonly<{
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
  /** Placement-local base of the rendered mesh. */
  baseY: number;
  /** Parent yaw carries rotation. The footprint stays in placement-local space. */
  rotationY: 0;
}>;

type ShadowRenderer = {
  shadowMap: {
    enabled: boolean;
    type: THREE.ShadowMapType;
  };
};

export type StageContactResources = Readonly<{
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
  texture: THREE.DataTexture;
}>;

export type StageLightingRig = Readonly<{
  mainLight: THREE.DirectionalLight;
  contactResources: StageContactResources;
  /** Directional cast shadows are off. Kept so Room Scale can call a stable hook. */
  syncWorld: (world: { floor: StageShadowFloor }) => void;
  dispose: () => void;
}>;

export function isStageLightingVisual(object: THREE.Object3D): boolean {
  return object.userData[STAGE_LIGHTING_VISUAL] === true;
}

export function enableFurnitureShadowFlags(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((child) => {
    if (isStageLightingVisual(child)) return;
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh !== true) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    count += 1;
  });
  return count;
}

export function contactShadowFootprint(
  aabb: Readonly<{
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  }> | null | undefined,
): StageContactFootprint | null {
  if (!aabb) return null;
  const width = aabb.max.x - aabb.min.x;
  const depth = aabb.max.z - aabb.min.z;
  const centerX = (aabb.min.x + aabb.max.x) / 2;
  const centerZ = (aabb.min.z + aabb.max.z) / 2;
  if (!(width > 0) || !(depth > 0)) return null;
  if (![
    width,
    depth,
    centerX,
    centerZ,
    aabb.min.y,
  ].every(Number.isFinite)) {
    return null;
  }
  const softness = 1 + STAGE_LIGHTING_V1.contactShadowSoftness;
  return {
    width: width * softness,
    depth: depth * softness,
    centerX,
    centerZ,
    baseY: aabb.min.y,
    rotationY: 0,
  };
}

export function stageShadowFrustumRadius(floor: StageShadowFloor): number {
  const pad = STAGE_LIGHTING_V1.shadowCameraPaddingM;
  const halfW = floor.worldWidthM / 2 + pad;
  const halfD = floor.referenceDepthM / 2 + pad;
  const halfH = STAGE_LIGHTING_V1.shadowVolumeHeightM / 2;
  return Math.hypot(halfW, halfD, halfH);
}

export function applyDirectionalShadowFit(
  light: THREE.DirectionalLight,
  floor: StageShadowFloor,
): number {
  const radius = stageShadowFrustumRadius(floor);
  light.target.position.set(0, 0, 0);
  light.target.updateWorldMatrix(true, true);
  const distance = light.position.distanceTo(light.target.position);
  const camera = light.shadow.camera;
  camera.left = -radius;
  camera.right = radius;
  camera.top = radius;
  camera.bottom = -radius;
  camera.near = Math.max(0.05, distance - radius);
  camera.far = distance + radius;
  camera.updateProjectionMatrix();
  light.shadow.mapSize.set(
    STAGE_LIGHTING_V1.shadowMapSize,
    STAGE_LIGHTING_V1.shadowMapSize,
  );
  light.shadow.bias = STAGE_LIGHTING_V1.shadowBias;
  light.shadow.normalBias = STAGE_LIGHTING_V1.shadowNormalBias;
  light.shadow.radius = STAGE_LIGHTING_V1.shadowRadius;
  return radius;
}

export function configureStageRendererShadows(renderer: ShadowRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

function markVisual(object: THREE.Object3D): void {
  object.userData[STAGE_LIGHTING_VISUAL] = true;
  object.castShadow = false;
  object.frustumCulled = true;
}

function disableRaycast(mesh: THREE.Mesh): void {
  mesh.raycast = () => undefined;
}

/** Normalized contact alpha. UV ±1 is the softened card; the inner box is the AABB. */
export function contactShadowFalloff(u: number, v: number): number {
  const inner = 1 / (1 + STAGE_LIGHTING_V1.contactShadowSoftness);
  const ax = Math.abs(u);
  const ay = Math.abs(v);
  if (ax >= 1 || ay >= 1) return 0;
  if (ax <= inner && ay <= inner) return 1;
  const margin = 1 - inner;
  const dist = Math.hypot(Math.max(0, ax - inner), Math.max(0, ay - inner)) / margin;
  const alpha = dist >= 1 ? 0 : 1 - dist;
  return alpha * alpha * (3 - 2 * alpha);
}

function createContactTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const index = (y * size + x) * 4;
      data[index + 3] = Math.round(contactShadowFalloff(u, v) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createStageContactResources(): StageContactResources {
  const texture = createContactTexture();
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: STAGE_LIGHTING_V1.contactShadowOpacity,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  return {
    geometry: new THREE.PlaneGeometry(1, 1),
    material,
    texture,
  };
}

function findContactShadow(placement: THREE.Object3D): THREE.Mesh | null {
  const child = placement.children.find((entry) => entry.name === STAGE_CONTACT_SHADOW_NAME);
  return child instanceof THREE.Mesh ? child : null;
}

export function syncStageContactShadow(
  placement: THREE.Object3D,
  aabb: Parameters<typeof contactShadowFootprint>[0],
  resources: StageContactResources,
): THREE.Mesh | null {
  const footprint = contactShadowFootprint(aabb);
  let mesh = findContactShadow(placement);
  if (!footprint) {
    if (mesh) mesh.visible = false;
    return mesh;
  }
  if (!mesh) {
    mesh = new THREE.Mesh(resources.geometry, resources.material);
    mesh.name = STAGE_CONTACT_SHADOW_NAME;
    markVisual(mesh);
    mesh.receiveShadow = false;
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    disableRaycast(mesh);
    placement.add(mesh);
  }
  mesh.visible = true;
  mesh.position.set(
    footprint.centerX,
    footprint.baseY + STAGE_LIGHTING_V1.contactLiftM,
    footprint.centerZ,
  );
  mesh.scale.set(footprint.width, footprint.depth, 1);
  mesh.rotation.y = footprint.rotationY;
  return mesh;
}

export function detachStageContactShadow(placement: THREE.Object3D): void {
  const mesh = findContactShadow(placement);
  if (!mesh) return;
  placement.remove(mesh);
}

export function createStageLightingRig(input: {
  scene: THREE.Scene;
  renderer: ShadowRenderer;
  /** Existing production key light. Contact grounding does not turn it into a caster. */
  mainLight: THREE.DirectionalLight;
}): StageLightingRig {
  const mainLight = input.mainLight;
  mainLight.castShadow = false;
  input.renderer.shadowMap.enabled = false;
  const contactResources = createStageContactResources();

  return {
    mainLight,
    contactResources,
    syncWorld() {
      mainLight.castShadow = false;
      input.renderer.shadowMap.enabled = false;
    },
    dispose() {
      mainLight.castShadow = false;
      input.renderer.shadowMap.enabled = false;
      contactResources.geometry.dispose();
      contactResources.material.dispose();
      contactResources.texture.dispose();
    },
  };
}
