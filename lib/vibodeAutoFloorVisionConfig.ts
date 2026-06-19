import "server-only";

import { isValidGeminiRoomReadModelVersion } from "@/lib/vibodeRoomReadModelVersion";
import { DEFAULT_AUTO_FLOOR_VISION_CONFIG } from "@/app/admin/3d-room-lab/auto-floor-vision-provider-scaffold";

// --- Phase 2F-F: server-only config for the real Gemini vision floor route ---
// All reads are server-side only. NEVER import this into a client component;
// it intentionally exposes the API key getter and must not reach the browser.
//
// The feature is OFF unless AUTO_FLOOR_VISION_ENABLED is explicitly truthy.
// Sensible defaults live here so the optional envs can be omitted entirely.

function readBoolEnv(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Defaults (server-code; used when the optional env is absent).
const DEFAULT_GEMINI_TIMEOUT_MS = 25000;
const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Master gate. Vision floor detection is disabled unless this is truthy. */
export function isAutoFloorVisionEnabled(): boolean {
  return readBoolEnv("AUTO_FLOOR_VISION_ENABLED");
}

/** Server-only Gemini API key, following the existing project convention. */
export function getAutoFloorVisionApiKey(): string | null {
  return safeStr(process.env.GEMINI_API_KEY) ?? safeStr(process.env.GOOGLE_API_KEY);
}

/** Baseline model id; overridable via AUTO_FLOOR_VISION_MODEL (validated). */
export function getAutoFloorVisionModel(): string {
  const override = safeStr(process.env.AUTO_FLOOR_VISION_MODEL);
  if (override && isValidGeminiRoomReadModelVersion(override)) return override;
  return DEFAULT_AUTO_FLOOR_VISION_CONFIG.model;
}

export function getAutoFloorVisionGeminiTimeoutMs(): number {
  return readIntEnv("AUTO_FLOOR_VISION_TIMEOUT_MS", DEFAULT_GEMINI_TIMEOUT_MS);
}

export function getAutoFloorVisionImageFetchTimeoutMs(): number {
  return DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
}

export function getAutoFloorVisionImageMaxBytes(): number {
  return readIntEnv("AUTO_FLOOR_VISION_IMAGE_MAX_BYTES", DEFAULT_IMAGE_MAX_BYTES);
}

/**
 * Allowlisted image hosts. If AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS is set
 * (comma-separated), it is authoritative. Otherwise we default to a small,
 * project-aligned allowlist: Unsplash (the lab default image) plus the
 * configured Supabase storage host, if derivable.
 */
export function getAutoFloorVisionAllowedImageHosts(): string[] {
  const configured = safeStr(process.env.AUTO_FLOOR_VISION_ALLOWED_IMAGE_HOSTS);
  if (configured) {
    return configured
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0);
  }

  const defaults = new Set<string>(["images.unsplash.com"]);
  const supabaseUrl = safeStr(process.env.SUPABASE_URL) ?? safeStr(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (supabaseUrl) {
    try {
      defaults.add(new URL(supabaseUrl).hostname.toLowerCase());
    } catch {
      // ignore malformed SUPABASE_URL
    }
  }
  return [...defaults];
}

export function isAutoFloorVisionDebugLog(): boolean {
  return readBoolEnv("AUTO_FLOOR_VISION_DEBUG_LOG");
}

/**
 * Dev-only escape hatch for local room-image URLs served from the local app.
 *
 * Strictly disabled in production, even if the env flag is set.
 */
export function isAutoFloorVisionAllowLocalhostHttp(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return readBoolEnv("AUTO_FLOOR_VISION_ALLOW_LOCALHOST_HTTP");
}
