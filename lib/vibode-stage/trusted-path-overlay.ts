/**
 * Production viewport adapter for the diagnostic trusted span.
 *
 * Geometry is the floor intersection of the certified image endpoints
 * through the live realized camera. The label is the certified baseline
 * times the current Room Scale multiplier, not a new AFC measurement.
 */

import * as THREE from "three";

import { liftTrustedPathSegment } from "./trusted-path-floor";
import {
  TRUSTED_PATH_STROKE,
  effectiveTrustedPathLengthMeters,
  formatMetersAndImperial,
  type TrustedPathBaseline,
} from "./trusted-path";

export type TrustedPathOverlaySync = Readonly<{
  visible: boolean;
  baseline: TrustedPathBaseline | null;
  roomScaleMultiplier: number;
  camera: THREE.PerspectiveCamera;
  metricScale: number;
  intrinsic: Readonly<{ width: number; height: number }>;
  frame: Readonly<{ width: number; height: number }>;
  viewportWidth: number;
  viewportHeight: number;
}>;

export type TrustedPathOverlayPresentation = Readonly<{
  shown: boolean;
  label: string | null;
  screenX: number;
  screenY: number;
}>;

const HIDDEN: TrustedPathOverlayPresentation = Object.freeze({
  shown: false,
  label: null,
  screenX: 0,
  screenY: 0,
});

export type TrustedPathOverlay = Readonly<{
  object: THREE.Object3D;
  sync: (input: TrustedPathOverlaySync) => TrustedPathOverlayPresentation;
  dispose: () => void;
}>;

export function createTrustedPathOverlay(): TrustedPathOverlay {
  const material = new THREE.MeshBasicMaterial({
    color: TRUSTED_PATH_STROKE,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), material);
  const endpointA = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
  const endpointB = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
  const ignoreRaycast: THREE.Mesh["raycast"] = () => undefined;
  tube.raycast = ignoreRaycast;
  endpointA.raycast = ignoreRaycast;
  endpointB.raycast = ignoreRaycast;
  const object = new THREE.Group();
  object.name = "trusted-path";
  object.visible = false;
  object.add(tube, endpointA, endpointB);

  const up = new THREE.Vector3(0, 1, 0);
  const delta = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const ndc = new THREE.Vector3();

  const sync = (input: TrustedPathOverlaySync): TrustedPathOverlayPresentation => {
    try {
      if (!input.visible || !input.baseline) return hide();
      const segment = liftTrustedPathSegment(
        input.baseline.imageA,
        input.baseline.imageB,
        input.intrinsic,
        input.frame,
        input.camera,
      );
      if (!segment) return hide();
      const metres = effectiveTrustedPathLengthMeters(
        input.baseline.baselineLengthMeters,
        input.roomScaleMultiplier,
      );
      const label = metres == null ? null : formatMetersAndImperial(metres);
      if (!label) return hide();
      const radius = tubeRadius(input.metricScale);
      delta.set(
        segment.b.x - segment.a.x,
        0,
        segment.b.z - segment.a.z,
      );
      const length = delta.length();
      if (!(length > 1e-4)) return hide();
      delta.multiplyScalar(1 / length);
      mid.set(
        (segment.a.x + segment.b.x) / 2,
        radius,
        (segment.a.z + segment.b.z) / 2,
      );
      tube.position.copy(mid);
      tube.quaternion.setFromUnitVectors(up, delta);
      tube.scale.set(radius, length, radius);
      endpointA.position.set(segment.a.x, radius, segment.a.z);
      endpointB.position.set(segment.b.x, radius, segment.b.z);
      endpointA.scale.setScalar(radius * 1.8);
      endpointB.scale.setScalar(radius * 1.8);
      object.visible = true;

      if (!(input.viewportWidth > 0) || !(input.viewportHeight > 0)) {
        return Object.freeze({ shown: true, label, screenX: 0, screenY: 0 });
      }
      ndc.copy(mid).project(input.camera);
      if (ndc.z < -1 || ndc.z > 1) {
        return Object.freeze({ shown: true, label: null, screenX: 0, screenY: 0 });
      }
      return Object.freeze({
        shown: true,
        label,
        screenX: (ndc.x * 0.5 + 0.5) * input.viewportWidth,
        screenY: (-ndc.y * 0.5 + 0.5) * input.viewportHeight,
      });
    } catch {
      return hide();
    }
  };

  return Object.freeze({
    object,
    sync,
    dispose() {
      object.remove(tube, endpointA, endpointB);
      tube.geometry.dispose();
      endpointA.geometry.dispose();
      endpointB.geometry.dispose();
      material.dispose();
    },
  });

  function hide(): TrustedPathOverlayPresentation {
    object.visible = false;
    return HIDDEN;
  }
}

function tubeRadius(metricScale: number): number {
  const scale = Number.isFinite(metricScale) && metricScale > 0 ? metricScale : 1;
  return scale * 0.015;
}
