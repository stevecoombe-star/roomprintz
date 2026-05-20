import { NextResponse } from "next/server";
import { fetchUsageRowsForRange, withAdminUsageRequest } from "../_lib";

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const rows = await fetchUsageRowsForRange<{ status: "success" | "failure" | null }>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select: "status",
    });
    const successCount = rows.filter((row) => row.status === "success").length;
    const failureCount = rows.filter((row) => row.status === "failure").length;
    return NextResponse.json({
      summary: {
        from: range.fromIso,
        to: range.toIso,
        totalCalls: rows.length,
        successCount,
        failureCount,
      },
    });
  });
}
