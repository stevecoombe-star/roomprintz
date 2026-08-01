import { NextResponse } from "next/server";

import {
  discoverAfcProposalReceipts,
  replayAfcProposalOverlay,
  type AfcProposalOverlayReplay,
} from "@/app/admin/3d-room-lab/research/afc-proposal-overlay-view-model";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  discover: typeof discoverAfcProposalReceipts;
  replay: typeof replayAfcProposalOverlay;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;

function unavailable(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

function responseForReplay(result: AfcProposalOverlayReplay) {
  return result.status === "valid"
    ? NextResponse.json({ status: "valid", viewModel: result.viewModel })
    : NextResponse.json(result, { status: 400 });
}

async function responseForDiscovery(discover: RouteDependencies["discover"]) {
  const inventory = await discover();
  return NextResponse.json({
    status: "valid",
    receipts: inventory.receipts,
    invalidCandidateCount: inventory.invalidCandidateCount,
  });
}

/**
 * Read-only development route. It only replays immutable, locally captured
 * evidence; it never imports a provider, runner, capture writer, compositor,
 * or scene authority module.
 */
export function createAfcProposalOverlayGetHandler(dependencies: RouteDependencies) {
  return async function GET(request: Request) {
    // Match the existing AFC admin convention: authenticate before exposing any
    // development-only gate; production remains unavailable to authenticated use.
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    if (dependencies.nodeEnv() === "production") return unavailable("This development-only endpoint is unavailable.");
    if (!dependencies.isEnabled()) return unavailable("AFC proposal overlay is disabled.");
    const url = new URL(request.url);
    const operation = url.searchParams.get("operation");
    if (!operation) {
      if (url.searchParams.size !== 0) {
        return NextResponse.json({ status: "invalid", reason: "An operation is required when query parameters are supplied.", path: "$.operation" }, { status: 400 });
      }
      return responseForDiscovery(dependencies.discover);
    }
    if (operation === "receipts") {
      if (url.searchParams.size !== 1) {
        return NextResponse.json({ status: "invalid", reason: "Unexpected receipt-discovery parameter.", path: "$.query" }, { status: 400 });
      }
      return responseForDiscovery(dependencies.discover);
    }
    const receiptFileName = url.searchParams.get("receipt");
    if (!receiptFileName) return NextResponse.json({ status: "invalid", reason: "Receipt filename is required.", path: "$.receipt" }, { status: 400 });
    if (operation === "load" && url.searchParams.size !== 2) {
      return NextResponse.json({ status: "invalid", reason: "Unexpected load parameter.", path: "$.query" }, { status: 400 });
    }
    if (operation === "image" && url.searchParams.size !== 4) {
      return NextResponse.json({ status: "invalid", reason: "Unexpected image parameter.", path: "$.query" }, { status: 400 });
    }
    const replay = await dependencies.replay({ receiptFileName });
    if (operation === "load") return responseForReplay(replay);
    if (operation === "image") {
      const role = url.searchParams.get("role");
      const receiptSha256 = url.searchParams.get("receiptSha256");
      if (role !== "original" && role !== "empty") return NextResponse.json({ status: "invalid", reason: "Image role is invalid.", path: "$.role" }, { status: 400 });
      if (replay.status !== "valid") return responseForReplay(replay);
      if (receiptSha256 !== replay.viewModel.artifactIdentity.receiptSha256) {
        return NextResponse.json({ status: "invalid", reason: "Requested receipt digest does not match the freshly replayed receipt.", path: "$.receiptSha256" }, { status: 409 });
      }
      const image = replay.images[role];
      return new NextResponse(new Uint8Array(image.bytes), {
        status: 200,
        headers: {
          "Content-Type": image.mimeType,
          "Content-Length": String(image.bytes.byteLength),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-AFC-UI1-Image-SHA256": image.sha256,
        },
      });
    }
    return NextResponse.json({ status: "invalid", reason: "Unsupported operation.", path: "$.operation" }, { status: 400 });
  };
}

export const GET = createAfcProposalOverlayGetHandler({
  getAuthenticatedAdminUser,
  discover: discoverAfcProposalReceipts,
  replay: replayAfcProposalOverlay,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: () => process.env.AFC_UI1_PROPOSAL_OVERLAY_ENABLED === "true",
});
