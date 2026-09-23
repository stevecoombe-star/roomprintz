import { NextResponse } from "next/server";

import {
  createAfcSr1CertifiedEmptyResolver,
  resolveAfcSr1CertifiedEmptyLive,
  type AfcSr1CertifiedEmptyLiveResolution,
  type AfcSr1CertifiedEmptyPackageSelector,
} from "@/app/admin/3d-room-lab/research/afc-sr1-certified-empty-live-resolve";
import {
  executeAfcSr1TiledLiveProductAttempt,
  type AfcSr1TiledLiveProductDependencies,
} from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import type {
  AfcSr1LiveAnalyzeRequest,
  AfcSr1LiveProductResult,
} from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import { isAfcUi2aPreparationEnabled } from "@/lib/vibodeAfcUi2aConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { parseAfcSr1LiveAnalyzeRequest } from "../live-analyze/route";

export const runtime = "nodejs";

type CertifiedEmptyLiveRequest = Readonly<{
  request: AfcSr1LiveAnalyzeRequest;
  selector: AfcSr1CertifiedEmptyPackageSelector;
}>;

type Dependencies = Readonly<{
  authenticateAdmin?: typeof getAuthenticatedAdminUser;
  nodeEnv?: () => string | undefined;
  isEnabled?: () => boolean;
  resolveCertifiedEmpty?: (
    args: Readonly<{
      selector: AfcSr1CertifiedEmptyPackageSelector;
      expectedOriginal: AfcSr1LiveAnalyzeRequest["sourceImageIdentity"];
    }>
  ) => Promise<AfcSr1CertifiedEmptyLiveResolution | null>;
  executeAttempt?: (
    request: AfcSr1LiveAnalyzeRequest,
    dependencies: AfcSr1TiledLiveProductDependencies
  ) => Promise<AfcSr1LiveProductResult>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

export function parseAfcSr1CertifiedEmptyLiveRequest(
  value: unknown
): CertifiedEmptyLiveRequest | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "attemptId",
      "sourceImageUrl",
      "sourceImageIdentity",
      "labLoadGeneration",
      "referenceDepthM",
      "certifiedEmptyPackage",
    ]) ||
    !isRecord(value.certifiedEmptyPackage) ||
    !exactKeys(value.certifiedEmptyPackage, [
      "roomId",
      "packageId",
      "receiptFileName",
      "receiptSha256",
    ]) ||
    typeof value.certifiedEmptyPackage.roomId !== "string" ||
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.certifiedEmptyPackage.roomId) ||
    typeof value.certifiedEmptyPackage.packageId !== "string" ||
    typeof value.certifiedEmptyPackage.receiptFileName !== "string" ||
    typeof value.certifiedEmptyPackage.receiptSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.certifiedEmptyPackage.receiptSha256)
  ) {
    return null;
  }
  const request = parseAfcSr1LiveAnalyzeRequest({
    attemptId: value.attemptId,
    sourceImageUrl: value.sourceImageUrl,
    sourceImageIdentity: value.sourceImageIdentity,
    labLoadGeneration: value.labLoadGeneration,
    referenceDepthM: value.referenceDepthM,
  });
  if (!request) return null;
  return Object.freeze({
    request,
    selector: Object.freeze({
      roomId: value.certifiedEmptyPackage.roomId,
      packageId: value.certifiedEmptyPackage.packageId,
      receiptFileName: value.certifiedEmptyPackage.receiptFileName,
      receiptSha256: value.certifiedEmptyPackage.receiptSha256,
    }),
  });
}

function json(body: unknown, status: number): NextResponse {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function createAfcSr1LiveAnalyzeCertifiedEmptyPostHandler(
  dependencies: Dependencies = {}
) {
  return async function POST(request: Request): Promise<NextResponse> {
    const admin = await (dependencies.authenticateAdmin ?? getAuthenticatedAdminUser)();
    if (!admin) return json({ error: "Admin access required." }, 403);
    if ((dependencies.nodeEnv ?? (() => process.env.NODE_ENV))() === "production") {
      return json({ error: "This development-only endpoint is unavailable." }, 404);
    }
    if (!(dependencies.isEnabled ?? isAfcUi2aPreparationEnabled)()) {
      return json({ error: "AFC controlled input preparation is disabled." }, 404);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body was not valid JSON." }, 400);
    }
    const parsed = parseAfcSr1CertifiedEmptyLiveRequest(body);
    if (!parsed) return json({ error: "Certified EMPTY AFC request was invalid." }, 400);

    const resolution = await (
      dependencies.resolveCertifiedEmpty ?? resolveAfcSr1CertifiedEmptyLive
    )({
      selector: parsed.selector,
      expectedOriginal: parsed.request.sourceImageIdentity,
    });
    if (!resolution) {
      return json({ error: "The selected certified EMPTY package could not be verified." }, 422);
    }

    const result = await (
      dependencies.executeAttempt ?? executeAfcSr1TiledLiveProductAttempt
    )(parsed.request, {
      resolveEmpty: createAfcSr1CertifiedEmptyResolver(resolution),
    });
    return json(result, 200);
  };
}

export const POST = createAfcSr1LiveAnalyzeCertifiedEmptyPostHandler();
