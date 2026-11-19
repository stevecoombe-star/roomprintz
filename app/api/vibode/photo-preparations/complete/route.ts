/**
 * Converts one privately uploaded HEIC photograph and deletes the original.
 * The response is the normalized JPEG. No allowance is reserved.
 */

import { NextResponse } from "next/server";

import { convertPreparedPhoto } from "@/lib/photo-preparation/convert.server";
import { completePhotoPreparation } from "@/lib/photo-preparation/handler";
import { photoPreparationDeps } from "@/lib/photo-preparation/production.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const deps = photoPreparationDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });
  const result = await completePhotoPreparation(request, { ...deps, convert: convertPreparedPhoto });
  if ("bytes" in result) {
    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
