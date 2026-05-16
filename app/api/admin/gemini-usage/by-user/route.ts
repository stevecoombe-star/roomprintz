import { NextResponse } from "next/server";
import { fetchUsageRowsForRange, resolveUserEmailsById, withAdminUsageRequest } from "../_lib";

type AggregateRow = {
  userId: string;
  userEmail: string | null;
  calls: number;
  successCount: number;
  failureCount: number;
};

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const rows = await fetchUsageRowsForRange<{
      user_id: string | null;
      status: "success" | "failure" | null;
    }>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select: "user_id,status",
    });
    const userIds = rows
      .map((row) => (typeof row.user_id === "string" ? row.user_id.trim() : ""))
      .filter((value) => value.length > 0);
    const userEmailById = await resolveUserEmailsById(supabaseAdmin, userIds);
    const byUser = new Map<string, AggregateRow>();
    for (const row of rows) {
      const userId = row.user_id?.trim() || "anonymous";
      const current = byUser.get(userId) ?? {
        userId,
        userEmail: userEmailById.get(userId) ?? null,
        calls: 0,
        successCount: 0,
        failureCount: 0,
      };
      current.calls += 1;
      if (row.status === "success") current.successCount += 1;
      if (row.status === "failure") current.failureCount += 1;
      byUser.set(userId, current);
    }

    const items = Array.from(byUser.values()).sort((a, b) => b.calls - a.calls);
    return NextResponse.json({
      items,
      from: range.fromIso,
      to: range.toIso,
    });
  });
}
