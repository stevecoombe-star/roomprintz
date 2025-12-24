// app/api/stripe/portal/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
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
      // ignore
    }
  }

  return "http://localhost:3000";
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    // ✅ Instantiate inside handler (build-safe)
    const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-12-15.clover",
    });

    const supabaseAdmin = createClient(
      mustEnv("SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization bearer token" });
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    if (!accessToken) return json(401, { error: "Missing access token" });

    const supabaseUserClient = createClient(
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
      .maybeSingle();

    if (subErr) throw subErr;

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
  } catch (e: any) {
    console.error("portal route error:", e);
    return json(500, { error: e?.message ?? "Portal failed" });
  }
}
