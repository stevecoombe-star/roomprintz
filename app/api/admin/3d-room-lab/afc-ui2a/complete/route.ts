import { NextResponse } from "next/server";

import { completeAfcUi2aPreparedPackage, type AfcUi2aCompleteResult } from "@/app/admin/3d-room-lab/research/afc-ui2a-complete";
import { isAfcUi2aPreparationEnabled } from "@/lib/vibodeAfcUi2aConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 32 * 1024;

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  complete: (rawRequest: unknown) => Promise<AfcUi2aCompleteResult>;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function unavailable(message: string) { return json({ error: message }, 404); }
function resultStatus(result: AfcUi2aCompleteResult): number {
  if (result.status === "package_completed" || result.status === "empty_generation_required") return 200;
  switch (result.failureCode) {
    case "capture_not_authorized": case "empty_generation_disabled": return 403;
    case "empty_generation_in_progress": case "manifest_conflict": return 409;
    case "original_image_mismatch": case "empty_image_mismatch": case "empty_lineage_mismatch":
    case "conflicting_empty_evidence": case "pair_incompatible": case "shared_context_invalid":
    case "manifest_validation_failed": case "package_receipt_validation_failed": case "package_replay_failed": return 422;
    case "unexpected_failure": return 500;
    default: return 400;
  }
}

export function createAfcUi2aCompletePostHandler(dependencies: RouteDependencies) {
  return async function POST(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return json({ error: "Admin access required." }, 403);
    if (dependencies.nodeEnv() === "production") return unavailable("This development-only endpoint is unavailable.");
    if (!dependencies.isEnabled()) return unavailable("AFC controlled input preparation is disabled.");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ status: "failure", failureCode: "invalid_input", message: "The completion request must use JSON.", emptyRoomGenerationCall: false }, 415);
    }
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return json({ status: "failure", failureCode: "invalid_input", message: "The completion request is too large.", emptyRoomGenerationCall: false }, 413);
    }
    let body: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("body too large");
      body = JSON.parse(text);
    } catch {
      return json({ status: "failure", failureCode: "invalid_input", message: "The completion request must be valid JSON.", emptyRoomGenerationCall: false }, 400);
    }
    const result = await dependencies.complete(body);
    return NextResponse.json(result, { status: resultStatus(result), headers: { "Cache-Control": "no-store" } });
  };
}

export const POST = createAfcUi2aCompletePostHandler({
  getAuthenticatedAdminUser,
  complete: completeAfcUi2aPreparedPackage,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: isAfcUi2aPreparationEnabled,
});
