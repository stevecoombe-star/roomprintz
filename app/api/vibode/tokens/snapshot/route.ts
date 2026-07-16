import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  getAuthenticatedTokenSnapshotWallet,
  toTokenSnapshotResponse,
} from "@/lib/vibodeTokenSnapshot";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getBearerSupabaseClient(req: NextRequest): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return null;

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return supabase;
}

async function getCookieSupabaseClient(): Promise<AnySupabaseClient | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op in this GET route; cookie writes are not required for token snapshot reads.
      },
    },
  });
}

export async function GET(req: NextRequest) {
  try {
    const cookieSupabase = await getCookieSupabaseClient();
    const bearerSupabase = getBearerSupabaseClient(req);
    const snapshot = await getAuthenticatedTokenSnapshotWallet({
      authClients: [cookieSupabase, bearerSupabase],
      getServiceRoleClient: getServiceRoleSupabaseClient,
    });
    if (!snapshot) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Deterministic first-touch initialization:
    // first authenticated snapshot call bootstraps a wallet through service role.
    return Response.json(toTokenSnapshotResponse(snapshot.wallet));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
