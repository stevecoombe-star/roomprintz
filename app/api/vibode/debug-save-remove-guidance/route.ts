import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const runtime = "nodejs";

const DEBUG_OUTPUT_DIR = path.join(
  homedir(),
  "Documents",
  "roomprintz",
  "roomprintz-compositor",
  "tmp",
  "vibode_debug"
);

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; ext: "png" | "jpg" } | null {
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64 = match[2];
  const ext: "png" | "jpg" = mime === "image/png" ? "png" : "jpg";
  return {
    buffer: Buffer.from(base64, "base64"),
    ext,
  };
}

async function fetchImageUrlToBuffer(imageUrl: string): Promise<{ buffer: Buffer; ext: "png" | "jpg" }> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch image URL (HTTP ${res.status}).`);
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext: "png" | "jpg" =
    contentType.includes("image/png") ? "png" : contentType.includes("image/jpeg") ? "jpg" : "jpg";
  const bytes = Buffer.from(await res.arrayBuffer());
  return { buffer: bytes, ext };
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (!isTruthy(process.env.VIBODE_DEBUG_SAVE_REMOVE_GUIDANCE_IMAGES)) {
      return NextResponse.json({ error: "Debug save disabled." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      image1DataUrl?: unknown;
      image1Url?: unknown;
      image2DataUrl?: unknown;
      roomId?: unknown;
      versionId?: unknown;
      targetCount?: unknown;
      manifest?: unknown;
      promptText?: unknown;
    };

    const image2DataUrl = typeof body.image2DataUrl === "string" ? body.image2DataUrl.trim() : "";
    const image2Parsed = dataUrlToBuffer(image2DataUrl);
    if (!image2Parsed) {
      return NextResponse.json({ error: "image2DataUrl must be a PNG/JPEG data URL." }, { status: 400 });
    }

    let image1Buffer: Buffer | null = null;
    let image1Ext: "png" | "jpg" = "png";
    const image1DataUrl = typeof body.image1DataUrl === "string" ? body.image1DataUrl.trim() : "";
    const image1Url = typeof body.image1Url === "string" ? body.image1Url.trim() : "";

    if (image1DataUrl) {
      const image1Parsed = dataUrlToBuffer(image1DataUrl);
      if (!image1Parsed) {
        return NextResponse.json({ error: "image1DataUrl must be a PNG/JPEG data URL." }, { status: 400 });
      }
      image1Buffer = image1Parsed.buffer;
      image1Ext = image1Parsed.ext;
    } else if (image1Url) {
      const image1Fetched = await fetchImageUrlToBuffer(image1Url);
      image1Buffer = image1Fetched.buffer;
      image1Ext = image1Fetched.ext;
    } else {
      return NextResponse.json({ error: "Provide image1DataUrl or image1Url." }, { status: 400 });
    }

    await mkdir(DEBUG_OUTPUT_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const roomSuffix = typeof body.roomId === "string" && body.roomId.trim().length > 0 ? `-${body.roomId}` : "";
    const versionSuffix =
      typeof body.versionId === "string" && body.versionId.trim().length > 0 ? `-${body.versionId}` : "";
    const targetSuffix =
      typeof body.targetCount === "number" && Number.isFinite(body.targetCount)
        ? `-targets-${Math.max(0, Math.floor(body.targetCount))}`
        : "";

    const image1Filename = `remove-mode-image-1-source-${timestamp}${roomSuffix}${versionSuffix}.${image1Ext}`;
    const image2Filename = `remove-mode-image-2-guidance-${timestamp}${roomSuffix}${versionSuffix}${targetSuffix}.${image2Parsed.ext}`;
    const manifestFilename = `remove-mode-guidance-manifest-${timestamp}${roomSuffix}${versionSuffix}${targetSuffix}.json`;
    const image1Path = path.join(DEBUG_OUTPUT_DIR, image1Filename);
    const image2Path = path.join(DEBUG_OUTPUT_DIR, image2Filename);
    const manifestPath = path.join(DEBUG_OUTPUT_DIR, manifestFilename);

    await writeFile(image1Path, image1Buffer);
    await writeFile(image2Path, image2Parsed.buffer);
    const manifestPayload = {
      roomId: typeof body.roomId === "string" ? body.roomId : null,
      versionId: typeof body.versionId === "string" ? body.versionId : null,
      targetCount:
        typeof body.targetCount === "number" && Number.isFinite(body.targetCount)
          ? Math.max(0, Math.floor(body.targetCount))
          : null,
      manifest: body.manifest ?? null,
      promptText: typeof body.promptText === "string" ? body.promptText : "",
      savedAt: new Date().toISOString(),
    };
    await writeFile(manifestPath, JSON.stringify(manifestPayload, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      savedDir: DEBUG_OUTPUT_DIR,
      savedFiles: [image1Filename, image2Filename, manifestFilename],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to save debug remove guidance images.", message }, { status: 500 });
  }
}
