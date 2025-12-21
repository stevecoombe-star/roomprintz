// app/api/stripe/checkout/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-12-15.clover",
});

const supabaseAdmin = createClient(
  mustEnv("SUPABASE_URL"),
  mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
);

// Helper: always return JSON (prevents HTML errors leaking to client)
function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    // Parse body safely
    let planId: string | undefined;
    try {
      const body = (await req.json()) as { planId?: string };
      planId = body?.planId;
    } catch {
      planId = undefined;
    }

    // For beta: keep it simple, use a single price id from env
    const priceId = mustEnv("STRIPE_PRICE_ID_BETA");
    const resolvedPlanId = planId ?? "beta";

    // Auth: read Supabase user from Authorization header (Bearer access_token)
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization bearer token" });
    }
    const accessToken = authHeader.slice("Bearer ".length).trim();
    if (!accessToken) return json(401, { error: "Missing access token" });

    // Use service role client but pass Authorization header to resolve the user
    const supabaseUserClient = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }

    const user = userData.user;

    // Look up Stripe customer id in subscriptions table
    const { data: subRow, error: subRowErr } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subRowErr) throw subRowErr;

    let stripeCustomerId = subRow?.stripe_customer_id ?? null;

    // Create Stripe customer if needed
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

    // Create Checkout Session (subscription)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,

      // ✅ Include mapping for webhook -> user
      metadata: {
        user_id: user.id,
        plan_id: resolvedPlanId,
        app: "roomprintz",
      },

      // ✅ ALSO put on subscription itself (so invoice.paid can map reliably)
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_id: resolvedPlanId,
          app: "roomprintz",
        },
      },
    });

    if (!session.url) {
      return json(500, { error: "Stripe Checkout Session created without a URL" });
    }

    return json(200, { url: session.url });
  } catch (e: unknown) {
    // Always JSON back to client
    const message = e instanceof Error ? e.message : String(e);
    console.error("checkout route error:", e);
    return json(500, { error: message || "Checkout failed" });
  }
}
