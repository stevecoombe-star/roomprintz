import { NextResponse } from "next/server";
import { fetchUsageRowsForRange, withAdminUsageRequest } from "../_lib";

type AggregateRow = {
  workflowType: string;
  actionType: string;
  calls: number;
  successCount: number;
  failureCount: number;
};

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const rows = await fetchUsageRowsForRange<{
      workflow_type: string | null;
      action_type: string | null;
      status: "success" | "failure" | null;
    }>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select: "workflow_type,action_type,status",
    });
    const byWorkflow = new Map<string, AggregateRow>();
    for (const row of rows) {
      const workflowType = row.workflow_type?.trim() || "unknown";
      const actionType = row.action_type?.trim() || "unknown";
      const key = `${workflowType}:${actionType}`;
      const current = byWorkflow.get(key) ?? {
        workflowType,
        actionType,
        calls: 0,
        successCount: 0,
        failureCount: 0,
      };
      current.calls += 1;
      if (row.status === "success") current.successCount += 1;
      if (row.status === "failure") current.failureCount += 1;
      byWorkflow.set(key, current);
    }

    const items = Array.from(byWorkflow.values()).sort((a, b) => b.calls - a.calls);
    return NextResponse.json({
      items,
      from: range.fromIso,
      to: range.toIso,
    });
  });
}
