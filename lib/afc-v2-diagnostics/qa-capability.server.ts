import "server-only";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import {
  resolveAfcQaCapabilityForConfig,
  type AfcQaAccessConfig,
  type AfcQaCapabilityDecision,
} from "./qa-access";
import { readAfcQaAccessConfig } from "./qa-access.server";

/**
 * AFD-1C QA capability gate.
 *
 * Server-controlled tester entitlement. `enabled: true` is not launch-ready.
 * AFD-1D implements vibode-afc-v2 user-deletion cleanup. Access requires the
 * database QA Mode flag and membership in the auth-user allowlist. Missing
 * configuration stays disabled. Enabling QA remains an explicit later operational decision
 * made by an administrator.
 */

export type { AfcQaAccessConfig } from "./qa-access";
export type AfcQaCapability = AfcQaCapabilityDecision;

export {
  afcQaAccessConfig,
  resolveAfcQaCapabilityForConfig,
} from "./qa-access";

export function freezeAfcQaCapability(
  capability: AfcQaCapability,
): AfcQaCapability {
  const payload = Object.freeze({ enabled: Boolean(capability.enabled) });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

export async function resolveAfcQaCapability(
  userId: string,
  qaAccess?: AfcQaAccessConfig,
): Promise<AfcQaCapability> {
  const config = qaAccess ?? (await readAfcQaAccessConfig());
  return resolveAfcQaCapabilityForConfig(userId, config);
}

export async function handleAfcQaCapabilityGet(args: {
  request: Request;
  authorize: (request: Request) => Promise<ProductionAfcAuth>;
  qaAccess?: AfcQaAccessConfig;
}) {
  const auth = await args.authorize(args.request);
  if (!auth.ok) return auth.response;
  return productionAfcJson(
    freezeAfcQaCapability(
      await resolveAfcQaCapability(auth.userId, args.qaAccess),
    ),
    200,
  );
}
