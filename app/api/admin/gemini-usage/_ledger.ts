import type { SupabaseClient } from "@supabase/supabase-js";
import { extractMetadataUserEmail, resolveUserEmailsById, safeStr } from "./_lib";

type AnySupabaseClient = SupabaseClient;

export const GEMINI_LEDGER_TIME_ZONE = "America/Vancouver";
export const GEMINI_LEDGER_PAGE_SIZES = [25, 50, 100] as const;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export type GeminiLedgerEventRow = {
  created_at: string | null;
  user_email: string | null;
  model: string | null;
  workflow_type: string | null;
  action_type: string | null;
  source_trigger: string | null;
  status: "success" | "failure" | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  route: string | null;
  service: string | null;
  user_id: string | null;
  room_id: string | null;
  version_id: string | null;
  asset_id: string | null;
  request_id: string | null;
  attempt_id: string | null;
};

type RawLedgerEventRow = Omit<GeminiLedgerEventRow, "user_email"> & {
  metadata: unknown;
};

export type GeminiLedgerQuery = {
  fromIso: string;
  toIso: string;
  search: string;
  limit: number;
  offset: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

function parseIntegerParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSearchTerm(value: string | null): string {
  const parsed = safeStr(value) ?? "";
  return parsed.replace(/[(),]/g, " ").trim();
}

export function parseGeminiLedgerQuery(request: Request): GeminiLedgerQuery | { error: string } {
  const url = new URL(request.url);
  const fromRaw = safeStr(url.searchParams.get("from")) ?? thirtyDaysAgoIso();
  const toRaw = safeStr(url.searchParams.get("to")) ?? nowIso();
  const fromMs = Date.parse(fromRaw);
  const toMs = Date.parse(toRaw);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { error: "Invalid from/to date range." };
  }
  if (fromMs >= toMs) {
    return { error: "Invalid from/to date range: from must be before to." };
  }

  const limit = parseIntegerParam(url.searchParams.get("limit"), DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `Invalid limit. Expected integer between 1 and ${MAX_LIMIT}.` };
  }

  const offset = parseIntegerParam(url.searchParams.get("offset"), 0);
  if (!Number.isFinite(offset) || offset < 0) {
    return { error: "Invalid offset. Expected integer >= 0." };
  }

  return {
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(toMs).toISOString(),
    search: normalizeSearchTerm(url.searchParams.get("search")),
    limit,
    offset,
  };
}

function buildLedgerBaseQuery(args: {
  supabase: AnySupabaseClient;
  fromIso: string;
  toIso: string;
}) {
  return args.supabase
    .from("vibode_gemini_usage_events")
    .select(
      "created_at,metadata,model,workflow_type,action_type,source_trigger,status,latency_ms,input_tokens,output_tokens,route,service,user_id,room_id,version_id,asset_id,request_id,attempt_id"
    )
    .gte("created_at", args.fromIso)
    .lte("created_at", args.toIso)
    .order("created_at", { ascending: false });
}

async function hydrateLedgerRows(
  supabaseAdmin: AnySupabaseClient,
  rows: RawLedgerEventRow[]
): Promise<GeminiLedgerEventRow[]> {
  const unresolvedUserIds = rows
    .filter((row) => !extractMetadataUserEmail(row.metadata))
    .map((row) => safeStr(row.user_id))
    .filter((value): value is string => Boolean(value));
  const userEmailById = await resolveUserEmailsById(supabaseAdmin, unresolvedUserIds);

  return rows.map((row) => {
    const metadataEmail = extractMetadataUserEmail(row.metadata);
    return {
      created_at: row.created_at,
      user_email: metadataEmail ?? (row.user_id ? userEmailById.get(row.user_id) ?? null : null),
      model: row.model,
      workflow_type: row.workflow_type,
      action_type: row.action_type,
      source_trigger: row.source_trigger,
      status: row.status,
      latency_ms: row.latency_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      route: row.route,
      service: row.service,
      user_id: row.user_id,
      room_id: row.room_id,
      version_id: row.version_id,
      asset_id: row.asset_id,
      request_id: row.request_id,
      attempt_id: row.attempt_id,
    };
  });
}

