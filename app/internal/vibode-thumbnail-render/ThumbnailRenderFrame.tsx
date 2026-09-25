"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";

import {
  createFurnitureAssetResolver,
  furnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/furniture-assets";
import { cloneFurnitureGlbScene } from "@/lib/afc-v2-runtime/furniture-glb-loader";
import { createFurnitureTemplateCache } from "@/lib/afc-v2-runtime/furniture-template-cache";
import { instantiateSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import {
  buildProductionPerspectiveCamera,
  realizeFrozenCamera,
} from "@/lib/afc-v2-runtime/frozen-camera";
import { realizeObjectWorldTransform } from "@/lib/afc-v2-runtime/metric-world-realization";
import { measurePlacementLocalAabb } from "@/lib/afc-v2-runtime/object-runtime";
import { overlayFromRuntimeDefinitions } from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import {
  commitLiveSceneObjectTransform,
  mountLiveRuntimeSceneObject,
} from "@/lib/afc-v2-runtime/scene-runtime";
import type { FurnitureAssetDefinition } from "@/lib/afc-v2-runtime/types";
import {
  emptyThumbnailRenderTiming,
  isVibodeThumbnailRenderErrorCode,
  sceneDefinitionFromThumbnailObject,
  thumbnailAssetUrlPolicyFromEnv,
  validateVibodeThumbnailRenderPayload,
  type VibodeThumbnailRenderErrorCode,
  type VibodeThumbnailRenderPayload,
  type VibodeThumbnailRenderReadiness,
} from "@/lib/vibode-thumbnail-render/contract";
import {
  VIBODE_PRODUCTION_AMBIENT_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_POSITION,
  VIBODE_PRODUCTION_LIGHT_COLOR,
  VIBODE_THUMBNAIL_RENDERER_DPR,
} from "@/lib/vibode-thumbnail-render/still-renderer";

declare global {
  interface Window {
    __VIBODE_THUMBNAIL_RENDER__?: VibodeThumbnailRenderReadiness;
  }
}

function publish(next: VibodeThumbnailRenderReadiness) {
  window.__VIBODE_THUMBNAIL_RENDER__ = next;
}

export function ThumbnailRenderFrame() {
  const params = useSearchParams();
  const access = params.get("access") ?? "";
  const [payload, setPayload] = useState<VibodeThumbnailRenderPayload | null>(null);
  const [fetchTiming, setFetchTiming] = useState<number | null>(null);

  useEffect(() => {
    const started = performance.now();
    let cancelled = false;
    publish({
      status: "loading",
      jobId: null,
      contentToken: null,
      objectCount: 0,
      timing: emptyThumbnailRenderTiming(),
    });
    const fail = (code: VibodeThumbnailRenderErrorCode, message: string) => {
      if (cancelled) return;
      publish({
        status: "error",
        jobId: null,
        contentToken: null,
        objectCount: 0,
        timing: {
          ...emptyThumbnailRenderTiming(),
          totalReadinessMs: Math.round(performance.now() - started),
        },
        error: { code, message },
      });
    };
    const onWindowError = (event: ErrorEvent) => {
      fail("render_page_error", event.message || "Render page failed.");
    };
    window.addEventListener("error", onWindowError);
    const run = async () => {
      if (!access) {
        fail("render_access_denied", "Render access denied.");
        return;
      }
      const fetchStarted = performance.now();
      let response: Response;
      try {
        response = await fetch("/api/internal/vibode-thumbnail-render", {
          headers: { "x-vibode-thumbnail-access": access },
          cache: "no-store",
        });
      } catch {
        fail("render_page_error", "Render contract request failed.");
        return;
      }
      const contractFetchMs = Math.round(performance.now() - fetchStarted);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        fail(readErrorCode(body), readErrorMessage(body));
        return;
      }
      const validated = validateVibodeThumbnailRenderPayload(
        body,
        thumbnailAssetUrlPolicyFromEnv(),
      );
      if (!validated.ok) {
        fail("render_page_error", validated.reason);
        return;
      }
      if (cancelled) return;
      setFetchTiming(contractFetchMs);
      setPayload(validated.payload);
    };
    void run().catch(() => fail("render_page_error", "Render page failed."));
    return () => {
      cancelled = true;
      window.removeEventListener("error", onWindowError);
    };
  }, [access]);

  useEffect(() => {
    if (!payload) return;
    const started = performance.now();
    const timing = {
      ...emptyThumbnailRenderTiming(),
      contractFetchMs: fetchTiming,
    };
    let cancelled = false;
    let renderer: THREE.WebGLRenderer | null = null;
    const fail = (code: VibodeThumbnailRenderErrorCode, message: string) => {
      if (cancelled) return;
      publish({
        status: "error",
        jobId: payload.job.jobId,
        contentToken: payload.job.contentToken,
        objectCount: 0,
        timing: {
          ...timing,
          totalReadinessMs: Math.round(performance.now() - started) + (fetchTiming ?? 0),
        },
        error: { code, message },
      });
    };
    const frame = document.querySelector("[data-vibode-thumbnail-frame]");
    const image = frame?.querySelector("img");
    const mount = frame?.querySelector("[data-vibode-thumbnail-mount]");
    if (!(image instanceof HTMLImageElement) || !(mount instanceof HTMLDivElement)) {
      fail("render_page_error", "Render frame is not mounted.");
      return;
    }
    const cache = createFurnitureTemplateCache({
      resolver: createFurnitureAssetResolver(dynamicOverlay(payload)),
    });
    const run = async () => {
      const decodeStarted = performance.now();
      try {
        if (typeof image.decode === "function") await image.decode();
        else await waitForImage(image);
      } catch {
        fail("background_missing", "Background image could not be decoded.");
        return;
      }
      timing.backgroundDecodeMs = Math.round(performance.now() - decodeStarted);
      if (cancelled) return;
      const glbStarted = performance.now();
      const definitions = payload.objects.map(sceneDefinitionFromThumbnailObject);
      const outcomes = await cache.ensure(
        definitions.map((definition) => definition.assetId),
        { allowRefresh: false },
      );
      timing.glbLoadMs = Math.round(performance.now() - glbStarted);
      if (outcomes.some((outcome) => !outcome.ok)) {
        fail("glb_load_failed", "Furniture GLB failed to load.");
        return;
      }
      const sceneStarted = performance.now();
      const realizedCamera = realizeFrozenCamera({
        verticalFovDeg: payload.camera.verticalFovDeg,
        pose: {
          position: payload.camera.position,
          lookAt: payload.camera.lookAt,
          up: payload.camera.up,
        },
        frame: payload.frame,
      }, payload.camera.metricScale);
      const built = buildProductionPerspectiveCamera(realizedCamera);
      if (!built.ok) {
        fail("camera_authority_missing", built.reason);
        return;
      }
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(VIBODE_THUMBNAIL_RENDERER_DPR);
      renderer.setClearColor(0x000000, 0);
      renderer.setClearAlpha(0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.shadowMap.enabled = false;
      renderer.setSize(payload.frame.width, payload.frame.height, false);
      renderer.domElement.style.display = "block";
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.margin = "0";
      renderer.domElement.style.padding = "0";
      mount.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.background = null;
      const ambient = new THREE.AmbientLight(
        VIBODE_PRODUCTION_LIGHT_COLOR,
        VIBODE_PRODUCTION_AMBIENT_INTENSITY,
      );
      const keyLight = new THREE.DirectionalLight(
        VIBODE_PRODUCTION_LIGHT_COLOR,
        VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
      );
      keyLight.position.set(
        VIBODE_PRODUCTION_DIRECTIONAL_POSITION.x,
        VIBODE_PRODUCTION_DIRECTIONAL_POSITION.y,
        VIBODE_PRODUCTION_DIRECTIONAL_POSITION.z,
      );
      keyLight.castShadow = false;
      scene.add(ambient);
      scene.add(keyLight);
      const objectLayer = new THREE.Group();
      scene.add(objectLayer);
      const resolver = createFurnitureAssetResolver(dynamicOverlay(payload));
      const instantiated = instantiateSceneObjectDefinitions({
        roomId: payload.room.roomId,
        generationId: payload.room.afcGenerationId,
        definitions,
        resolver,
      });
      if (
        instantiated.skipped.length > 0 ||
        instantiated.objects.length !== definitions.length
      ) {
        fail("glb_identity_missing", "Furniture asset identity could not be resolved.");
        return;
      }
      for (const descriptor of instantiated.objects) {
        const template = cache.template(descriptor.assetIdentity.id);
        if (!template) {
          fail("glb_load_failed", "Furniture GLB failed to load.");
          return;
        }
        const realized = realizeObjectWorldTransform(
          descriptor.transform,
          payload.camera.metricScale,
        );
        const live = mountLiveRuntimeSceneObject({
          descriptor,
          imported: cloneFurnitureGlbScene(template),
          metricScale: payload.camera.metricScale,
        });
        live.localAabb = measurePlacementLocalAabb(live.placement, live.importPlacement);
        commitLiveSceneObjectTransform(live, realized, payload.camera.metricScale);
        objectLayer.add(live.placement);
      }
      timing.sceneConstructionMs = Math.round(performance.now() - sceneStarted);
      const renderStarted = performance.now();
      renderer.render(scene, built.camera);
      timing.firstRenderMs = Math.round(performance.now() - renderStarted);
      await nextFrame();
      await nextFrame();
      if (cancelled) return;
      publish({
        status: "ready",
        jobId: payload.job.jobId,
        contentToken: payload.job.contentToken,
        objectCount: payload.objects.length,
        timing: {
          ...timing,
          totalReadinessMs: Math.round(performance.now() - started) + (fetchTiming ?? 0),
        },
      });
    };
    void run().catch(() => fail("render_page_error", "Render page failed."));
    return () => {
      cancelled = true;
      renderer?.dispose();
      cache.dispose();
    };
  }, [payload, fetchTiming]);

  return (
    <div
      data-vibode-thumbnail-frame=""
      style={{
        position: "relative",
        width: payload?.frame.width ?? 0,
        height: payload?.frame.height ?? 0,
        overflow: "hidden",
        margin: 0,
        padding: 0,
        pointerEvents: "none",
      }}
    >
      {payload ? (
        // eslint-disable-next-line @next/next/no-img-element -- capture frame must be a DOM image, not a Next image
        <img
          alt=""
          src={payload.background.url}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
            display: "block",
            margin: 0,
            padding: 0,
            border: 0,
          }}
        />
      ) : null}
      <div
        data-vibode-thumbnail-mount=""
        style={{ position: "absolute", inset: 0, margin: 0, padding: 0 }}
      />
    </div>
  );
}

function dynamicOverlay(
  payload: VibodeThumbnailRenderPayload,
): ReadonlyMap<string, FurnitureAssetDefinition> {
  return overlayFromRuntimeDefinitions(
    payload.objects
      .filter((object) => !furnitureAssetDefinition(object.assetId))
      .map((object) => ({
        assetId: object.assetId,
        glbUrl: object.glbUrl,
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })),
  );
}

function readErrorCode(body: unknown): VibodeThumbnailRenderErrorCode {
  if (!body || typeof body !== "object") return "render_page_error";
  const code = (body as { code?: unknown }).code;
  if (typeof code === "string" && isVibodeThumbnailRenderErrorCode(code)) return code;
  return "render_page_error";
}

function readErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "Render page failed.";
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message : "Render page failed.";
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("background"));
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
