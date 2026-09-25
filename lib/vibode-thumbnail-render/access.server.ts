import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  VIBODE_THUMBNAIL_RENDER_TOKEN_EXPIRES_SEC,
  VIBODE_THUMBNAIL_RENDER_TOKEN_REPLAY_MS,
} from "./contract";

/**
 * Render-access tokens.
 *
 * Local proof mints still use the process-local nonce map. Durable jobs
 * pass `durable: true` and store the nonce on the job row. The render
 * route resolves that nonce from the claimed job instead of this map.
 */

export type ThumbnailRenderTokenClaims = Readonly<{
  jobId: string;
  roomId: string;
  versionId: string;
  contentToken: string;
  exp: number;
  nonce: string;
}>;

type IssuedNonce = Readonly<{
  claims: ThumbnailRenderTokenClaims;
  consumedAt: number | null;
}>;

const DEV_ONLY_TOKEN_SECRET = "vibode-thumbnail-render-dev-only";
const ACCESS_REGISTRY_KEY = "__vibodeThumbnailRenderAccess";
// Next bundles route handlers separately, so a module Map is not shared.
// THUMB-2D replaces this process map with the job row.

type AccessHost = typeof globalThis & {
  [ACCESS_REGISTRY_KEY]?: Map<string, IssuedNonce>;
};

function issuedTokens(): Map<string, IssuedNonce> {
  const host = globalThis as AccessHost;
  if (!host[ACCESS_REGISTRY_KEY]) host[ACCESS_REGISTRY_KEY] = new Map();
  return host[ACCESS_REGISTRY_KEY];
}

export function thumbnailRenderTokenSecret(): string | null {
  const configured = process.env.VIBODE_THUMBNAIL_RENDER_TOKEN_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return null;
  return DEV_ONLY_TOKEN_SECRET;
}

export function resetThumbnailRenderAccessForTests(): void {
  issuedTokens().clear();
}

export function mintThumbnailRenderToken(input: Readonly<{
  jobId: string;
  roomId: string;
  versionId: string;
  contentToken: string;
  nowMs?: number;
  nonce?: string;
  durable?: boolean;
}>): { token: string; claims: ThumbnailRenderTokenClaims } | null {
  const secret = thumbnailRenderTokenSecret();
  if (!secret) return null;
  const nowMs = input.nowMs ?? Date.now();
  const claims: ThumbnailRenderTokenClaims = {
    jobId: input.jobId,
    roomId: input.roomId,
    versionId: input.versionId,
    contentToken: input.contentToken,
    exp: nowMs + VIBODE_THUMBNAIL_RENDER_TOKEN_EXPIRES_SEC * 1000,
    nonce: input.nonce ?? randomUUID(),
  };
  const token = signClaims(claims, secret);
  if (!input.durable) {
    issuedTokens().set(claims.nonce, { claims, consumedAt: null });
  }
  return { token, claims };
}

export function readSignedThumbnailRenderToken(
  token: string,
  nowMs: number = Date.now(),
): ThumbnailRenderTokenClaims | null {
  const secret = thumbnailRenderTokenSecret();
  if (!secret) return null;
  const claims = readSignedClaims(token, secret);
  if (!claims || claims.exp <= nowMs) return null;
  return claims;
}

export function verifyThumbnailRenderToken(
  token: string,
  nowMs: number = Date.now(),
): ThumbnailRenderTokenClaims | null {
  const claims = readSignedThumbnailRenderToken(token, nowMs);
  if (!claims) return null;
  const issuedNonce = issuedTokens().get(claims.nonce);
  if (!issuedNonce) return null;
  if (
    issuedNonce.claims.jobId !== claims.jobId ||
    issuedNonce.claims.roomId !== claims.roomId ||
    issuedNonce.claims.versionId !== claims.versionId ||
    issuedNonce.claims.contentToken !== claims.contentToken
  ) {
    return null;
  }
  if (
    issuedNonce.consumedAt != null &&
    nowMs - issuedNonce.consumedAt > VIBODE_THUMBNAIL_RENDER_TOKEN_REPLAY_MS
  ) {
    return null;
  }
  return claims;
}

export function consumeThumbnailRenderToken(
  claims: ThumbnailRenderTokenClaims,
  nowMs: number = Date.now(),
): void {
  const current = issuedTokens().get(claims.nonce);
  if (!current || current.consumedAt != null) return;
  issuedTokens().set(claims.nonce, { claims: current.claims, consumedAt: nowMs });
}

export function thumbnailRenderRouteEnabled(request: Request): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!thumbnailRenderTokenSecret()) return false;
  try {
    const host = new URL(request.url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function signClaims(claims: ThumbnailRenderTokenClaims, secret: string): string {
  const body = encode(JSON.stringify(claims));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function readSignedClaims(
  token: string,
  secret: string,
): ThumbnailRenderTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    return claimsFromUnknown(parsed);
  } catch {
    return null;
  }
}

function claimsFromUnknown(value: unknown): ThumbnailRenderTokenClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.jobId !== "string" ||
    typeof record.roomId !== "string" ||
    typeof record.versionId !== "string" ||
    typeof record.contentToken !== "string" ||
    typeof record.nonce !== "string" ||
    typeof record.exp !== "number" ||
    !Number.isFinite(record.exp)
  ) {
    return null;
  }
  return {
    jobId: record.jobId,
    roomId: record.roomId,
    versionId: record.versionId,
    contentToken: record.contentToken,
    exp: record.exp,
    nonce: record.nonce,
  };
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
