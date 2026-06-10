"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const LAB_GLB_PATH = "/3d-lab/furniture-test-chair.glb";
const DEFAULT_ROOM_IMAGE_URL =
  "https://images.unsplash.com/photo-1505693314120-0d443867891c?auto=format&fit=crop&w=1600&q=80";

type ImageLoadState = "idle" | "loading" | "loaded" | "error";
type ModelLoadState = "idle" | "loading" | "loaded" | "fallback" | "error";

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "alphaMap",
  "aoMap",
  "bumpMap",
  "displacementMap",
  "emissiveMap",
  "envMap",
  "lightMap",
  "metalnessMap",
  "normalMap",
  "roughnessMap",
  "specularMap",
] as const;

function disposeMaterial(material: THREE.Material) {
  const materialRecord = material as unknown as Record<string, unknown>;
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const value = materialRecord[key];
    if (value && typeof value === "object" && "isTexture" in value) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const maybeMesh = child as THREE.Mesh;
    if (!maybeMesh.isMesh) return;
    maybeMesh.geometry?.dispose();
    if (Array.isArray(maybeMesh.material)) {
      for (const material of maybeMesh.material) disposeMaterial(material);
      return;
    }
    if (maybeMesh.material) disposeMaterial(maybeMesh.material);
  });
}

function formatModelStatus(state: ModelLoadState, errorMessage: string | null): string {
  if (state === "fallback") return `fallback cube (${errorMessage ?? "GLB load failed"})`;
  if (state === "error") return `error (${errorMessage ?? "unknown"})`;
  return state;
}

export default function ThreeRoomLab() {
  const envEnabled = process.env.NEXT_PUBLIC_VIBODE_ENABLE_3D_ROOM_LAB === "1";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeObjectRef = useRef<THREE.Object3D | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [roomImageInput, setRoomImageInput] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [roomImageUrl, setRoomImageUrl] = useState(DEFAULT_ROOM_IMAGE_URL);
  const [imageLoadState, setImageLoadState] = useState<ImageLoadState>(
    DEFAULT_ROOM_IMAGE_URL ? "loading" : "idle"
  );
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>("idle");
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [rendererSize, setRendererSize] = useState({ width: 0, height: 0 });

  const debugRows = useMemo(
    () => [
      { label: "env", value: envEnabled ? "enabled" : "disabled" },
      { label: "image", value: imageLoadState },
      { label: "model", value: formatModelStatus(modelLoadState, modelLoadError) },
      { label: "renderer", value: `${rendererSize.width} x ${rendererSize.height}` },
      { label: "glb path", value: LAB_GLB_PATH },
    ],
    [envEnabled, imageLoadState, modelLoadError, modelLoadState, rendererSize.height, rendererSize.width]
  );

  useEffect(() => {
    if (!envEnabled) return;
    const container = containerRef.current;
    const canvasHost = canvasHostRef.current;
    if (!container || !canvasHost) return;

    let isDisposed = false;
    setModelLoadState("loading");
    setModelLoadError(null);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 1.1, 3.2);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(3, 6, 5);
    scene.add(ambient);
    scene.add(keyLight);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    canvasHost.appendChild(renderer.domElement);

    const syncRendererSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      setRendererSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    syncRendererSize();
    window.addEventListener("resize", syncRendererSize);
    const resizeObserver = new ResizeObserver(syncRendererSize);
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    const addFallbackCube = (reason: string) => {
      setModelLoadState("fallback");
      setModelLoadError(reason);
      const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      const material = new THREE.MeshStandardMaterial({
        color: "#34d399",
        metalness: 0.1,
        roughness: 0.6,
      });
      const cube = new THREE.Mesh(geometry, material);
      cube.position.set(0, -0.35, 0);
      scene.add(cube);
      activeObjectRef.current = cube;
    };

    const loader = new GLTFLoader();
    loader.load(
      LAB_GLB_PATH,
      (gltf) => {
        if (isDisposed) {
          disposeObject3D(gltf.scene);
          return;
        }
        gltf.scene.scale.set(1.15, 1.15, 1.15);
        gltf.scene.position.set(0, -0.85, 0);
        scene.add(gltf.scene);
        activeObjectRef.current = gltf.scene;
        setModelLoadState("loaded");
      },
      undefined,
      (error) => {
        if (isDisposed) return;
        const message = error instanceof Error ? error.message : "Unable to load GLB asset.";
        addFallbackCube(message);
      }
    );

    const animate = () => {
      if (isDisposed) return;
      animationFrameRef.current = window.requestAnimationFrame(animate);
      if (activeObjectRef.current) {
        activeObjectRef.current.rotation.y += 0.005;
      }
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      isDisposed = true;
      window.removeEventListener("resize", syncRendererSize);
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (activeObjectRef.current) {
        scene.remove(activeObjectRef.current);
        disposeObject3D(activeObjectRef.current);
        activeObjectRef.current = null;
      }
      scene.remove(ambient);
      scene.remove(keyLight);
      renderer.dispose();
      renderer.forceContextLoss();
      const canvas = renderer.domElement;
      if (canvas.parentElement === canvasHost) {
        canvasHost.removeChild(canvas);
      }
    };
  }, [envEnabled]);

  const handleImageSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = roomImageInput.trim();
    setRoomImageUrl(nextUrl);
    setImageLoadState(nextUrl ? "loading" : "idle");
  };

  if (!envEnabled) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <h1 className="text-xl font-semibold tracking-tight">3D Room Lab</h1>
          <p className="mt-2 text-sm text-slate-300">3D Room Lab is not enabled.</p>
          <p className="mt-1 text-xs text-slate-500">
            Set <code>NEXT_PUBLIC_VIBODE_ENABLE_3D_ROOM_LAB=1</code> and restart the dev server.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">3D Room Lab (Phase 0A)</h1>
          <p className="text-sm text-slate-400">
            Static proof: room image base layer with transparent Three.js overlay and one local GLB test asset.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <form className="flex flex-col gap-2 md:flex-row md:items-end" onSubmit={handleImageSubmit}>
            <label className="flex-1">
              <span className="text-xs text-slate-400">Room image URL</span>
              <input
                type="url"
                value={roomImageInput}
                onChange={(event) => setRoomImageInput(event.target.value)}
                placeholder="https://example.com/room.jpg"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
            >
              Load Image
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
            style={{ aspectRatio: "16 / 10" }}
          >
            {roomImageUrl ? (
              <img
                src={roomImageUrl}
                alt="Room base"
                className="absolute inset-0 h-full w-full object-cover"
                onLoad={() => setImageLoadState("loaded")}
                onError={() => setImageLoadState("error")}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
                Paste a room image URL and click Load Image.
              </div>
            )}
            <div ref={canvasHostRef} className="pointer-events-none absolute inset-0" />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-sm font-medium text-slate-100">Debug status</h2>
          <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
            {debugRows.map((row) => (
              <p key={row.label} className="rounded border border-slate-800 bg-slate-950/70 px-2 py-1">
                <span className="text-slate-500">{row.label}:</span> {row.value}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Expected local asset path: <code>{LAB_GLB_PATH}</code>
          </p>
        </section>
      </div>
    </main>
  );
}
