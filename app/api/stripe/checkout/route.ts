import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { planId } = (await req.json().catch(() => ({}))) as { planId?: string };

    // For beta we’ll keep it simple and only allow beta price via env.
    // Later: map planId -> priceId via your `plans` table.
    const priceId =
      planId === "beta"
        ? mustEnv("STRIPE_PRICE_ID_BETA")
        : mustEnv("STRIPE_PRICE_ID_BETA");

    // Auth: read the Supabase user from Authorization header (Bearer access_token)
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing Authorization bearer token" }, { status: 401 });
    }
    const accessToken = authHeader.slice("Bearer ".length);

    const supabaseUserClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = userData.user;

    // Find or create Stripe customer (store stripe_customer_id in `subscriptions` table)
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

      // Save linkage now (even before subscription exists)
      const { error: upsertErr } = await supabaseAdmin.from("subscriptions").upsert({
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        status: "incomplete",
      });
      if (upsertErr) throw upsertErr;
    }

    const appUrl = mustEnv("NEXT_PUBLIC_APP_URL");
    const successUrl = `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${appUrl}/billing/cancel`;

    // ✅ IMPORTANT: put user_id in BOTH session metadata and subscription_data.metadata
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true, // enables BETA50 entry in Checkout
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: user.id,
        plan_id: planId ?? "beta",
        app: "roomprintz",
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_id: planId ?? "beta",
          app: "roomprintz",
        },
      },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    console.error("checkout route error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Checkout failed" },
      { status: 500 },
    );
  }
}
