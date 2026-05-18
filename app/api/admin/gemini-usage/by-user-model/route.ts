import { NextResponse } from "next/server";
import {
  buildUserModelBreakdown,
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
      rows,
      statusMode,
    });

    return NextResponse.json({
      from: range.fromIso,
      to: range.toIso,
      statusMode: breakdown.statusMode,
      models: breakdown.models,
      rows: breakdown.rows,
      summary: breakdown.summary,
    });
  });
}
