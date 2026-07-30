import { NextResponse } from "next/server";

import { discoverAfcUi2aPreparedPackages, type AfcUi2aPackageInventoryResult } from "@/app/admin/3d-room-lab/research/afc-ui2a-package-inventory";
import { isAfcUi2aPreparationEnabled } from "@/lib/vibodeAfcUi2aConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  discover: (roomLabel: unknown) => Promise<AfcUi2aPackageInventoryResult>;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;
function json(body: unknown, status: number) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function unavailable(message: string) { return json({ error: message }, 404); }

export function createAfcUi2aPackagesGetHandler(dependencies: RouteDependencies) {
  return async function GET(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return json({ error: "Admin access required." }, 403);
    if (dependencies.nodeEnv() === "production") return unavailable("This development-only endpoint is unavailable.");
    if (!dependencies.isEnabled()) return unavailable("AFC controlled input preparation is disabled.");
    const url = new URL(request.url);
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== "roomLabel" || url.searchParams.getAll("roomLabel").length !== 1) {
      return json({ status: "failure", failureCode: "invalid_input", message: "A single roomLabel query parameter is required." }, 400);
    }
    const roomLabel = url.searchParams.get("roomLabel");
    if (!roomLabel || !/^[a-z][a-z0-9-]{0,63}$/.test(roomLabel)) {
      return json({ status: "failure", failureCode: "invalid_input", message: "The roomLabel query parameter is invalid." }, 400);
    }
    const result = await dependencies.discover(roomLabel);
    return NextResponse.json(result, {
      status: result.status === "failure" && result.failureCode === "invalid_input" ? 400 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  };
}

export const GET = createAfcUi2aPackagesGetHandler({
  getAuthenticatedAdminUser,
  discover: discoverAfcUi2aPreparedPackages,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: isAfcUi2aPreparationEnabled,
});
