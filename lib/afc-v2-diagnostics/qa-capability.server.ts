import "server-only";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  parseUuid,
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

/**
 * AFD-1C QA capability gate.
 *
 * Server-controlled tester entitlement only. `enabled: true` is not launch-ready.
 * AFD-1D implements vibode-afc-v2 user-deletion cleanup. Keep
 * VIBODE_AFC_QA_MODE=off in shared/real testing until allowlist/all
 * activation is an explicit later operational decision.
 */

export const AFC_QA_MODES = ["off", "allowlist", "all"] as const;
export type AfcQaMode = (typeof AFC_QA_MODES)[number];

export type AfcQaCapability = {
  enabled: boolean;
};

export type AfcQaCapabilityEnv = Readonly<{
  VIBODE_AFC_QA_MODE?: string;
  VIBODE_AFC_QA_USER_IDS?: string;
}>;

export type AfcQaCapabilityConfig = Readonly<{
  mode: AfcQaMode;
  allowlist: ReadonlySet<string>;
}>;

const AFC_QA_MODE_SET: ReadonlySet<string> = new Set(AFC_QA_MODES);

export function parseAfcQaMode(raw: string | undefined): AfcQaMode {
  if (raw == null) return "off";
  const value = raw.trim();
  if (AFC_QA_MODE_SET.has(value)) return value as AfcQaMode;
  return "off";
}

export function parseAfcQaUserIds(raw: string | undefined): ReadonlySet<string> {
  if (raw == null) return new Set();
  const ids = new Set<string>();
  for (const token of raw.split(",")) {
    const id = parseUuid(token);
    if (id) ids.add(id.toLowerCase());
  }
  return ids;
}

export function readAfcQaCapabilityConfig(
  env: AfcQaCapabilityEnv | NodeJS.ProcessEnv = process.env,
): AfcQaCapabilityConfig {
  return {
    mode: parseAfcQaMode(env.VIBODE_AFC_QA_MODE),
    allowlist: parseAfcQaUserIds(env.VIBODE_AFC_QA_USER_IDS),
  };
}

export function resolveAfcQaCapabilityForUser(args: {
  userId: string;
  mode: AfcQaMode;
  allowlist: ReadonlySet<string>;
}): AfcQaCapability {
  const userId = parseUuid(args.userId);
  if (!userId) return { enabled: false };
  if (args.mode === "all") return { enabled: true };
  if (args.mode === "allowlist") {
    return { enabled: args.allowlist.has(userId.toLowerCase()) };
  }
  return { enabled: false };
}

export function resolveAfcQaCapability(
  userId: string,
  env: AfcQaCapabilityEnv | NodeJS.ProcessEnv = process.env,
): AfcQaCapability {
  const config = readAfcQaCapabilityConfig(env);
  return resolveAfcQaCapabilityForUser({
    userId,
    mode: config.mode,
    allowlist: config.allowlist,
  });
}

export function freezeAfcQaCapability(
  capability: AfcQaCapability,
): AfcQaCapability {
  const payload = Object.freeze({ enabled: Boolean(capability.enabled) });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

export async function handleAfcQaCapabilityGet(args: {
  request: Request;
  authorize: (request: Request) => Promise<ProductionAfcAuth>;
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
}) {
  const auth = await args.authorize(args.request);
  if (!auth.ok) return auth.response;
  return productionAfcJson(
    freezeAfcQaCapability(
      resolveAfcQaCapability(auth.userId, args.env ?? process.env),
    ),
    200,
  );
}
