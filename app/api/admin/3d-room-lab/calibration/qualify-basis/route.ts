import { NextResponse } from "next/server";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  type CalibrationImageBasisKind,
} from "@/app/admin/3d-room-lab/calibration-image-basis";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { qualifyCalibrationImageBasis } from "@/lib/vibodeCalibrationImageBasis";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDimensions(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null;
  const { width, height } = value;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width, height };
}

function parseBasisKind(value: unknown): CalibrationImageBasisKind {
  return value === "derivative" ? "derivative" : "original";
}

export async function POST(request: Request) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) {
    return NextResponse.json({ qualified: false, reason: "basis_unavailable" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        qualified: false,
        reason: "basis_unavailable",
        message: "Request body was not valid JSON.",
      },
      { status: 200 }
    );
  }

  const record = isRecord(body) ? body : {};
  const imageUrl = safeString(record.imageUrl) ?? "";
  const browserDimensions = parseDimensions(record.browserDimensions);
  const coordinateSpaceVersion = isRecord(record.coordinateSpaceVersion)
    ? record.coordinateSpaceVersion
    : CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION;
  const basisKind = parseBasisKind(record.basisKind);

  const result = await qualifyCalibrationImageBasis({
    imageUrl,
    browserDimensions,
    coordinateSpaceVersion: coordinateSpaceVersion as typeof CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind,
    fetch: {
      allowedHosts: getAutoFloorVisionAllowedImageHosts(),
      maxBytes: getAutoFloorVisionImageMaxBytes(),
      timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
      allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        qualified: false,
        reason: result.reason,
        message: result.message,
      },
      { status: 200 }
    );
  }

  return NextResponse.json(
    {
      qualified: true,
      basis: result.basis,
    },
    { status: 200 }
  );
}
