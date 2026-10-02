import * as THREE from "three";

import { parseFurnitureGlb } from "@/lib/afc-v2-runtime/furniture-glb-loader";
import {
  VIBODE_PRODUCTION_AMBIENT_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_POSITION,
  VIBODE_PRODUCTION_LIGHT_COLOR,
  VIBODE_THUMBNAIL_RENDERER_DPR,
} from "@/lib/vibode-thumbnail-render/still-renderer";

import {
  VIBODE_MODEL_THUMBNAIL_CLEAR_COLOR,
  VIBODE_MODEL_THUMBNAIL_EDGE_PX,
  frameModelThumbnail,
} from "./frame";

const createdObjectUrls: string[] = [];
let objectUrlDepth = 0;
let originalCreateObjectUrl: typeof URL.createObjectURL | null = null;

function trackObjectUrls(): void {
  if (objectUrlDepth === 0) {
    originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = ((object: Blob | MediaSource) => {
      const url = originalCreateObjectUrl!(object);
      createdObjectUrls.push(url);
      return url;
    }) as typeof URL.createObjectURL;
  }
  objectUrlDepth += 1;
}

function releaseTrackedObjectUrls(): void {
  objectUrlDepth = Math.max(0, objectUrlDepth - 1);
  if (objectUrlDepth > 0 || !originalCreateObjectUrl) return;
  URL.createObjectURL = originalCreateObjectUrl;
  originalCreateObjectUrl = null;
  while (createdObjectUrls.length > 0) {
    const url = createdObjectUrls.pop();
    if (url) URL.revokeObjectURL(url);
  }
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const withGeometry = node as THREE.Object3D & { geometry?: THREE.BufferGeometry };
    if (withGeometry.geometry) geometries.add(withGeometry.geometry);
    const withMaterial = node as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    const list = withMaterial.material == null
      ? []
      : Array.isArray(withMaterial.material)
        ? withMaterial.material
        : [withMaterial.material];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export async function renderModelThumbnailPng(glb: ArrayBuffer): Promise<Blob> {
  trackObjectUrls();
  let scene: THREE.Object3D | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    const parsed = await parseFurnitureGlb(glb.slice(0));
    if (!parsed.ok) throw new Error(parsed.message);
    scene = parsed.scene;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    if (box.isEmpty()) throw new Error("Model has no visible bounds.");
    const framed = frameModelThumbnail({
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    });
    if (!framed.ok) throw new Error(framed.reason);
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(VIBODE_THUMBNAIL_RENDERER_DPR);
    renderer.setSize(VIBODE_MODEL_THUMBNAIL_EDGE_PX, VIBODE_MODEL_THUMBNAIL_EDGE_PX, false);
    renderer.setClearColor(VIBODE_MODEL_THUMBNAIL_CLEAR_COLOR, 1);
    const camera = new THREE.PerspectiveCamera(
      framed.camera.verticalFovDeg,
      1,
      framed.camera.near,
      framed.camera.far,
    );
    camera.position.set(
      framed.camera.position.x,
      framed.camera.position.y,
      framed.camera.position.z,
    );
    camera.up.set(framed.camera.up.x, framed.camera.up.y, framed.camera.up.z);
    camera.lookAt(framed.camera.lookAt.x, framed.camera.lookAt.y, framed.camera.lookAt.z);
    const ambient = new THREE.AmbientLight(
      VIBODE_PRODUCTION_LIGHT_COLOR,
      VIBODE_PRODUCTION_AMBIENT_INTENSITY,
    );
    const directional = new THREE.DirectionalLight(
      VIBODE_PRODUCTION_LIGHT_COLOR,
      VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
    );
    directional.position.set(
      framed.center.x + VIBODE_PRODUCTION_DIRECTIONAL_POSITION.x,
      framed.center.y + VIBODE_PRODUCTION_DIRECTIONAL_POSITION.y,
      framed.center.z + VIBODE_PRODUCTION_DIRECTIONAL_POSITION.z,
    );
    scene.add(ambient, directional);
    renderer.render(scene, camera);
    const blob = await new Promise<Blob>((resolve, reject) => {
      renderer?.domElement.toBlob((value) => {
        if (value && value.size > 0) resolve(value);
        else reject(new Error("Thumbnail image could not be encoded."));
      }, "image/png");
    });
    return blob;
  } finally {
    if (scene) disposeObject(scene);
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.width = 1;
      renderer.domElement.height = 1;
      renderer.domElement.remove();
    }
    releaseTrackedObjectUrls();
  }
}
