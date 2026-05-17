import { NextResponse } from "next/server";
import {
  fetchUsageRowsForRange,
  sortGeminiUsageModels,
  withAdminUsageRequest,
} from "../_lib";

type AggregateRow = {
  model: string;
  calls: number;
  successCount: number;
  failureCount: number;
};

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin, range }) => {
    const rows = await fetchUsageRowsForRange<{
      model: string | null;
      status: "success" | "failure" | null;
    }>({
      supabase: supabaseAdmin,
      fromIso: range.fromIso,
      toIso: range.toIso,
      select: "model,status",
    });
    const byModel = new Map<string, AggregateRow>();
    for (const row of rows) {
      const model = row.model?.trim() || "unknown";
      const current = byModel.get(model) ?? {
        model,
        calls: 0,
        successCount: 0,
        failureCount: 0,
      };
      current.calls += 1;
      if (row.status === "success") current.successCount += 1;
      if (row.status === "failure") current.failureCount += 1;
      byModel.set(model, current);
    }

    const orderedModels = sortGeminiUsageModels(Array.from(byModel.keys()));
    const items = orderedModels
      .map((model) => byModel.get(model))
      .filter((value): value is AggregateRow => Boolean(value));
    return NextResponse.json({
      items,
      from: range.fromIso,
      to: range.toIso,
    });
  });
}
