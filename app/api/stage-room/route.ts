// app/api/stage-room/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callCompositorEngine } from "@/lib/callCompositorEngine";

// Ensure we run on the Node.js runtime (needed for Buffer, larger payloads, etc.)
export const runtime = "nodejs";

type ModelVersion = "gemini-3" | "gemini-2.5";
type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";

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
function getUserSupabaseClient(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  if (!token) return { supabase: null as any, token: null as string | null };

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

// ---------- Room lineage guard helpers ----------
const norm = (s: string) => (s || "").trim().toLowerCase();

function suggestUniqueRoomName(desired: string, existing: Set<string>) {
  const base = desired.trim() || "Untitled room";
  if (!existing.has(norm(base))) return base;

  let n = 2;
  while (existing.has(norm(`${base} (${n})`))) n += 1;
  return `${base} (${n})`;
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);

    if (!token) {
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

    // roomType
    const roomTypeRaw = formData.get("roomType");
    const roomType =
      typeof roomTypeRaw === "string" && roomTypeRaw.trim().length > 0
        ? roomTypeRaw.trim()
        : null;

    // modelVersion ("gemini-3" | "gemini-2.5"), default to gemini-3
    const modelVersionRaw = formData.get("modelVersion");
    const normalizedModelVersion: ModelVersion =
      typeof modelVersionRaw === "string" &&
      (modelVersionRaw === "gemini-3" || modelVersionRaw === "gemini-2.5")
        ? (modelVersionRaw as ModelVersion)
        : "gemini-3";

    // aspectRatio ("auto" | "4:3" | "3:2" | "16:9" | "1:1"), default to auto
    const aspectRatioRaw = formData.get("aspectRatio");
    const parsedAspectRatio =
      typeof aspectRatioRaw === "string" ? aspectRatioRaw.trim() : "";

    let normalizedAspectRatio: AspectRatio = "auto";
    if (parsedAspectRatio && ALLOWED_ASPECT_RATIOS.has(parsedAspectRatio)) {
      normalizedAspectRatio = parsedAspectRatio as AspectRatio;
    }

    // isContinuation (one-shot)
    const isContinuationRaw = formData.get("isContinuation");
    const isContinuation =
      typeof isContinuationRaw === "string" && isContinuationRaw === "true";

    // ✅ NEW: Property + room context (required for lineage protection)
    const propertyIdRaw = formData.get("propertyId");
    const propertyId =
      typeof propertyIdRaw === "string" && propertyIdRaw.trim().length > 0
        ? propertyIdRaw.trim()
        : null;

    if (!propertyId) {
      return json(400, {
        error:
          "Missing propertyId in form-data (required for room lineage protection).",
      });
    }

    const roomNameRaw = formData.get("roomName");
    const roomName =
      typeof roomNameRaw === "string" && roomNameRaw.trim().length > 0
        ? roomNameRaw.trim()
        : "Untitled room";

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
      return json(400, {
        error:
          "No styleId and no photo tools selected. Nothing to do for stage-room.",
      });
    }

    // ✅ NEW: 409 guard (server-side) — fresh uploads cannot target an existing room label
    // Continuations are allowed to reuse an existing room name (same lineage).
    if (!isContinuation) {
      const { data: rows, error: roomsErr } = await supabase
        .from("jobs")
        .select("room_name")
        .eq("user_id", user.id)
        .eq("property_id", propertyId);

      if (roomsErr) {
        console.error("[stage-room] room lineage guard query error:", roomsErr);
        // Fail open (do not block spend/generation) if guard query fails.
        // Frontend guard should catch most cases; this is a safety net.
      } else {
        const existing = new Set<string>();
        for (const r of rows ?? []) {
          const label = (r as any)?.room_name?.trim() || "Unlabeled room";
          existing.add(norm(label));
        }

        if (existing.has(norm(roomName))) {
          const suggestedRoomName = suggestUniqueRoomName(roomName, existing);

          return json(409, {
            error: "room_name_conflict",
            message:
              "Room name already exists. Fresh uploads cannot target an existing room (lineage protection).",
            suggestedRoomName,
          });
        }
      }
    }

    /**
     * ✅ TOKEN COST RULE (start simple)
     * You can tune this anytime:
     * - gemini-3 (higher cost) = 2 tokens
     * - gemini-2.5 (cheaper)   = 1 token
     */
    const tokenCost = normalizedModelVersion === "gemini-3" ? 2 : 1;

    // ✅ Spend tokens BEFORE generation (atomic + idempotent via external_id=jobId)
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

    const spendRow = Array.isArray(spendData) ? spendData[0] : spendData;
    const spentOk = !!spendRow?.success;
    const balanceAfterSpend =
      typeof spendRow?.balance === "number" ? spendRow.balance : null;

    if (!spentOk) {
      return json(402, {
        error: "Insufficient tokens",
        required: tokenCost,
        tokenBalance: balanceAfterSpend ?? 0,
      });
    }

    // ✅ Call compositor
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
      // ✅ Refund on compositor failure (best UX)
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
      tokenBalance: balanceAfterSpend, // after spend (may be same as before if already spent due to retry)
    });
  } catch (err: any) {
    console.error("[stage-room] unexpected error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error in /api/stage-room" },
      { status: 500 }
    );
  }
}
