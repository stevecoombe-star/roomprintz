import { NextRequest, NextResponse } from "next/server";
import { runGeminiRoomReadFromImageUrl } from "@/lib/vibodeGeminiRoomRead";

export const runtime = "nodejs";

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const imageUrl =
      safeStr(body.imageUrl) ??
      safeStr(body.baseImageUrl) ??
      safeStr(body.workingImageUrl) ??
      safeStr(body.url) ??
      safeStr(body.imagePath);
    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl is required." }, { status: 400 });
    }

    const modelVersion = safeStr(body.modelVersion) ?? "gemini-3-flash-preview";
    console.log("[vibode/room-read] request started", {
      hasImageUrl: true,
      vibodeRoomId: safeStr(body.vibodeRoomId),
      assetId: safeStr(body.assetId),
      modelVersion,
    });

    const objects = await runGeminiRoomReadFromImageUrl({ imageUrl, modelVersion });
    console.log("[vibode/room-read] normalized labels returned", {
      count: objects.length,
      labels: objects.map((item) => item.label),
    });

    return NextResponse.json({ objects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[vibode/room-read] failed fallback", { message });
    return NextResponse.json({ error: "Room-read failed.", message }, { status: 500 });
  }
}