function normalizeSearchValue(value: string | null): string {
  return (safeStr(value) ?? "").toLowerCase();
}

function rowMatchesSearch(row: GeminiLedgerEventRow, normalizedSearch: string): boolean {
  if (!normalizedSearch) return true;

  const searchableValues = [
    row.user_email,
    row.user_id,
    row.model,
    row.workflow_type,
    row.action_type,
    row.source_trigger,
    row.status,
    row.route,
    row.service,
    row.room_id,
    row.version_id,
    row.asset_id,
    row.request_id,
    row.attempt_id,
  ];
  return searchableValues.some((value) => normalizeSearchValue(value).includes(normalizedSearch));
}

function filterLedgerRowsBySearch(rows: GeminiLedgerEventRow[], search: string): GeminiLedgerEventRow[] {
  const normalizedSearch = normalizeSearchValue(search);
  if (!normalizedSearch) return rows;
  return rows.filter((row) => rowMatchesSearch(row, normalizedSearch));
}

async function fetchAllRawLedgerRowsForRange(args: {
  supabaseAdmin: AnySupabaseClient;
  fromIso: string;
  toIso: string;
}): Promise<RawLedgerEventRow[]> {
  const pageSize = 1000;
  const rows: RawLedgerEventRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = (await buildLedgerBaseQuery({
      supabase: args.supabaseAdmin,
      fromIso: args.fromIso,
      toIso: args.toIso,
    }).range(offset, offset + pageSize - 1)) as {
      data: RawLedgerEventRow[] | null;
      error: { message: string } | null;
    };

    if (error) {
      throw new Error(`Failed to load Gemini usage ledger rows: ${error.message}`);
    }

    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

export async function fetchFilteredGeminiLedgerRows(args: {
  supabaseAdmin: AnySupabaseClient;
  query: Pick<GeminiLedgerQuery, "fromIso" | "toIso" | "search">;
}): Promise<GeminiLedgerEventRow[]> {
  const rawRows = await fetchAllRawLedgerRowsForRange({
    supabaseAdmin: args.supabaseAdmin,
    fromIso: args.query.fromIso,
    toIso: args.query.toIso,
  });
  const hydratedRows = await hydrateLedgerRows(args.supabaseAdmin, rawRows);
  return filterLedgerRowsBySearch(hydratedRows, args.query.search);
}

export async function fetchGeminiLedgerPage(args: {
  supabaseAdmin: AnySupabaseClient;
  query: GeminiLedgerQuery;
}): Promise<{ rows: GeminiLedgerEventRow[]; totalCount: number }> {
  const filteredRows = await fetchFilteredGeminiLedgerRows({
    supabaseAdmin: args.supabaseAdmin,
    query: {
      fromIso: args.query.fromIso,
      toIso: args.query.toIso,
      search: args.query.search,
    },
  });
  const pageRows = filteredRows.slice(args.query.offset, args.query.offset + args.query.limit);
  return {
    rows: pageRows,
    totalCount: filteredRows.length,
  };
}

export async function fetchAllGeminiLedgerRowsForExport(args: {
  supabaseAdmin: AnySupabaseClient;
  query: Pick<GeminiLedgerQuery, "fromIso" | "toIso" | "search">;
}): Promise<GeminiLedgerEventRow[]> {
  return fetchFilteredGeminiLedgerRows(args);
}

export function geminiLedgerCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

export function toGeminiLedgerCsv(rows: GeminiLedgerEventRow[]): string {
  const headers = [
    "created_at",
    "user_email",
    "model",
    "workflow_type",
    "action_type",
    "source_trigger",
    "status",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "route",
    "service",
    "user_id",
    "room_id",
    "version_id",
    "asset_id",
    "request_id",
    "attempt_id",
  ] as const;

  const lines: string[] = [];
  lines.push(headers.map((header) => geminiLedgerCsvCell(header)).join(","));
  for (const row of rows) {
    lines.push(headers.map((header) => geminiLedgerCsvCell(row[header])).join(","));
  }
  return lines.join("\n");
}
