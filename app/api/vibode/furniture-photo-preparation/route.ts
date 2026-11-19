/**
 * Prepares one iPhone HEIC or HEIF photo as a JPEG. JPEG, PNG, and WebP
 * photos are normalized in the browser and never reach this route.
 * This route does not reserve an allowance or contact the generation provider.
 */

import { NextResponse } from "next/server";

import { convertHeicBufferToBoundedJpeg } from "@/lib/heicServerConversion";
import { authorizeFurnitureGenerationCaller } from "@/lib/vibode-furniture/generation/production.server";
import { handleFurnitureHeicPreparation } from "@/lib/vibode-furniture/generator/heic-preparation";
import {
  FURNITURE_JPEG_MATTE,
  FURNITURE_PHOTO_MAX_DECODED_PIXELS,
  FURNITURE_PHOTO_MAX_EDGE_PX,
  FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
  FURNITURE_PHOTO_MIN_EDGE_PX,
} from "@/lib/vibode-furniture/generator/photo-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const result = await handleFurnitureHeicPreparation(request, {
    authorize: async (incoming) => {
      const caller = await authorizeFurnitureGenerationCaller(incoming);
      if (!caller.ok) return { ok: false as const, status: caller.response.status, error: caller.response.body.error };
      return { ok: true as const };
    },
    convert: async (bytes) => {
      const bounded = await convertHeicBufferToBoundedJpeg(bytes, {
        maxEdgePx: FURNITURE_PHOTO_MAX_EDGE_PX,
        maxBytes: FURNITURE_PHOTO_MAX_OUTPUT_BYTES,
        maxInputPixels: FURNITURE_PHOTO_MAX_DECODED_PIXELS,
        minEdgePx: FURNITURE_PHOTO_MIN_EDGE_PX,
        background: FURNITURE_JPEG_MATTE,
      });
      return { bytes: bounded.bytes };
    },
  });
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
