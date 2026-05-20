import { NextResponse } from "next/server";
import { fetchGeminiLedgerPage, parseGeminiLedgerQuery } from "../_ledger";
import { withAdminUsageRequest } from "../_lib";

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin }) => {
    const query = parseGeminiLedgerQuery(request);
    if ("error" in query) {
      return NextResponse.json({ error: query.error }, { status: 400 });
    }

    const { rows, totalCount } = await fetchGeminiLedgerPage({
      supabaseAdmin,
      query,
    });

    const hasNext = query.offset + rows.length < totalCount;
    const hasPrevious = query.offset > 0;

    return NextResponse.json({
      rows,
      totalCount,
      limit: query.limit,
      offset: query.offset,
      hasNext,
      hasPrevious,
      from: query.fromIso,
      to: query.toIso,
      search: query.search,
    });
  });
}
