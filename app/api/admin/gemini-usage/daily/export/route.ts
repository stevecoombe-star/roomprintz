import {
  buildDailyBreakdown,
  fetchUsageRowsForRange,
  parseUsageStatusMode,
  withAdminUsageRequest,
} from "../../_lib";

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines: string[] = [headers.map((header) => csvCell(header)).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return lines.join("\n");
}

function csvSafeDateLabel(value: string): string {
  return value.slice(0, 10).replace(/[^0-9-]/g, "");
}

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const statusMode = parseUsageStatusMode(request);
    if (typeof statusMode !== "string") {
      return Response.json({ error: statusMode.error }, { status: 400 });
    }

    const usageRows = await fetchUsageRowsForRange<{
      created_at: string | null;
      model: string | null;
      status: "success" | "failure" | null;
    }>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select: "created_at,model,status",
    });

    const breakdown = buildDailyBreakdown({
      rows: usageRows,
      fromIso: range.fromIso,
      toIso: range.toIso,
      statusMode,
    });

    const headers = ["date", "status_mode", ...breakdown.models, "total"];
    const rows = breakdown.rows.map((row) => {
      const record: Record<string, unknown> = {
        date: row.date,
        status_mode: statusMode,
      };
      for (const model of breakdown.models) {
        record[model] = row.modelCounts[model] ?? 0;
      }
      record.total = row.total;
      return record;
    });

    const csv = toCsv(rows, headers);
    const filename = `vibode-gemini-usage-daily-${statusMode}-${csvSafeDateLabel(range.fromIso)}-to-${csvSafeDateLabel(range.toIso)}.csv`;
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
