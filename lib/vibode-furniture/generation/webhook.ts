/**
 * Webhook deliveries are hints. The secret header is required, and the
 * body is parsed as a task. This phase does not mount a webhook route.
 * Progress on a delivery is coarse (0, 50, or 100). A download still waits
 * for a task read that carries a GLB URL.
 *
 * Header names from the Meshy webhooks guide, checked 2026-11-06.
 */

import { timingSafeEqual } from "node:crypto";

import { parseMeshyTask, type MeshyTask } from "./meshy-task";

export const MESHY_WEBHOOK_SECRET_HEADER = "x-meshy-api-webhook-secret-key";

export const MESHY_WEBHOOK_VERSION_HEADER = "meshy-webhook-version";

export function meshyWebhookAuthorized(input: Readonly<{
  expectedSecret: string;
  providedSecret: string | null;
  version: string | null;
}>): boolean {
  if (input.version !== "v1") return false;
  if (!input.expectedSecret || !input.providedSecret) return false;
  const expected = Buffer.from(input.expectedSecret);
  const provided = Buffer.from(input.providedSecret);
  if (expected.length === 0 || expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function meshyWebhookTask(input: Readonly<{
  expectedSecret: string;
  providedSecret: string | null;
  version: string | null;
  body: unknown;
}>): MeshyTask | null {
  if (!meshyWebhookAuthorized(input)) return null;
  return parseMeshyTask(input.body);
}
