/**
 * Opens one private upload for an HEIC photograph that is too large for a
 * Vercel function body. This route does not reserve an allowance.
 */

import { NextResponse } from "next/server";

import { beginPhotoPreparation } from "@/lib/photo-preparation/handler";
import { photoPreparationDeps } from "@/lib/photo-preparation/production.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const deps = photoPreparationDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });
  const result = await beginPhotoPreparation(request, deps);
  if ("signedUrl" in result) {
    return NextResponse.json({
      ok: true,
      preparationId: result.preparationId,
      signedUrl: result.signedUrl,
    });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
