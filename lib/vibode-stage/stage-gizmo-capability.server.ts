import "server-only";

import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";

import {
  parseStageGizmoAllowlist,
  stageTransformGizmosEnabled,
} from "./stage-gizmo-capability";

export async function handleStageTransformGizmosGet(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const enabled = stageTransformGizmosEnabled({
    userId: auth.userId,
    stageMode: process.env.VIBODE_STAGE_GIZMOS,
    stageAllowlist: parseStageGizmoAllowlist(process.env.VIBODE_STAGE_GIZMOS_USER_IDS),
  });
  const payload = Object.freeze({ enabled });
  assertProductionPayloadPrivacy(payload);
  return productionAfcJson(payload, 200);
}
