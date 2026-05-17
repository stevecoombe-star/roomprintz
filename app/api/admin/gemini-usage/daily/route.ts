import { NextResponse } from "next/server";
import {
  GEMINI_USAGE_DAILY_TIME_ZONE,
  buildDailyBreakdown,
  fetchUsageRowsForRange,
  parseUsageStatusMode,
  withAdminUsageRequest,
} from "../_lib";

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const statusMode = parseUsageStatusMode(request);
    if (typeof statusMode !== "string") {
      return NextResponse.json({ error: statusMode.error }, { status: 400 });
    }

    const rows = await fetchUsageRowsForRange<{
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
      rows,
      fromIso: range.fromIso,
      toIso: range.toIso,
      statusMode,
    });

    return NextResponse.json({
      from: range.fromIso,
      to: range.toIso,
      statusMode: breakdown.statusMode,
      timeZone: GEMINI_USAGE_DAILY_TIME_ZONE,
      models: breakdown.models,
      dateBuckets: breakdown.dateBuckets,
      rows: breakdown.rows,
      summary: breakdown.summary,
    });
  });
}
