import { NextResponse } from "next/server";

import { discoverAfcUi2aOriginalPreparations } from "@/app/admin/3d-room-lab/research/afc-ui2a-status";
import { isAfcUi2aPreparationEnabled } from "@/lib/vibodeAfcUi2aConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  discover: typeof discoverAfcUi2aOriginalPreparations;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;
function unavailable(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function createAfcUi2aStatusGetHandler(dependencies: RouteDependencies) {
  return async function GET(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    if (dependencies.nodeEnv() === "production") return unavailable("This development-only endpoint is unavailable.");
    if (!dependencies.isEnabled()) return unavailable("AFC controlled input preparation is disabled.");
    const url = new URL(request.url);
    const allowed = new Set(["roomLabel", "expectedFingerprint"]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
      [...url.searchParams.keys()].some((key, index, values) => values.indexOf(key) !== index)) {
      return NextResponse.json({ status: "failure", failureCode: "invalid_request", message: "Unexpected status query parameter." }, { status: 400 });
    }
    const roomLabel = url.searchParams.get("roomLabel") ?? undefined;
    const expectedFingerprint = url.searchParams.get("expectedFingerprint") ?? undefined;
    return NextResponse.json(
      { status: "ok", preparations: await dependencies.discover({ roomLabel, expectedFingerprint }) },
      { headers: { "Cache-Control": "no-store" } }
    );
  };
}

export const GET = createAfcUi2aStatusGetHandler({
  getAuthenticatedAdminUser,
  discover: discoverAfcUi2aOriginalPreparations,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: isAfcUi2aPreparationEnabled,
});
