// app/api/stripe/portal/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
type AnySupabaseClient = SupabaseClient<any, "public", any>;

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing env var: ${name}`);
  }
  return v;
}

// Derive the correct base URL (works on localhost + Vercel Preview + Prod)
function getOrigin(req: Request): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // ignore invalid referer
    }
  }

  return "http://localhost:3000";
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

type SubscriptionRow = {
  stripe_customer_id: string | null;
};

export async function POST(req: Request) {
  try {
    // ✅ Instantiate inside handler (build-safe)
    const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-12-15.clover",
    });

    const supabaseAdmin: AnySupabaseClient = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization bearer token" });
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    if (!accessToken) {
      return json(401, { error: "Missing access token" });
    }

    const supabaseUserClient: AnySupabaseClient = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const { data: userData, error: userErr } =
      await supabaseUserClient.auth.getUser();

    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }

    const user = userData.user;

    const { data: subRow, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle<SubscriptionRow>();

    if (subErr) {
      console.error("[stripe/portal] subscription lookup error:", subErr);
      return json(500, { error: "Failed to load subscription" });
    }

    const stripeCustomerId = subRow?.stripe_customer_id;
    if (!stripeCustomerId) {
      return json(400, { error: "No Stripe customer found" });
    }

    // ✅ Correct return URL for local + preview + prod
    const origin = getOrigin(req);

    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/billing`,
    });

    return json(200, { url: portal.url, origin });
  } catch (err: unknown) {
    console.error("[stripe/portal] unexpected error:", err);
    const message =
      err instanceof Error ? err.message : "Portal failed";
    return json(500, { error: message });
  }
}
