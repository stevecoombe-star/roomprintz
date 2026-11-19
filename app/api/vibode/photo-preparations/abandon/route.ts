/**
 * Drops a scratch photograph when the customer cancels or replaces it.
 * A conversion that is already running is left to that request's cleanup.
 */

import { NextResponse } from "next/server";

import { abandonPhotoPreparation } from "@/lib/photo-preparation/handler";
import { photoPreparationDeps } from "@/lib/photo-preparation/production.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const deps = photoPreparationDeps();
  if (!deps) return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });
  const result = await abandonPhotoPreparation(request, deps);
  if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
