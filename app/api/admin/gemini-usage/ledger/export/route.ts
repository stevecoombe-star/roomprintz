import { fetchAllGeminiLedgerRowsForExport, parseGeminiLedgerQuery, toGeminiLedgerCsv } from "../../_ledger";
import { withAdminUsageRequest } from "../../_lib";

export async function GET(request: Request) {
  return withAdminUsageRequest(request, async ({ supabaseAdmin }) => {
    const parsed = parseGeminiLedgerQuery(request);
    if ("error" in parsed) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const rows = await fetchAllGeminiLedgerRowsForExport({
      supabaseAdmin,
      query: {
        fromIso: parsed.fromIso,
        toIso: parsed.toIso,
        search: parsed.search,
      },
    });

    const csv = toGeminiLedgerCsv(rows);
    const filename = "vibode-gemini-usage-ledger.csv";
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
