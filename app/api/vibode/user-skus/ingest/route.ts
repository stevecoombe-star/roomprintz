import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractPreparedUserSkuCandidate,
  saveMyFurnitureFromPreparedUserSku,
} from "@/lib/vibodeMyFurniture";

export const runtime = "nodejs";

type IngestBody = {
  imageUrl?: string;
  imageBase64?: string;
  label?: string;
};

type AnySupabaseClient = SupabaseClient<any, "public", any>;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const INGEST_SOURCE_HEADER = "x-roomprintz-ingest-source";

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function resolveIngestSourceType(req: NextRequest, body: IngestBody): string {
  const sourceFromHeader = safeString(req.headers.get(INGEST_SOURCE_HEADER));
  if (sourceFromHeader) return sourceFromHeader.toLowerCase();
  if (safeString(body.imageBase64)) return "upload";
  if (safeString(body.imageUrl)) return "url";
  return "unknown";
}

function resolveIngestSourceLabel(body: IngestBody): string | null {
  const label = safeString(body.label);
  if (label) return label;
  const imageUrl = safeString(body.imageUrl);
  if (!imageUrl) return null;
  try {
    return new URL(imageUrl).hostname;
  } catch {
    return imageUrl;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IngestBody;
    const accessToken = getBearerToken(req);
    const compositorBase = (process.env.VIBODE_COMPOSITOR_URL ?? "http://localhost:8000").replace(
      /\/$/,
      ""
    );
    const upstream = `${compositorBase}/api/vibode/user-skus/ingest`;

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        imageUrl: body.imageUrl,
        imageBase64: body.imageBase64,
        label: body.label,
      }),
    });

    const raw = await upstreamRes.text();
    let parsed: any = null;

    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!upstreamRes.ok) {
      return NextResponse.json(
        {
          error: "Failed to ingest user SKU.",
          detail: parsed ?? raw ?? "Unknown upstream error",
        },
        { status: upstreamRes.status }
      );
    }

    let savedFurniture:
      | {
          id: string;
          userSkuId: string;
          displayName: string | null;
          previewImageUrl: string | null;
          normalizedPreviewUrl: string | null;
          status: string;
        }
      | null = null;
    let preparedUserSku: ReturnType<typeof extractPreparedUserSkuCandidate> | null = null;

    if (accessToken) {
      const userSupabase = getUserSupabaseClient(accessToken);
      if (userSupabase && isRecord(parsed)) {
        const userSkuRaw = parsed.userSku;
        preparedUserSku = extractPreparedUserSkuCandidate(userSkuRaw);
        const userSkuStatus =
          preparedUserSku?.status?.trim().toLowerCase() ??
          safeString((isRecord(userSkuRaw) ? userSkuRaw.status : null))?.toLowerCase() ??
          null;
        if (preparedUserSku && userSkuStatus === "ready") {
          try {
            const { data: userData, error: userErr } = await userSupabase.auth.getUser();
            if (!userErr && userData?.user?.id) {
              const saved = await saveMyFurnitureFromPreparedUserSku({
                supabase: userSupabase,
                userId: userData.user.id,
                preparedUserSku,
                sourceType: resolveIngestSourceType(req, body),
                sourceLabel: resolveIngestSourceLabel(body),
              });
              savedFurniture = {
                id: saved.id,
                userSkuId: saved.user_sku_id,
                displayName: saved.display_name,
                previewImageUrl: saved.preview_image_url,
                normalizedPreviewUrl: saved.normalized_preview_url,
                status: saved.status,
              };
            }
          } catch (saveErr) {
            console.warn("[vibode/user-skus/ingest] my-furniture autosave skipped:", saveErr);
          }
        }
      }
    }

    if (savedFurniture && isRecord(parsed)) {
      return NextResponse.json({ ...parsed, savedFurniture });
    }

    return NextResponse.json(parsed ?? {});
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Failed to ingest user SKU.",
        detail: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
