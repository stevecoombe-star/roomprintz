"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { parseFurnitureGlb } from "@/lib/afc-v2-runtime/furniture-glb-loader";

export function PersonalFurniturePreview({
  url,
  label,
}: {
  url: string | null;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [trackedUrl, setTrackedUrl] = useState(url);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  if (url !== trackedUrl) {
    setTrackedUrl(url);
    setFailed(false);
    setReady(false);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!url || !canvas) return;
    let cancelled = false;
    let renderer: THREE.WebGLRenderer | null = null;
    void renderPreview(url, canvas).then((next) => {
      if (cancelled) {
        next?.dispose();
        return;
      }
      if (!next) {
        setFailed(true);
        return;
      }
      renderer = next;
      setReady(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      renderer?.dispose();
    };
  }, [url]);

  const message = !url || failed ? "Preview unavailable" : ready ? null : "Loading preview";
  return (
    <div className="relative h-24 overflow-hidden rounded-md bg-neutral-900">
      <canvas ref={canvasRef} className="h-full w-full" aria-label={`${label} preview`} />
      {message ? (
        <div className="absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-neutral-500">
          {message}
        </div>
      ) : null}
    </div>
  );
}

async function renderPreview(
  url: string,
  canvas: HTMLCanvasElement,
): Promise<THREE.WebGLRenderer | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const parsed = await parseFurnitureGlb(await response.arrayBuffer());
  if (!parsed.ok) return null;
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 240;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.add(parsed.scene);
  const box = new THREE.Box3().setFromObject(parsed.scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 100);
  const span = Math.max(size.x, size.y, size.z, 0.1);
  camera.position.set(center.x + span, center.y + span * 0.65, center.z + span);
  camera.lookAt(center);
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const light = new THREE.DirectionalLight(0xffffff, 1.1);
  light.position.set(center.x + span, center.y + span, center.z + span);
  scene.add(light);
  renderer.render(scene, camera);
  disposeScene(parsed.scene);
  return renderer;
}

function disposeScene(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}
