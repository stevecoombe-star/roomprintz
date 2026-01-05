// app/api/stripe/topup/route.ts
import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing env var: ${name}`);
  return v;
}

type TokenTopupRow = {
  stripe_price_id: string;
  tokens: number;
  is_active: boolean;
};

type SubscriptionRow = {
  stripe_customer_id: string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function parsePriceId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybe = (body as { priceId?: unknown }).priceId;
  return typeof maybe === "string" && maybe.trim().length > 0 ? maybe.trim() : null;
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

    // Body
    let parsedBody: unknown = {};
    try {
      parsedBody = await req.json();
    } catch {
      // keep {}
    }

    const priceId = parsePriceId(parsedBody);
    if (!priceId) {
      return json(400, { error: "Missing priceId" });
    }

    // Auth: require Bearer token
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(401, { error: "Missing Authorization bearer token" });
    }
    const accessToken = authHeader.slice("Bearer ".length).trim();
    if (!accessToken) {
      return json(401, { error: "Missing access token" });
    }

    // Get user from Supabase using provided access token
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

    // ✅ Validate priceId is one of your active top-up packs
    const { data: topupRow, error: topupErr } = await supabaseAdmin
      .from("token_topups")
      .select("stripe_price_id,tokens,is_active")
      .eq("stripe_price_id", priceId)
      .eq("is_active", true)
      .maybeSingle<TokenTopupRow>();

    if (topupErr) {
      console.error("[topup] token_topups lookup error:", topupErr);
      return json(500, { error: "Failed to validate top-up pack" });
    }

    if (!topupRow) {
      return json(400, { error: "Invalid or inactive top-up priceId" });
    }

    // Reuse / create Stripe customer (store in subscriptions table)
    const { data: subRow, error: subRowErr } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle<SubscriptionRow>();

    if (subRowErr) {
      console.error("[topup] subscriptions lookup error:", subRowErr);
      return json(500, { error: "Failed to load subscription" });
    }

    let stripeCustomerId = subRow?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id, app: "roomprintz" },
      });
      stripeCustomerId = customer.id;

      const { error: upsertErr } = await supabaseAdmin
        .from("subscriptions")
        .upsert({
          user_id: user.id,
          stripe_customer_id: stripeCustomerId,
          status: "inactive",
        });

      if (upsertErr) {
        console.error("[topup] subscriptions upsert error:", upsertErr);
        return json(500, { error: "Failed to save Stripe customer" });
      }
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

    return json(200, { url: session.url });
  } catch (err: unknown) {
    console.error("[topup] unexpected error:", err);
    const message = err instanceof Error ? err.message : "Top-up checkout failed";
    return json(500, { error: message });
  }
}
