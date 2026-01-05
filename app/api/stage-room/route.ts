// app/api/stage-room/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callCompositorEngine } from "@/lib/callCompositorEngine";

// Ensure we run on the Node.js runtime (needed for Buffer, larger payloads, etc.)
export const runtime = "nodejs";

type ModelVersion = "gemini-3" | "gemini-2.5";
type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";

type SpendRow = {
  success: boolean;
  balance: number | null;
};

type TokenLedgerInsert = {
  user_id: string;
  delta: number;
  kind: string;
  external_id: string;
  reason: string;
  job_id: string;
};

/**
 * Minimal Supabase Database type for this route.
 * This avoids "never" typing for rpc()/insert() without using `any`.
 */
type Database = {
  public: {
    Tables: {
      token_ledger: {
        Row: Record<string, unknown>;
        Insert: TokenLedgerInsert;
        Update: Record<string, unknown>;
        Relationships: never[];
      };
    };
    Views: Record<string, never>;
    Functions: {
      try_spend_tokens: {
        Args: { p_cost: number; p_external_id: string; p_reason: string };
        Returns: SpendRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

const ALLOWED_ASPECT_RATIOS: Set<string> = new Set([
  "auto",
  "4:3",
  "3:2",
  "16:9",
  "1:1",
]);

function mustEnv(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var (tried: ${names.join(", ")})`);
}

const SUPABASE_URL = mustEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = mustEnv(
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
);

/**
 * Creates a user-scoped Supabase client using the Authorization Bearer token.
 * This is required so RPCs run as the actual user (auth.uid()).
 */
function getUserSupabaseClient(
  req: NextRequest
): { supabase: ReturnType<typeof createClient<Database>> | null; token: string | null } {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  if (!token) return { supabase: null, token: null };

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return { supabase, token };
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);

    if (!token || !supabase) {
      return json(401, {
        error:
          "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
      });
    }

    // Verify user
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }
    const user = userData.user;

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return json(400, {
        error: "Missing or invalid file in form-data (expected 'file').",
      });
    }

    // ✅ REQUIRED for idempotent token spend
    const jobIdRaw = formData.get("jobId");
    const jobId =
      typeof jobIdRaw === "string" && jobIdRaw.trim().length > 0
        ? jobIdRaw.trim()
        : null;

    if (!jobId) {
      return json(400, {
        error: "Missing jobId in form-data (required for token spend idempotency).",
      });
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
    const emptyRoom = (formData.get("emptyRoom") as string | null) === "true";
    const renovateRoom =
      (formData.get("renovateRoom") as string | null) === "true";
    const repaintWalls =
      (formData.get("repaintWalls") as string | null) === "true";

    const flooringPresetRaw =
      ((formData.get("flooringPreset") as string | null) || "").trim();
    const flooringPreset =
      flooringPresetRaw === "" || flooringPresetRaw === "none"
        ? null
        : flooringPresetRaw;

    const roomTypeRaw = formData.get("roomType");
    const roomType =
      typeof roomTypeRaw === "string" && roomTypeRaw.trim().length > 0
        ? roomTypeRaw.trim()
        : null;

    const modelVersionRaw = formData.get("modelVersion");
    const normalizedModelVersion: ModelVersion =
      typeof modelVersionRaw === "string" &&
      (modelVersionRaw === "gemini-3" || modelVersionRaw === "gemini-2.5")
        ? (modelVersionRaw as ModelVersion)
        : "gemini-3";

    const aspectRatioRaw = formData.get("aspectRatio");
    const parsedAspectRatio =
      typeof aspectRatioRaw === "string" ? aspectRatioRaw.trim() : "";

    let normalizedAspectRatio: AspectRatio = "auto";
    if (parsedAspectRatio && ALLOWED_ASPECT_RATIOS.has(parsedAspectRatio)) {
      normalizedAspectRatio = parsedAspectRatio as AspectRatio;
    }

    const isContinuationRaw = formData.get("isContinuation");
    const isContinuation =
      typeof isContinuationRaw === "string" && isContinuationRaw === "true";

    // legacy: intentionally ignored
    const sameInputSessionRaw = formData.get("sameInputSession");
    const _sameInputSession =
      typeof sameInputSessionRaw === "string" && sameInputSessionRaw === "true";
    void _sameInputSession;

    const propertyIdRaw = formData.get("propertyId");
    const propertyId =
      typeof propertyIdRaw === "string" && propertyIdRaw.trim().length > 0
        ? propertyIdRaw.trim()
        : null;

    if (!propertyId) {
      return json(400, {
        error: "Missing propertyId in form-data (required for room assignment).",
      });
    }

    const roomNameRaw = formData.get("roomName");
    const roomName =
      typeof roomNameRaw === "string" && roomNameRaw.trim().length > 0
        ? roomNameRaw.trim()
        : "Untitled room";

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
      return json(400, {
        error:
          "No styleId and no photo tools selected. Nothing to do for stage-room.",
      });
    }

    /**
     * ✅ Room = storage folder
     * We DO NOT block when a room name already exists.
     * Fresh uploads and continuations are both allowed to target any existing room label.
     */

    const tokenCost = normalizedModelVersion === "gemini-3" ? 2 : 1;

    const { data: spendData, error: spendErr } = await supabase.rpc(
      "try_spend_tokens",
      {
        p_cost: tokenCost,
        p_external_id: jobId,
        p_reason: `room_generation:${normalizedModelVersion}`,
      }
    );

    if (spendErr) {
      console.error("[stage-room] try_spend_tokens error:", spendErr);
      return json(500, { error: "Token spend failed" });
    }

    const spendRow = Array.isArray(spendData) ? spendData[0] : null;
    const spentOk = Boolean(spendRow?.success);
    const balanceAfterSpend =
      typeof spendRow?.balance === "number" ? spendRow.balance : null;

    if (!spentOk) {
      return json(402, {
        error: "Insufficient tokens",
        required: tokenCost,
        tokenBalance: balanceAfterSpend ?? 0,
      });
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
      roomType,
      modelVersion: normalizedModelVersion,
      aspectRatio: normalizedAspectRatio,
      isContinuation,
    });

    const imageUrl = result?.imageUrl ?? null;
    const originalImageUrl = result?.originalImageUrl ?? null;

    if (!imageUrl) {
      const { error: refundErr } = await supabase.from("token_ledger").insert({
        user_id: user.id,
        delta: tokenCost,
        kind: "refund",
        external_id: jobId,
        reason: "generation_failed_refund",
        job_id: jobId,
      });

      if (refundErr) {
        console.error("[stage-room] refund insert error:", refundErr);
      }

      return json(500, { error: "Compositor did not return an imageUrl." });
    }

    return json(200, {
      imageUrl,
      originalImageUrl,
      tokenCost,
      tokenBalance: balanceAfterSpend,
      propertyId,
      roomName,
    });
  } catch (err: unknown) {
    console.error("[stage-room] unexpected error:", err);
    const message =
      err instanceof Error ? err.message : "Unexpected error in /api/stage-room";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
