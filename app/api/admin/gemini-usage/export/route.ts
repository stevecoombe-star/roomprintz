import { fetchUsageRowsForRange, resolveUserEmailsById, withAdminUsageRequest } from "../_lib";

type UsageExportRow = {
  created_at: string | null;
  user_id: string | null;
  model: string | null;
  workflow_type: string | null;
  action_type: string | null;
  source_trigger: string | null;
  status: "success" | "failure" | null;
  latency_ms: number | null;
  route: string | null;
  service: string | null;
  room_id: string | null;
  version_id: string | null;
  asset_id: string | null;
  request_id: string | null;
  attempt_id: string | null;
};

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  const escaped = raw.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines: string[] = [];
  lines.push(headers.map((header) => csvCell(header)).join(","));
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return lines.join("\n");
}

function resolveFileLabel(windowKey: string): string {
  if (windowKey === "this-month") return "this-month";
  if (windowKey === "last-month") return "last-month";
  if (windowKey === "all-time") return "all-time";
  if (windowKey === "custom-range") return "custom-range";
  return "filtered";
}

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const url = new URL(request.url);
    const windowKey = resolveFileLabel(safeString(url.searchParams.get("window")));
    const rows = await fetchUsageRowsForRange<UsageExportRow>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select:
        "created_at,user_id,model,workflow_type,action_type,source_trigger,status,latency_ms,route,service,room_id,version_id,asset_id,request_id,attempt_id",
    });

    const userIds = rows
      .map((row) => (typeof row.user_id === "string" ? row.user_id.trim() : ""))
      .filter((value) => value.length > 0);
    const userEmailById = await resolveUserEmailsById(supabaseAdmin, userIds);

    const csvRows = rows.map((row) => ({
      created_at: row.created_at ?? "",
      user_id: row.user_id ?? "",
      user_email: row.user_id ? userEmailById.get(row.user_id) ?? "" : "",
      model: row.model ?? "",
      workflow_type: row.workflow_type ?? "",
      action_type: row.action_type ?? "",
      source_trigger: row.source_trigger ?? "",
      status: row.status ?? "",
      latency_ms: row.latency_ms ?? "",
      route: row.route ?? "",
      service: row.service ?? "",
      room_id: row.room_id ?? "",
      version_id: row.version_id ?? "",
      asset_id: row.asset_id ?? "",
      request_id: row.request_id ?? "",
      attempt_id: row.attempt_id ?? "",
    }));

    const headers = [
      "created_at",
      "user_id",
      "user_email",
      "model",
      "workflow_type",
      "action_type",
      "source_trigger",
      "status",
      "latency_ms",
      "route",
      "service",
      "room_id",
      "version_id",
      "asset_id",
      "request_id",
      "attempt_id",
    ];

    const csv = toCsv(csvRows, headers);
    const filename = `vibode-gemini-usage-${windowKey}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
