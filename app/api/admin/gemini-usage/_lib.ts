import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";

type AnySupabaseClient = SupabaseClient;

type JsonRecord = Record<string, unknown>;

export type DateRange = {
  fromIso: string;
  toIso: string;
};

export type UsageStatusMode = "success" | "failure";
export const GEMINI_USAGE_DAILY_TIME_ZONE = "America/Vancouver";
export const GEMINI_USAGE_MODEL_PRIORITY = [
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-3-flash-preview",
] as const;

type UsageEventRow = {
  created_at: string | null;
  model: string | null;
  status: "success" | "failure" | null;
};

type DailyBreakdownRow = {
  date: string;
  modelCounts: Record<string, number>;
  total: number;
};

type DailyBreakdownSummary = {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  selectedStatusCount: number;
  topModel: {
    model: string;
    calls: number;
  } | null;
};

export type DailyBreakdownResult = {
  statusMode: UsageStatusMode;
  models: string[];
  dateBuckets: string[];
  rows: DailyBreakdownRow[];
  summary: DailyBreakdownSummary;
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

function normalizeModel(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

export function sortGeminiUsageModels(models: string[]): string[] {
  const priorityByModel = new Map<string, number>(
    GEMINI_USAGE_MODEL_PRIORITY.map((model, index) => [model, index])
  );
  const uniqueModels = Array.from(
    new Set(models.map((model) => normalizeModel(model)))
  );

  return uniqueModels.sort((a, b) => {
    const aPriority = priorityByModel.get(a);
    const bPriority = priorityByModel.get(b);
    const aIsKnown = typeof aPriority === "number";
    const bIsKnown = typeof bPriority === "number";

    if (aIsKnown && bIsKnown) return (aPriority ?? 0) - (bPriority ?? 0);
    if (aIsKnown) return -1;
    if (bIsKnown) return 1;
    return a.localeCompare(b);
  });
}

const pacificDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: GEMINI_USAGE_DAILY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatPacificDateKey(date: Date): string {
  const parts = pacificDateFormatter.formatToParts(date);
  let year = "";
  let month = "";
  let day = "";
  for (const part of parts) {
    if (part.type === "year") year = part.value;
    if (part.type === "month") month = part.value;
    if (part.type === "day") day = part.value;
  }
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function toPacificDateBucket(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const bucket = formatPacificDateKey(new Date(timestamp));
  return bucket || null;
}

function parseDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function incrementDateKey(value: string): string | null {
  const parsed = parseDateKey(value);
  if (!parsed) return null;
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0));
  next.setUTCDate(next.getUTCDate() + 1);
  const year = String(next.getUTCFullYear()).padStart(4, "0");
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildPacificDateBuckets(fromIso: string, toIso: string): string[] {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return [];

  const startKey = formatPacificDateKey(new Date(fromMs));
  const endKey = formatPacificDateKey(new Date(toMs - 1));
  if (!startKey || !endKey) return [];
  if (startKey > endKey) return [];

  const out: string[] = [];
  let cursor = startKey;
  let guard = 0;
  while (cursor <= endKey && guard < 5000) {
    out.push(cursor);
    const next = incrementDateKey(cursor);
    if (!next) break;
    cursor = next;
    guard += 1;
  }
  return out;
}

export function parseUsageStatusMode(request: Request): UsageStatusMode | { error: string } {
  const url = new URL(request.url);
  const raw = safeStr(url.searchParams.get("status"));
  if (!raw || raw === "success") return "success";
  if (raw === "failure") return "failure";
  return { error: 'Invalid status. Expected "success" or "failure".' };
}

export function buildDailyBreakdown(args: {
  rows: UsageEventRow[];
  fromIso: string;
  toIso: string;
  statusMode: UsageStatusMode;
}): DailyBreakdownResult {
  const byDateModel = new Map<string, Map<string, number>>();
  const selectedModelTotals = new Map<string, number>();
  const allModelTotals = new Map<string, number>();

  let totalCalls = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const row of args.rows) {
    const model = normalizeModel(row.model);
    const dateBucket = toPacificDateBucket(row.created_at);
    const status = row.status;

    totalCalls += 1;
    allModelTotals.set(model, (allModelTotals.get(model) ?? 0) + 1);

    if (status === "success") successCount += 1;
    if (status === "failure") failureCount += 1;

    if (status !== args.statusMode || !dateBucket) continue;

    selectedModelTotals.set(model, (selectedModelTotals.get(model) ?? 0) + 1);
    const dateMap = byDateModel.get(dateBucket) ?? new Map<string, number>();
    dateMap.set(model, (dateMap.get(model) ?? 0) + 1);
    byDateModel.set(dateBucket, dateMap);
  }

  const models = sortGeminiUsageModels(Array.from(selectedModelTotals.keys()));

  const dateBuckets = buildPacificDateBuckets(args.fromIso, args.toIso);
  const rows: DailyBreakdownRow[] = dateBuckets.map((date) => {
    const dateMap = byDateModel.get(date);
    const modelCounts: Record<string, number> = {};
    let total = 0;
    for (const model of models) {
      const count = dateMap?.get(model) ?? 0;
      modelCounts[model] = count;
      total += count;
    }
    return { date, modelCounts, total };
  });

  let topModel: DailyBreakdownSummary["topModel"] = null;
  for (const [model, calls] of allModelTotals.entries()) {
    if (!topModel || calls > topModel.calls) {
      topModel = { model, calls };
    }
  }

  const selectedStatusCountFromRows = rows.reduce((total, row) => total + row.total, 0);

  return {
    statusMode: args.statusMode,
    models,
    dateBuckets,
    rows,
    summary: {
      totalCalls,
      successCount,
      failureCount,
      selectedStatusCount: selectedStatusCountFromRows,
      topModel,
    },
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
