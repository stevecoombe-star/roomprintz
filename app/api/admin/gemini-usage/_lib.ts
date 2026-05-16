import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type AnySupabaseClient = SupabaseClient;

type JsonRecord = Record<string, unknown>;

export type DateRange = {
  fromIso: string;
  toIso: string;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseDateRange(request: Request): DateRange | { error: string } {
  const url = new URL(request.url);
  const now = new Date();
  const defaultTo = now.toISOString();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fromRaw = safeStr(url.searchParams.get("from")) ?? defaultFrom;
  const toRaw = safeStr(url.searchParams.get("to")) ?? defaultTo;

  const fromMs = Date.parse(fromRaw);
  const toMs = Date.parse(toRaw);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { error: "Invalid from/to date range." };
  }
  if (fromMs >= toMs) {
    return { error: "Invalid from/to date range: from must be before to." };
  }
  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
  };
}

async function fetchUsageRowsPage(args: {
  supabase: AnySupabaseClient;
  fromIso: string;
  toIso: string;
  offset: number;
  limit: number;
  select: string;
}) {
  return args.supabase
    .from("vibode_gemini_usage_events")
    .select(args.select)
    .gte("created_at", args.fromIso)
    .lt("created_at", args.toIso)
    .order("created_at", { ascending: false })
    .range(args.offset, args.offset + args.limit - 1);
}

export async function fetchUsageRowsForRange<T extends JsonRecord>(args: {
  supabase: AnySupabaseClient;
  fromIso: string;
  toIso: string;
  select: string;
}): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = (await fetchUsageRowsPage({
      supabase: args.supabase,
      fromIso: args.fromIso,
      toIso: args.toIso,
      offset,
      limit: pageSize,
      select: args.select,
    })) as { data: T[] | null; error: { message: string } | null };
    if (error) {
      throw new Error(`Failed to read gemini usage rows: ${error.message}`);
    }
    const pageRows = ((data ?? []) as T[]).filter(
      (row) => row && typeof row === "object"
    );
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

export async function resolveUserEmailsById(
  supabaseAdmin: AnySupabaseClient,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const uniqueUserIds = Array.from(new Set(userIds.map((value) => safeStr(value)).filter(Boolean))) as string[];
  const out = new Map<string, string | null>();
  await Promise.all(
    uniqueUserIds.map(async (userId) => {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (error || !data?.user) {
          out.set(userId, null);
          return;
        }
        out.set(userId, safeStr(data.user.email));
      } catch {
        out.set(userId, null);
      }
    })
  );
  return out;
}

export async function withAdminUsageRequest(
  request: Request,
  handler: (args: { supabaseAdmin: AnySupabaseClient; range: DateRange }) => Promise<Response>
) {
  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) return json(403, { error: "Admin access required." });

  const supabaseAdmin = getServiceRoleSupabaseClient();
  if (!supabaseAdmin) {
    return json(500, { error: "Server configuration missing for admin controls." });
  }

  const range = parseDateRange(request);
  if ("error" in range) {
    return json(400, { error: range.error });
  }

  try {
    return await handler({ supabaseAdmin, range });
  } catch (err: unknown) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
