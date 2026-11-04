import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";
import {
  handleBringForwardState,
  type BringForwardRepository,
} from "@/lib/vibode-stage/bring-forward-store";
import {
  authorizeBringForwardIdentity,
  SupabaseBringForwardRepository,
} from "@/lib/vibode-stage/bring-forward-store.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner read and compare-and-swap write for Bring Forward.
 * This route does not call Roboflow and does not reserve a segmentation quota.
 */
export async function GET(request: Request) {
  return handleBringForwardState(request, liveDeps());
}

export async function PUT(request: Request) {
  return handleBringForwardState(request, liveDeps());
}

function liveDeps() {
  const service = getServiceRoleSupabaseClient();
  return {
    getActor: readRemoveActor,
    authorize: authorizeBringForwardIdentity,
    store: service ? new SupabaseBringForwardRepository(service) : UNAVAILABLE_STORE,
    hash: (text: string) => sha256Hex(new TextEncoder().encode(text)),
  };
}

const UNAVAILABLE_STORE: BringForwardRepository = {
  putSnapshot: async () => ({ ok: false, code: "unavailable" }),
  writeSelection: async () => ({ ok: false, code: "unavailable", revision: null }),
  read: async () => ({ ok: false, code: "unavailable" }),
};
