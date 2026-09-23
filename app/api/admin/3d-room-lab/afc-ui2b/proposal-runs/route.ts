import { NextResponse } from "next/server";

import { discoverAfcUi2bProposalRuns, type AfcUi2bProposalRunInventoryResult } from "@/app/admin/3d-room-lab/research/afc-ui2b-proposal-run-inventory";
import { isAfcUi2bProposalRunnerEnabled } from "@/lib/vibodeAfcUi2bConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";
const MAX_QUERY_CHARS = 4096;

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  discover: (input: { roomLabel: unknown; packageId?: unknown; studyMode?: unknown }) => Promise<AfcUi2bProposalRunInventoryResult>;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;
function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createAfcUi2bProposalRunsGetHandler(dependencies: RouteDependencies) {
  return async function GET(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return json({ error: "Admin access required." }, 403);
    if (dependencies.nodeEnv() === "production") return json({ error: "This development-only endpoint is unavailable." }, 404);
    if (!dependencies.isEnabled()) return json({ error: "AFC controlled proposal running is disabled." }, 404);
    const url = new URL(request.url);
    if (url.search.length > MAX_QUERY_CHARS) {
      return json({ status: "failure", failureCode: "invalid_input", message: "The proposal-run inventory query is too large." }, 413);
    }
    const allowed = new Set(["roomLabel", "packageId", "studyMode"]);
    const keys = [...url.searchParams.keys()];
    const roomLabel = url.searchParams.get("roomLabel");
    const packageId = url.searchParams.get("packageId");
    const packagePattern = roomLabel && /^[a-z][a-z0-9-]{0,63}$/.test(roomLabel)
      ? new RegExp(`^afc-ui2a-package:${roomLabel}:[a-f0-9]{64}$`)
      : null;
    if (!roomLabel || !packagePattern || keys.some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => url.searchParams.getAll(key).length > 1) ||
      (url.searchParams.has("packageId") && (!packageId || !packagePattern.test(packageId))) ||
      (url.searchParams.has("studyMode") && url.searchParams.get("studyMode") !== "original_only" && url.searchParams.get("studyMode") !== "empty_only")) {
      return json({ status: "failure", failureCode: "invalid_input", message: "A single roomLabel and optional packageId or studyMode are required." }, 400);
    }
    try {
      const result = await dependencies.discover({
        roomLabel,
        ...(url.searchParams.has("packageId") ? { packageId } : {}),
        ...(url.searchParams.has("studyMode") ? { studyMode: url.searchParams.get("studyMode") } : {}),
      });
      return json(result, result.status === "failure"
        ? result.failureCode === "invalid_input" ? 400 : 503
        : 200);
    } catch {
      return json({ status: "failure", failureCode: "inventory_unavailable", message: "The proposal-run inventory is unavailable." }, 500);
    }
  };
}

export const GET = createAfcUi2bProposalRunsGetHandler({
  getAuthenticatedAdminUser,
  discover: discoverAfcUi2bProposalRuns,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: isAfcUi2bProposalRunnerEnabled,
});
