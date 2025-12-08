// app/api/stage-room/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callCompositorEngine } from "@/lib/callCompositorEngine";

// Ensure we run on the Node.js runtime (needed for Buffer, larger payloads, etc.)
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing or invalid file in form-data (expected 'file')." },
        { status: 400 }
      );
    }

    const styleIdRaw = formData.get("styleId");
    const styleId =
      typeof styleIdRaw === "string" && styleIdRaw.trim().length > 0
        ? styleIdRaw
        : null;

    const enhancePhoto =
      (formData.get("enhancePhoto") as string | null) === "true";
    const cleanupRoom =
      (formData.get("cleanupRoom") as string | null) === "true";
    const repairDamage =
      (formData.get("repairDamage") as string | null) === "true";
    const emptyRoom =
      (formData.get("emptyRoom") as string | null) === "true";
    const renovateRoom =
      (formData.get("renovateRoom") as string | null) === "true";
    const repaintWalls =
      (formData.get("repaintWalls") as string | null) === "true";

    const flooringPresetRaw =
      ((formData.get("flooringPreset") as string | null) || "").trim();
    const flooringPreset =
      flooringPresetRaw === "" || flooringPresetRaw === "none"
        ? null
        : flooringPresetRaw; // null or "carpet"/"hardwood"/"tile"

    // NEW: roomType
    const roomTypeRaw = formData.get("roomType");
    const roomType =
      typeof roomTypeRaw === "string" && roomTypeRaw.trim().length > 0
        ? roomTypeRaw.trim()
        : null;

    // Safety check: at least one action
    if (
      !styleId &&
      !enhancePhoto &&
      !cleanupRoom &&
      !repairDamage &&
      !emptyRoom &&
      !renovateRoom &&
      !repaintWalls &&
      !flooringPreset
    ) {
      return NextResponse.json(
        {
          error:
            "No styleId and no photo tools selected. Nothing to do for stage-room.",
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const result = await callCompositorEngine({
      imageBytes: bytes,
      styleId,
      enhancePhoto,
      cleanupRoom,
      repairDamage,
      emptyRoom,
      renovateRoom,
      repaintWalls,
      flooringPreset,
      roomType, // NEW
    });

    const imageUrl = result?.imageUrl ?? null;
    const originalImageUrl = result?.originalImageUrl ?? null;

    if (!imageUrl) {
      return NextResponse.json(
        { error: "Compositor did not return an imageUrl." },
        { status: 500 }
      );
    }

    return NextResponse.json({ imageUrl, originalImageUrl });
  } catch (err: any) {
    console.error("[stage-room] unexpected error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error in /api/stage-room" },
      { status: 500 }
    );
  }
}

