// app/api/vibode/upload-base/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var (tried: ${names.join(", ")})`);
}

const SUPABASE_URL = mustEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

const BUCKET = "vibode-base-images";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    // Attempt to infer extension
    const mime = file.type || "image/jpeg";
    const ext =
      mime === "image/png"
        ? "png"
        : mime === "image/webp"
        ? "webp"
        : "jpg";

    const sceneId = formData.get("sceneId") || "unknown";
    const ts = Date.now();

    const storageKey = `scene_${sceneId}/base_${ts}.${ext}`;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, bytes, {
        contentType: mime,
        upsert: false,
      });

    if (uploadErr) {
      console.error("[upload-base] upload error:", uploadErr);
      return NextResponse.json(
        { error: "Upload failed", details: uploadErr },
        { status: 500 }
      );
    }

    // Create a signed URL (24h)
    const { data: signed, error: signErr } =
      await supabase.storage.from(BUCKET).createSignedUrl(storageKey, 60 * 60 * 24);

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: "Failed to create signed URL" },
        { status: 500 }
      );
    }

    // Extract image dimensions (Node-friendly)
    let widthPx: number | undefined;
    let heightPx: number | undefined;

    try {
      const sharp = await import("sharp");
      const meta = await sharp.default(bytes).metadata();
      widthPx = meta.width;
      heightPx = meta.height;
    } catch {
      // Non-fatal — editor already has viewport info
    }

    return NextResponse.json({
      storageKey,
      signedUrl: signed.signedUrl,
      widthPx,
      heightPx,
    });
  } catch (err) {
    console.error("[upload-base] unexpected error:", err);
    return NextResponse.json(
      { error: "Unexpected upload error" },
      { status: 500 }
    );
  }
}
