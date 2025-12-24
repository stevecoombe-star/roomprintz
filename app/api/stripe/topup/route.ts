import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-12-15.clover",
});

const supabaseAdmin = createClient(
  mustEnv("SUPABASE_URL"),
  mustEnv("SUPABASE_SERVICE_ROLE_KEY")
);

export async function POST(req: Request) {
  try {
    const { priceId } = (await req.json().catch(() => ({}))) as { priceId?: string };
    if (!priceId) {
      return NextResponse.json({ error: "Missing priceId" }, { status: 400 });
    }

    // Auth: require Bearer token
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    // Get user from Supabase using the provided access token
    const supabaseUserClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = userData.user;

    // ✅ Validate priceId is one of your active top-up packs (prevents arbitrary charges)
    const { data: topupRow, error: topupErr } = await supabaseAdmin
      .from("token_topups")
      .select("stripe_price_id,tokens,is_active")
      .eq("stripe_price_id", priceId)
      .eq("is_active", true)
      .maybeSingle();

    if (topupErr) throw topupErr;
    if (!topupRow) {
      return NextResponse.json({ error: "Invalid or inactive top-up priceId" }, { status: 400 });
    }

    // Reuse / create Stripe customer (store in subscriptions table you already have)
    const { data: subRow, error: subRowErr } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subRowErr) throw subRowErr;

    let stripeCustomerId = subRow?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id, app: "roomprintz" },
      });
      stripeCustomerId = customer.id;

      const { error: upsertErr } = await supabaseAdmin.from("subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        status: "inactive",
      });
      if (upsertErr) throw upsertErr;
    }

    const appUrl = mustEnv("NEXT_PUBLIC_APP_URL");
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/billing`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: user.id,
        kind: "topup",
        price_id: priceId,
        app: "roomprintz",
      },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error("[topup] error:", e);
    return NextResponse.json({ error: e?.message ?? "Top-up checkout failed" }, { status: 500 });
  }
}
