import { NextRequest, NextResponse } from "next/server";
import { runGeminiRoomReadFromImageUrl } from "@/lib/vibodeGeminiRoomRead";
import { getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";
import { resolveRoomReadModelVersion } from "@/lib/vibodeRoomReadModelVersion";

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

    const modelVersion = resolveRoomReadModelVersion(body.modelVersion);
    const mode = body.mode === "geometry" ? "geometry" : "labels_only";
    const requestId = getRequestIdFromHeaders(req.headers, "room-read");
    console.log("[vibode/room-read] request started", {
      hasImageUrl: true,
      vibodeRoomId: safeStr(body.vibodeRoomId),
      assetId: safeStr(body.assetId),
      modelVersion,
    });

    const objects = await runGeminiRoomReadFromImageUrl({
      imageUrl,
      modelVersion,
      mode,
      purpose: safeStr(body.purpose) ?? null,
      accounting: {
        requestId,
        route: "/api/vibode/room-read",
        sourceTrigger: "manual-room-read",
        workflowType: "room-read",
        actionType: "room-read",
        userId: null,
        roomId: safeStr(body.vibodeRoomId) ?? safeStr(body.roomId) ?? null,
        versionId: safeStr(body.versionId) ?? safeStr(body.assetId) ?? null,
        assetId: safeStr(body.assetId) ?? null,
      },
    });
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
