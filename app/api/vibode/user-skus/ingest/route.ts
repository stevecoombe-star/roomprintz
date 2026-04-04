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
const INGEST_ROUTE = "/api/vibode/user-skus/ingest";

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

function createRequestId(): string {
  try {
    return `vibode-ingest-${crypto.randomUUID()}`;
  } catch {
    return `vibode-ingest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function resolveMimeType(body: IngestBody): string | null {
  const imageBase64 = safeString(body.imageBase64);
  if (!imageBase64) return null;
  const dataUrlMatch = imageBase64.match(/^data:([^;,]+);base64,/i);
  return dataUrlMatch?.[1]?.toLowerCase() ?? null;
}

function resolveFilename(body: IngestBody): string | null {
  const imageUrl = safeString(body.imageUrl);
  if (!imageUrl) return null;
  try {
    const parsed = new URL(imageUrl);
    const basename = parsed.pathname.split("/").filter(Boolean).pop();
    return basename ? decodeURIComponent(basename) : null;
  } catch {
    return null;
  }
}

function logIngestEvent(
  level: "info" | "warn" | "error",
  event: string,
  requestId: string,
  fields: Record<string, unknown> = {}
): void {
  const payload: Record<string, unknown> = {
    event,
    request_id: requestId,
    route: INGEST_ROUTE,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  const message = `[vibode/user-skus/ingest] ${JSON.stringify(payload)}`;
  if (level === "warn") {
    console.warn(message);
    return;
  }
  if (level === "error") {
    console.error(message);
    return;
  }
  console.info(message);
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
  const requestId = createRequestId();
  const startedAtMs = Date.now();
  const accessToken = getBearerToken(req);
  logIngestEvent("info", "request_received", requestId, {
    user_id_present: Boolean(accessToken),
  });

  try {
    const body = (await req.json()) as IngestBody;
    const sourceKind = resolveIngestSourceType(req, body);
    const mimeType = resolveMimeType(body);
    const filename = resolveFilename(body);
    const label = safeString(body.label);
    const hasImageUrl = Boolean(safeString(body.imageUrl));
    const hasImageData = Boolean(safeString(body.imageBase64));

    logIngestEvent("info", "input_resolved", requestId, {
      user_id_present: Boolean(accessToken),
      source_kind: sourceKind,
      mime_type: mimeType,
      filename,
      label,
      has_image_url: hasImageUrl,
      has_image_data: hasImageData,
    });

    const compositorBase = (process.env.VIBODE_COMPOSITOR_URL ?? "http://localhost:8000").replace(
      /\/$/,
      ""
    );
    const upstream = `${compositorBase}/api/vibode/user-skus/ingest`;

    logIngestEvent("info", "forwarding_request_to_compositor", requestId, {
      source_kind: sourceKind,
      mime_type: mimeType,
      filename,
      label,
      has_image_url: hasImageUrl,
      has_image_data: hasImageData,
    });

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        imageUrl: body.imageUrl,
        imageBase64: body.imageBase64,
        label: body.label,
      }),
    });

    logIngestEvent("info", "compositor_response_received", requestId, {
      compositor_status: upstreamRes.status,
    });

    const raw = await upstreamRes.text();
    let parsed: any = null;

    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!upstreamRes.ok) {
      logIngestEvent("warn", "failed", requestId, {
        compositor_status: upstreamRes.status,
        duration_ms: Date.now() - startedAtMs,
        error: "upstream_non_ok",
      });
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
    let preparedUserSkuPresent = false;
    let eligibleSkuPresent = false;

    if (accessToken) {
      const userSupabase = getUserSupabaseClient(accessToken);
      if (userSupabase && isRecord(parsed)) {
        const userSkuRaw = parsed.userSku;
        preparedUserSku = extractPreparedUserSkuCandidate(userSkuRaw);
        preparedUserSkuPresent = Boolean(preparedUserSku);
        const userSkuStatus =
          preparedUserSku?.status?.trim().toLowerCase() ??
          safeString((isRecord(userSkuRaw) ? userSkuRaw.status : null))?.toLowerCase() ??
          null;
        eligibleSkuPresent = Boolean(preparedUserSku && userSkuStatus === "ready");
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
              logIngestEvent("info", "saved_to_my_furniture", requestId, {
                prepared_user_sku_present: preparedUserSkuPresent,
                eligible_sku_present: eligibleSkuPresent,
                saved_furniture_id: savedFurniture.id,
              });
            }
          } catch (saveErr) {
            logIngestEvent("warn", "my_furniture_save_failed", requestId, {
              prepared_user_sku_present: preparedUserSkuPresent,
              eligible_sku_present: eligibleSkuPresent,
              error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            });
          }
        }
      }
    }

    logIngestEvent("info", "completed", requestId, {
      compositor_status: upstreamRes.status,
      prepared_user_sku_present: preparedUserSkuPresent,
      eligible_sku_present: eligibleSkuPresent,
      saved_furniture_id: savedFurniture?.id,
      duration_ms: Date.now() - startedAtMs,
    });

    if (savedFurniture && isRecord(parsed)) {
      return NextResponse.json({ ...parsed, savedFurniture });
    }

    return NextResponse.json(parsed ?? {});
  } catch (err: any) {
    logIngestEvent("error", "failed", requestId, {
      duration_ms: Date.now() - startedAtMs,
      error: err?.message ?? "Unknown error",
    });
    return NextResponse.json(
      {
        error: "Failed to ingest user SKU.",
        detail: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
