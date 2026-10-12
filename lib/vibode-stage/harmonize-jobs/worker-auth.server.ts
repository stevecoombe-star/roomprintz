import "server-only";

import { timingSafeEqual } from "node:crypto";

import { HARMONIZE_WORKER_HEADER } from "./policy";

/**
 * Shared secret for the Harmonize worker only.
 * It is not the thumbnail worker secret and it never authorizes a browser.
 */
export function harmonizeWorkerSecret(): string | null {
  const configured = process.env.VIBODE_HARMONIZE_WORKER_SECRET?.trim();
  return configured || null;
}

export function harmonizeWorkerAuthorization(
  request: Request,
): "ok" | "unconfigured" | "rejected" {
  const secret = harmonizeWorkerSecret();
  if (!secret) return "unconfigured";
  const presented = request.headers.get(HARMONIZE_WORKER_HEADER) ?? "";
  const left = Buffer.from(presented);
  const right = Buffer.from(secret);
  if (left.length !== right.length || left.length === 0) return "rejected";
  return timingSafeEqual(left, right) ? "ok" : "rejected";
}
