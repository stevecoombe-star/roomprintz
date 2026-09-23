import { NextResponse } from "next/server";

import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { qualifyCalibrationImageBasis } from "@/lib/vibodeCalibrationImageBasis";

export const runtime = "nodejs";

function json(body: unknown, status: number) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function sourceImageUrl(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.sourceImageUrl !== "string") {
    return null;
  }
  const url = record.sourceImageUrl.trim();
  return url.length > 0 && url.length <= 4096 ? url : null;
}

export async function POST(request: Request) {
  if (!(await getAuthenticatedAdminUser())) {
    return json({ error: "Admin access required." }, 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body was not valid JSON." }, 400);
  }
  const imageUrl = sourceImageUrl(body);
  if (!imageUrl) return json({ error: "Original image URL was invalid." }, 400);

  const qualification = await qualifyCalibrationImageBasis({
    imageUrl,
    browserDimensions: null,
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
    fetch: {
      allowedHosts: getAutoFloorVisionAllowedImageHosts(),
      maxBytes: getAutoFloorVisionImageMaxBytes(),
      timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
      allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
    },
  });
  return json(qualification, qualification.ok ? 200 : 422);
}
