import "server-only";

import { timingSafeEqual } from "node:crypto";

export const VIBODE_THUMBNAIL_WORKER_HEADER = "x-vibode-thumbnail-worker";

/**
 * Shared secret between the deployed worker and the app.
 * Rotate by setting the new value on the app and the worker together.
 * A mismatch fails claim, fail, and publish closed. Pending jobs stay queued.
 * The render page never receives this secret.
 */
export function thumbnailWorkerSecret(): string | null {
  const configured = process.env.VIBODE_THUMBNAIL_WORKER_SECRET?.trim();
  return configured || null;
}

export function thumbnailWorkerAuthorization(
  request: Request,
): "ok" | "unconfigured" | "rejected" {
  const secret = thumbnailWorkerSecret();
  if (!secret) return "unconfigured";
  const presented = request.headers.get(VIBODE_THUMBNAIL_WORKER_HEADER) ?? "";
  if (!safeEqual(presented, secret)) return "rejected";
  return "ok";
}

function safeEqual(presented: string, secret: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
