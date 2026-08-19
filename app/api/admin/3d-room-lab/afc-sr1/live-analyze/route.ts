import { NextResponse } from "next/server";

import {
  executeAfcSr1TiledLiveProductAttempt,
} from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import type {
  AfcSr1LiveAnalyzeRequest,
  AfcSr1LiveProductResult,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";

export const runtime = "nodejs";

type Dependencies = Readonly<{
  authenticateAdmin?: typeof getAuthenticatedAdminUser;
  executeAttempt?: (
    request: AfcSr1LiveAnalyzeRequest
  ) => Promise<AfcSr1LiveProductResult>;
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

export function parseAfcSr1LiveAnalyzeRequest(
  value: unknown
): AfcSr1LiveAnalyzeRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "attemptId",
      "sourceImageUrl",
      "sourceImageIdentity",
      "labLoadGeneration",
      "referenceDepthM",
    ]) ||
    typeof value.attemptId !== "string" ||
    !/^[A-Za-z0-9._-]{1,180}$/.test(value.attemptId) ||
    typeof value.sourceImageUrl !== "string" ||
    value.sourceImageUrl.length === 0 ||
    value.sourceImageUrl.length > 4096 ||
    !Number.isSafeInteger(value.labLoadGeneration) ||
    (value.labLoadGeneration as number) < 0 ||
    typeof value.referenceDepthM !== "number" ||
    !Number.isFinite(value.referenceDepthM) ||
    value.referenceDepthM <= 0 ||
    !isRecord(value.sourceImageIdentity) ||
    !exactKeys(value.sourceImageIdentity, [
      "sha256",
      "decodedWidth",
      "decodedHeight",
      "orientation",
    ]) ||
    typeof value.sourceImageIdentity.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceImageIdentity.sha256) ||
    !Number.isSafeInteger(value.sourceImageIdentity.decodedWidth) ||
    (value.sourceImageIdentity.decodedWidth as number) <= 0 ||
    !Number.isSafeInteger(value.sourceImageIdentity.decodedHeight) ||
    (value.sourceImageIdentity.decodedHeight as number) <= 0 ||
    value.sourceImageIdentity.orientation !== 1
  ) {
    return null;
  }
  return Object.freeze({
    attemptId: value.attemptId,
    sourceImageUrl: value.sourceImageUrl,
    sourceImageIdentity: Object.freeze({
      sha256: value.sourceImageIdentity.sha256,
      decodedWidth: value.sourceImageIdentity.decodedWidth as number,
      decodedHeight: value.sourceImageIdentity.decodedHeight as number,
      orientation: 1,
    }),
    labLoadGeneration: value.labLoadGeneration as number,
    referenceDepthM: value.referenceDepthM,
  });
}

function json(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function createAfcSr1LiveAnalyzePostHandler(
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
    const parsed = parseAfcSr1LiveAnalyzeRequest(body);
    if (!parsed) return json({ error: "AFC live request was invalid." }, 400);

    const result = await (
      dependencies.executeAttempt ?? executeAfcSr1TiledLiveProductAttempt
    )(parsed);
    return json(result, 200);
  };
}

export const POST = createAfcSr1LiveAnalyzePostHandler();
