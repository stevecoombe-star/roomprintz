import { parseUuid } from "@/lib/afc-v2-production/production-http";

/**
 * Server-gated transform gizmos for internal STAGE use.
 *
 * VIBODE_STAGE_GIZMOS is the only switch:
 * - unset or off: gizmos stay off
 * - allowlist: only ids in VIBODE_STAGE_GIZMOS_USER_IDS
 * - all: every signed-in user
 *
 * Admin email and AFC QA access do not enable gizmos. The browser only
 * receives `{ enabled }` and cannot turn them on.
 */

export const STAGE_GIZMO_MODES = ["off", "allowlist", "all"] as const;
export type StageGizmoMode = (typeof STAGE_GIZMO_MODES)[number];

const STAGE_GIZMO_MODE_SET: ReadonlySet<string> = new Set(STAGE_GIZMO_MODES);

export function parseStageGizmoMode(raw: string | undefined): StageGizmoMode {
  if (raw == null) return "off";
  const value = raw.trim();
  if (STAGE_GIZMO_MODE_SET.has(value)) return value as StageGizmoMode;
  return "off";
}

export function parseStageGizmoAllowlist(raw: string | undefined): ReadonlySet<string> {
  if (raw == null) return new Set();
  const ids = new Set<string>();
  for (const token of raw.split(",")) {
    const id = parseUuid(token);
    if (id) ids.add(id.toLowerCase());
  }
  return ids;
}

export function stageTransformGizmosEnabled(input: Readonly<{
  userId: string;
  stageMode: string | undefined;
  stageAllowlist: ReadonlySet<string>;
}>): boolean {
  const userId = parseUuid(input.userId);
  if (!userId) return false;
  const mode = parseStageGizmoMode(input.stageMode);
  if (mode === "all") return true;
  if (mode === "allowlist") return input.stageAllowlist.has(userId.toLowerCase());
  return false;
}

/** Body Move, Rotate, and Size stay available when the gizmo is hidden. */
export function stageDirectManipulationAvailable(gizmosVisible: boolean): boolean {
  return gizmosVisible || gizmosVisible === false;
}
