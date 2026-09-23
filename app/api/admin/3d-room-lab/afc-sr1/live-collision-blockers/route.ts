import { NextResponse } from "next/server";

import type {
  P2S2HLiveCollisionBlockersRequest,
} from "@/app/admin/3d-room-lab/p2-s2h-live-collision-blockers-contract";
import {
  produceP2S2HLiveCollisionBlockers,
} from "@/app/admin/3d-room-lab/p2-s2h-live-collision-blockers-server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

const LIVE_ID = /^[A-Za-z0-9._-]{1,180}$/;

type Dependencies = Readonly<{
  authenticateAdmin?: typeof getAuthenticatedAdminUser;
  produceBlockers?: typeof produceP2S2HLiveCollisionBlockers;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function parseP2S2HLiveCollisionBlockersRequest(
  value: unknown
): P2S2HLiveCollisionBlockersRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "attemptId",
      "resultId",
      "labLoadGeneration",
      "freezeReceipt",
    ]) ||
    typeof value.attemptId !== "string" ||
    !LIVE_ID.test(value.attemptId) ||
    typeof value.resultId !== "string" ||
    !LIVE_ID.test(value.resultId) ||
    !Number.isSafeInteger(value.labLoadGeneration) ||
    (value.labLoadGeneration as number) < 0 ||
    !isRecord(value.freezeReceipt)
  ) {
    return null;
  }
  return Object.freeze({
    attemptId: value.attemptId,
    resultId: value.resultId,
    labLoadGeneration: value.labLoadGeneration as number,
    freezeReceipt: value.freezeReceipt,
  });
}

function json(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function createP2S2HLiveCollisionBlockersPostHandler(
  dependencies: Dependencies = {}
) {
  return async function post(request: Request): Promise<NextResponse> {
    const admin = await (
      dependencies.authenticateAdmin ?? getAuthenticatedAdminUser
    )();
    if (!admin) return json({ error: "Admin access required." }, 403);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body was not valid JSON." }, 400);
    }
    const parsed = parseP2S2HLiveCollisionBlockersRequest(body);
    if (!parsed) {
      return json({ error: "AFC live blocker request was invalid." }, 400);
    }

    const result = await (
      dependencies.produceBlockers ?? produceP2S2HLiveCollisionBlockers
    )(parsed);
    return json(result, 200);
  };
}

export const POST = createP2S2HLiveCollisionBlockersPostHandler();
