"use client";

import Image from "next/image";
import * as THREE from "three";
import { useEffect, useRef } from "react";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "@/app/admin/3d-room-lab/calibrated-camera-readonly-projection";

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
}>;

/**
 * Read-only realization of an already-frozen camera snapshot. It deliberately
 * has no solver, writer, or state callback: replacing the snapshot is the only
 * way to change the rendered camera.
 */
export default function CalibratedRoomViewer({
  originalImageUrl,
  camera: snapshot,
  floor,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);

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
    renderer.domElement.className = "size-full bg-transparent";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = null;
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
    renderer.render(scene, result.camera);

    return () => {
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
        className="absolute inset-0 z-10 bg-transparent"
        aria-label="Read-only calibrated camera realization"
      />
    </div>
  );
}
