import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;
type UnknownRecord = Record<string, unknown>;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return { supabase: null, token: null };

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseIsoDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

type PartnerAggregate = {
  partnerId: string | null;
  partnerName: string;
  skuEngagements: number;
  addedCount: number;
  swappedCount: number;
  outboundClicks: number;
  exclusiveDiscountClicks: number;
  estimatedBillableAmount: number;
  topItems: Map<string, number>;
};

export async function GET(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json(
        {
          error:
            "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
        },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const partnerIdFilter = asOptionalString(req.nextUrl.searchParams.get("partnerId"));
    const start = parseIsoDate(asOptionalString(req.nextUrl.searchParams.get("start")));
    const end = parseIsoDate(asOptionalString(req.nextUrl.searchParams.get("end")));

    let query = supabase
      .from("vibode_furniture_events")
      .select(
        "partner_id,event_type,commercial_type,billable_event_type,billable_units,billable_amount,user_furniture_id,created_at,discount_applied"
      )
      .eq("user_id", userData.user.id);

    if (partnerIdFilter) query = query.eq("partner_id", partnerIdFilter);
    if (start) query = query.gte("created_at", start);
    if (end) query = query.lte("created_at", end);

    const { data: eventRows, error: eventsErr } = await query.order("created_at", { ascending: false });
    if (eventsErr) {
      return Response.json({ error: `Failed loading partner report events: ${eventsErr.message}` }, { status: 500 });
    }

    const partnerIds = [
      ...new Set(
        (Array.isArray(eventRows) ? eventRows : [])
          .map((row) => asOptionalString((row as UnknownRecord).partner_id))
          .filter((value): value is string => Boolean(value))
      ),
    ];
    const partnerNameById = new Map<string, string>();
    if (partnerIds.length > 0) {
      const { data: partnerRows } = await supabase
        .from("vibode_partners")
        .select("id,name")
        .in("id", partnerIds);
      if (Array.isArray(partnerRows)) {
        for (const row of partnerRows) {
          const record = row as UnknownRecord;
          const id = asOptionalString(record.id);
          const name = asOptionalString(record.name);
          if (id && name) partnerNameById.set(id, name);
        }
      }
    }

    const aggregates = new Map<string, PartnerAggregate>();
    const getAggregate = (partnerId: string | null): PartnerAggregate => {
      const key = partnerId ?? "__unassigned__";
      const existing = aggregates.get(key);
      if (existing) return existing;
      const next: PartnerAggregate = {
        partnerId,
        partnerName: partnerId ? partnerNameById.get(partnerId) ?? "Unknown Partner" : "Unassigned",
        skuEngagements: 0,
        addedCount: 0,
        swappedCount: 0,
        outboundClicks: 0,
        exclusiveDiscountClicks: 0,
        estimatedBillableAmount: 0,
        topItems: new Map<string, number>(),
      };
      aggregates.set(key, next);
      return next;
    };

    for (const rawRow of Array.isArray(eventRows) ? eventRows : []) {
      const row = rawRow as UnknownRecord;
      const partnerId = asOptionalString(row.partner_id);
      const eventType = asOptionalString(row.event_type);
      const commercialType = asOptionalString(row.commercial_type);
      const userFurnitureId = asOptionalString(row.user_furniture_id);
      const discountApplied = asBoolean(row.discount_applied);
      const billableAmount = asNumber(row.billable_amount);

      const aggregate = getAggregate(partnerId);
      if (commercialType === "sku_engagement") {
        aggregate.skuEngagements += 1;
        if (userFurnitureId) {
          aggregate.topItems.set(userFurnitureId, (aggregate.topItems.get(userFurnitureId) ?? 0) + 1);
        }
      }
      if (eventType === "added") aggregate.addedCount += 1;
      if (eventType === "swapped") aggregate.swappedCount += 1;
      if (eventType === "outbound_clicked" || commercialType === "affiliate_click") {
        aggregate.outboundClicks += 1;
        if (discountApplied) aggregate.exclusiveDiscountClicks += 1;
      }
      aggregate.estimatedBillableAmount += billableAmount;
    }

    const partners = [...aggregates.values()]
      .map((aggregate) => ({
        partnerId: aggregate.partnerId,
        partnerName: aggregate.partnerName,
        skuEngagements: aggregate.skuEngagements,
        addedCount: aggregate.addedCount,
        swappedCount: aggregate.swappedCount,
        outboundClicks: aggregate.outboundClicks,
        exclusiveDiscountClicks: aggregate.exclusiveDiscountClicks,
        estimatedBillableAmount: Number(aggregate.estimatedBillableAmount.toFixed(2)),
        topItems: [...aggregate.topItems.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([userFurnitureId, engagements]) => ({ userFurnitureId, engagements })),
      }))
      .sort(
        (a, b) =>
          b.skuEngagements - a.skuEngagements ||
          b.outboundClicks - a.outboundClicks ||
          a.partnerName.localeCompare(b.partnerName)
      );

    const totals = partners.reduce(
      (acc, partner) => {
        acc.skuEngagements += partner.skuEngagements;
        acc.addedCount += partner.addedCount;
        acc.swappedCount += partner.swappedCount;
        acc.outboundClicks += partner.outboundClicks;
        acc.exclusiveDiscountClicks += partner.exclusiveDiscountClicks;
        acc.estimatedBillableAmount += partner.estimatedBillableAmount;
        return acc;
      },
      {
        skuEngagements: 0,
        addedCount: 0,
        swappedCount: 0,
        outboundClicks: 0,
        exclusiveDiscountClicks: 0,
        estimatedBillableAmount: 0,
      }
    );

    return Response.json({
      range: { start, end },
      filters: { partnerId: partnerIdFilter },
      totals: {
        ...totals,
        estimatedBillableAmount: Number(totals.estimatedBillableAmount.toFixed(2)),
      },
      partners,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
