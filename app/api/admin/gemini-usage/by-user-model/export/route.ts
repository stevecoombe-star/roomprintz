import {
  buildUserModelBreakdown,
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
      user_id: string | null;
      model: string | null;
      status: "success" | "failure" | null;
      metadata: unknown;
    }>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select: "user_id,model,status,metadata",
    });

    const breakdown = await buildUserModelBreakdown({
      supabaseAdmin,
      rows: usageRows,
      statusMode,
    });

    const headers = ["user_email", "user_id", ...breakdown.models, "total"];
    const rows = breakdown.rows.map((row) => {
      const record: Record<string, unknown> = {
        user_email: row.userEmail ?? "",
        user_id: row.userId ?? "",
      };
      for (const model of breakdown.models) {
        record[model] = row.modelCounts[model] ?? 0;
      }
      record.total = row.total;
      return record;
    });

    const csv = toCsv(rows, headers);
    const filename = `vibode-gemini-usage-by-user-model-${statusMode}-${csvSafeDateLabel(range.fromIso)}-to-${csvSafeDateLabel(range.toIso)}.csv`;
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
