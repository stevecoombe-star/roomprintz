import { NextResponse } from "next/server";

import { prepareAfcUi2aOriginal, type AfcUi2aPreparationResult } from "@/app/admin/3d-room-lab/research/afc-ui2a-prepare-original";
import { isAfcUi2aPreparationEnabled } from "@/lib/vibodeAfcUi2aConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 32 * 1024;

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  prepare: (rawRequest: unknown) => Promise<AfcUi2aPreparationResult>;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;
function unavailable(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}
function resultStatus(result: AfcUi2aPreparationResult): number {
  if (result.status === "prepared") return 200;
  return result.failureCode === "image_fingerprint_mismatch" || result.failureCode === "image_dimension_mismatch" ? 409 : 400;
}

export function createAfcUi2aPreparePostHandler(dependencies: RouteDependencies) {
  return async function POST(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    if (dependencies.nodeEnv() === "production") return unavailable("This development-only endpoint is unavailable.");
    if (!dependencies.isEnabled()) return unavailable("AFC controlled input preparation is disabled.");
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return NextResponse.json({ status: "failure", failureCode: "invalid_request", message: "The preparation request is too large." }, { status: 413 });
    }
    let body: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new Error("body too large");
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ status: "failure", failureCode: "invalid_request", message: "The preparation request must be valid JSON." }, { status: 400 });
    }
    const result = await dependencies.prepare(body);
    return NextResponse.json(result, { status: resultStatus(result), headers: { "Cache-Control": "no-store" } });
  };
}

export const POST = createAfcUi2aPreparePostHandler({
  getAuthenticatedAdminUser,
  prepare: prepareAfcUi2aOriginal,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: isAfcUi2aPreparationEnabled,
});
