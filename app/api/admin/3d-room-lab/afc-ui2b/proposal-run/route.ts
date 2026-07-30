import { NextResponse } from "next/server";

import { runAfcUi2bControlledProposal, type AfcUi2bProposalRunResult } from "@/app/admin/3d-room-lab/research/afc-ui2b-proposal-run";
import { isAfcUi2bProposalRunnerEnabled } from "@/lib/vibodeAfcUi2bConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 16 * 1024;

type RouteDependencies = Readonly<{
  getAuthenticatedAdminUser: typeof getAuthenticatedAdminUser;
  run: (raw: unknown) => Promise<AfcUi2bProposalRunResult>;
  nodeEnv: () => string | undefined;
  isEnabled: () => boolean;
}>;
function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function zeroAttemptFailure(failureCode: "invalid_input" | "unexpected_failure", message: string) {
  return {
    status: "failure" as const, failureCode, message,
    geminiFloorProposalCall: false, providerCallCount: 0 as const,
    proposalReceiptWritten: false, companionReceiptWritten: false,
  };
}
function statusFor(result: AfcUi2bProposalRunResult): number {
  if (result.status !== "failure") return 200;
  switch (result.failureCode) {
    case "capture_not_authorized":
    case "provider_call_not_authorized":
      return 403;
    case "package_not_found":
      return 404;
    case "package_receipt_hash_mismatch":
    case "run_in_progress":
      return 409;
    case "package_receipt_invalid":
    case "package_replay_failed":
    case "package_room_mismatch":
    case "unsupported_study_mode":
    case "runner_binding_invalid":
    case "manifest_validation_failed":
    case "selected_image_invalid":
    case "runner_validation_failed":
    case "proposal_contract_invalid":
    case "proposal_replay_failed":
      return 422;
    case "provider_configuration_unavailable":
      return 503;
    case "provider_non_success":
    case "provider_response_invalid":
      return 502;
    case "proposal_capture_failed":
    case "proposal_receipt_validation_failed":
    case "unexpected_failure":
      return 500;
    case "invalid_input":
      return 400;
  }
}

export function createAfcUi2bProposalRunPostHandler(dependencies: RouteDependencies) {
  return async function POST(request: Request) {
    const adminUser = await dependencies.getAuthenticatedAdminUser();
    if (!adminUser) return json({ error: "Admin access required." }, 403);
    if (dependencies.nodeEnv() === "production") return json({ error: "This development-only endpoint is unavailable." }, 404);
    if (!dependencies.isEnabled()) return json({ error: "AFC controlled proposal running is disabled." }, 404);
    const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return json(zeroAttemptFailure("invalid_input", "The proposal-run request must use JSON."), 415);
    }
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return json(zeroAttemptFailure("invalid_input", "The proposal-run request is too large."), 413);
    }
    let text: string;
    try { text = await request.text(); } catch {
      return json(zeroAttemptFailure("invalid_input", "The proposal-run request must be valid JSON."), 400);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return json(zeroAttemptFailure("invalid_input", "The proposal-run request is too large."), 413);
    }
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      return json(zeroAttemptFailure("invalid_input", "The proposal-run request must be valid JSON."), 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(zeroAttemptFailure("invalid_input", "The proposal-run request must be a JSON object."), 400);
    }
    try {
      const result = await dependencies.run(body);
      return json(result, statusFor(result));
    } catch {
      return json(zeroAttemptFailure("unexpected_failure", "The controlled proposal operation could not be completed."), 500);
    }
  };
}

export const POST = createAfcUi2bProposalRunPostHandler({
  getAuthenticatedAdminUser,
  run: runAfcUi2bControlledProposal,
  nodeEnv: () => process.env.NODE_ENV,
  isEnabled: isAfcUi2bProposalRunnerEnabled,
});
