import * as THREE from "three";

import type { RealizedFrozenCamera } from "@/lib/afc-v2-runtime/types";
import {
  HarmonizeExportError,
  harmonizeScaleRefusal,
  requireHarmonizePixelFrame,
} from "@/lib/vibode-stage/harmonize-export";
import { STAGE_CONTACT_SHADOW_NAME } from "@/lib/vibode-stage/stage-lighting";

const CAMERA_EPSILON = 1e-4;
export const HARMONIZE_TRUSTED_PATH_NAME = "trusted-path";

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= CAMERA_EPSILON;
}

export function stageCameraMatchesRealized(
  camera: THREE.PerspectiveCamera,
  realized: RealizedFrozenCamera,
): boolean {
  const frame = requireHarmonizePixelFrame(
    realized == null ? undefined : realized.frame,
    "Certified camera frame is missing from the STAGE scene. Export stopped instead of scaling.",
  );
  camera.updateMatrixWorld(true);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const expected = new THREE.Vector3(
    realized.pose.lookAt.x - realized.pose.position.x,
    realized.pose.lookAt.y - realized.pose.position.y,
    realized.pose.lookAt.z - realized.pose.position.z,
  );
  if (expected.lengthSq() <= 1e-12) return false;
  expected.normalize();
  return close(camera.fov, realized.verticalFovDeg)
    && close(camera.aspect, frame.width / frame.height)
    && close(camera.near, realized.near)
    && close(camera.far, realized.far)
    && close(camera.position.x, realized.pose.position.x)
    && close(camera.position.y, realized.pose.position.y)
    && close(camera.position.z, realized.pose.position.z)
    && close(camera.up.x, realized.pose.up.x)
    && close(camera.up.y, realized.pose.up.y)
    && close(camera.up.z, realized.pose.up.z)
    && direction.distanceTo(expected) <= 1e-3;
}

export function collectHarmonizeHiddenObjects(
  root: THREE.Object3D,
  extras: readonly THREE.Object3D[],
): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  const seen = new Set<THREE.Object3D>();
  const add = (object: THREE.Object3D | null | undefined) => {
    if (!object || seen.has(object)) return;
    seen.add(object);
    found.push(object);
  };
  for (const extra of extras) add(extra);
  root.traverse((object) => {
    if (
      object.name === STAGE_CONTACT_SHADOW_NAME
      || object.name === HARMONIZE_TRUSTED_PATH_NAME
    ) {
      add(object);
    }
  });
  return found;
}

export function withHarmonizeVisibilityIsolation<T>(
  objects: readonly THREE.Object3D[],
  run: () => T,
): T {
  const previous = objects.map((object) => object.visible);
  try {
    for (const object of objects) object.visible = false;
    return run();
  } finally {
    objects.forEach((object, index) => {
      object.visible = previous[index] ?? true;
    });
  }
}

export function flipRgbaRows(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 4;
  if (pixels.length !== rowBytes * height) {
    throw new HarmonizeExportError(
      "Furniture render size does not match the viewport background. Export stopped instead of scaling.",
    );
  }
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * rowBytes;
    out.set(pixels.subarray(source, source + rowBytes), y * rowBytes);
  }
  return out;
}

export function renderHarmonizeFurniturePixels(input: Readonly<{
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  hidden: readonly THREE.Object3D[];
  outputColorSpace: string;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
}>): Readonly<{ rgba: Uint8Array; contactShadowsHidden: number }> {
  const excluded = collectHarmonizeHiddenObjects(input.scene, input.hidden);
  const contactShadowsHidden = excluded.filter(
    (object) => object.name === STAGE_CONTACT_SHADOW_NAME,
  ).length;
  let rgba: Uint8Array | null = null;
  withHarmonizeVisibilityIsolation(excluded, () => {
    rgba = drawHarmonizeFramebuffer(input);
  });
  if (!rgba) {
    throw new HarmonizeExportError("Harmonize export did not produce an image.");
  }
  return { rgba, contactShadowsHidden };
}

function drawHarmonizeFramebuffer(input: Readonly<{
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  outputColorSpace: string;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
}>): Uint8Array {
  let exportRenderer: THREE.WebGLRenderer | null = null;
  try {
    exportRenderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      stencil: false,
      depth: true,
    });
    exportRenderer.setPixelRatio(1);
    exportRenderer.outputColorSpace = input.outputColorSpace as THREE.ColorSpace;
    exportRenderer.toneMapping = input.toneMapping;
    exportRenderer.toneMappingExposure = input.toneMappingExposure;
    exportRenderer.setClearColor(0x000000, 0);
    exportRenderer.setSize(input.width, input.height, false);
    const gl = exportRenderer.getContext();
    const maxBuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxSize = Math.min(maxBuffer, maxTexture);
    if (input.width > maxSize || input.height > maxSize) {
      throw new HarmonizeExportError(
        `This display cannot render ${input.width}×${input.height}. Export stopped instead of scaling.`,
      );
    }
    const size = new THREE.Vector2();
    exportRenderer.getDrawingBufferSize(size);
    const refusal = harmonizeScaleRefusal({
      actualWidth: size.x,
      actualHeight: size.y,
      expectedWidth: input.width,
      expectedHeight: input.height,
    });
    if (refusal) throw new HarmonizeExportError(refusal);
    exportRenderer.render(input.scene, input.camera);
    const pixels = new Uint8Array(input.width * input.height * 4);
    gl.readPixels(0, 0, input.width, input.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return flipRgbaRows(pixels, input.width, input.height);
  } catch (error) {
    if (error instanceof HarmonizeExportError) throw error;
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "unknown display failure";
    throw new HarmonizeExportError(
      `Export image failed: ${detail}. Export stopped instead of scaling.`,
    );
  } finally {
    try {
      exportRenderer?.dispose();
      exportRenderer?.forceContextLoss();
      exportRenderer?.domElement.remove();
    } catch {
      // Pixels are already copied. Cleanup must not discard a finished frame.
    }
  }
}
